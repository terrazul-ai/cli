import { promises as fs, readdirSync, realpathSync, type Stats } from 'node:fs';
import path from 'node:path';

import Handlebars from 'handlebars';

import { ErrorCode, TerrazulError } from './errors';
import { loadConfig } from '../utils/config';
import { ensureDir } from '../utils/fs';
import { readManifest, type ExportEntry } from '../utils/manifest';
import { resolveWithin } from '../utils/path';

export interface RenderContext {
  project: {
    root: string;
    name?: string;
    version?: string;
  };
  pkg: {
    name?: string;
    version?: string;
  };
  env: Record<string, string | undefined>;
  now: string;
  // passthrough from user config to allow destination selection and user vars later
  files: { claude: string; codex: string; cursor: string; copilot: string };
}

export interface RenderItem {
  pkgName: string;
  source: string; // absolute path to template
  rel: string; // relative to package root
  dest: string; // absolute path to output
}

type SkipReasonCode =
  | 'exists'
  | 'symlink-ancestor-outside'
  | 'dest-symlink-outside'
  | 'dest-symlink-broken'
  | 'unlink-failed'
  | 'unsafe-symlink';

export interface RenderResult {
  written: string[];
  skipped: Array<{ dest: string; reason: string; code: SkipReasonCode }>;
  backedUp: string[];
}

const SKIP_REASON_MESSAGES: Record<SkipReasonCode, string> = {
  exists: 'destination exists (use --force to overwrite)',
  'symlink-ancestor-outside': 'unsafe symlink ancestor resolves outside project root',
  'dest-symlink-outside': 'destination symlink resolves outside project root',
  'dest-symlink-broken': 'destination symlink is broken and cannot be replaced safely',
  'unlink-failed': 'failed to unlink destination symlink before writing',
  'unsafe-symlink': 'unsafe symlink detected at destination',
};

function formatSkipReason(code: SkipReasonCode): string {
  return SKIP_REASON_MESSAGES[code] ?? 'unsafe symlink detected at destination';
}

function makeSkip(
  dest: string,
  code: SkipReasonCode,
): { dest: string; reason: string; code: SkipReasonCode } {
  return { dest, code, reason: formatSkipReason(code) };
}

function safeJoinWithin(root: string, ...parts: string[]): string {
  try {
    return resolveWithin(root, ...parts);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new TerrazulError(ErrorCode.SECURITY_VIOLATION, msg);
  }
}

// Determine whether writing to dest could escape via symlinked ancestors.
// - If any existing ancestor of dest is a symlink that resolves outside root, return false.
// - If dest exists and is a symlink: allow unlink-and-write only when the symlink resolves within root.
async function evaluateDestinationSafety(
  projectRoot: string,
  dest: string,
): Promise<{ safe: true; unlinkDestSymlink: boolean } | { safe: false; reason: SkipReasonCode }> {
  const { lstat, realpath } = fs;
  const rootResolved = path.resolve(projectRoot);
  let rootCanonical: string | null = null;
  try {
    rootCanonical = await realpath(rootResolved);
  } catch {
    rootCanonical = null;
  }
  const isWin = process.platform === 'win32';
  const norm = (s: string) => (isWin ? s.toLowerCase() : s);
  const withSep = (s: string) => (s.endsWith(path.sep) ? s : s + path.sep);
  const baseCandidates = new Set<string>();
  baseCandidates.add(withSep(norm(rootResolved)));
  if (rootCanonical) {
    baseCandidates.add(withSep(norm(rootCanonical)));
  }

  const isWithin = (p: string): boolean => {
    const resolved = path.resolve(p);
    const candidates = [resolved];
    try {
      const canonical = realpathSync(resolved);
      if (canonical && canonical !== resolved) candidates.push(canonical);
    } catch {
      // realpathSync may fail for non-existent paths; ignore.
    }
    return candidates.some((candidate) => {
      const normalized = withSep(norm(candidate));
      for (const base of baseCandidates) {
        if (normalized.startsWith(base)) return true;
      }
      return false;
    });
  };

  // 1) Check existing ancestors of dest directory, but only within the project root boundary.
  let cur = path.dirname(dest);
  const stop = path.parse(cur).root;
  while (isWithin(cur)) {
    try {
      const st = await lstat(cur);
      if (st.isSymbolicLink()) {
        try {
          const real = await realpath(cur);
          if (!isWithin(real)) {
            return { safe: false, reason: 'symlink-ancestor-outside' };
          }
        } catch {
          // Broken symlink ancestor — treat as unsafe
          return { safe: false, reason: 'symlink-ancestor-outside' };
        }
      }
    } catch {
      // cur does not exist; continue upward
    }
    if (cur === stop || path.resolve(cur) === rootResolved) break;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }

  // 2) If dest exists and is a symlink, decide if we can unlink it
  try {
    const stDest = await lstat(dest);
    if (stDest.isSymbolicLink()) {
      try {
        const real = await realpath(dest);
        if (!isWithin(real)) {
          return { safe: false, reason: 'dest-symlink-outside' };
        }
        return { safe: true, unlinkDestSymlink: true };
      } catch {
        return { safe: false, reason: 'dest-symlink-broken' };
      }
    }
  } catch {
    // dest does not exist — no special handling
  }

  return { safe: true, unlinkDestSymlink: false };
}

function computeDestForRel(
  projectRoot: string,
  filesMap: RenderContext['files'],
  relUnderTemplates: string,
): string {
  // Normalize separators for matching
  const rel = relUnderTemplates.replaceAll('\\', '/');

  // High-level, tool-specific mappings first
  if (rel === 'AGENTS.md.hbs') return safeJoinWithin(projectRoot, filesMap.codex);
  if (rel === 'CLAUDE.md.hbs') return safeJoinWithin(projectRoot, filesMap.claude);
  if (rel === 'cursor.rules.hbs') return safeJoinWithin(projectRoot, filesMap.cursor);
  if (rel === 'copilot.md.hbs') return safeJoinWithin(projectRoot, filesMap.copilot);

  // Claude structured assets
  if (rel === 'claude/settings.json.hbs')
    return safeJoinWithin(projectRoot, '.claude', 'settings.json');
  if (rel === 'claude/settings.local.json.hbs')
    return safeJoinWithin(projectRoot, '.claude', 'settings.local.json');
  if (rel === 'claude/mcp_servers.json.hbs')
    return safeJoinWithin(projectRoot, '.claude', 'mcp_servers.json');
  if (rel.startsWith('claude/agents/')) {
    const tail = rel.slice('claude/agents/'.length);
    const under = tail.endsWith('.hbs') ? tail.slice(0, -4) : tail;
    return safeJoinWithin(projectRoot, '.claude', 'agents', String(under));
  }

  // Default fallback: strip ".hbs" and replicate path at project root
  const cleaned = rel.endsWith('.hbs') ? rel.slice(0, -4) : rel;
  return safeJoinWithin(projectRoot, String(cleaned));
}

async function readTemplate(file: string): Promise<string> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    throw new TerrazulError(ErrorCode.FILE_NOT_FOUND, `Missing template: ${file}`, error);
  }
}

function collectFromExports(
  pkgRoot: string,
  exp: ExportEntry | undefined,
): Array<{ abs: string; relUnderTemplates: string }> {
  if (!exp) return [];
  const out: Array<{ abs: string; relUnderTemplates: string }> = [];
  const tplRoot = path.join(pkgRoot, 'templates');

  function ensureWithinTemplates(rel: string): string {
    const base = path.resolve(tplRoot);
    const abs = path.resolve(tplRoot, rel);
    const normBase = base.endsWith(path.sep) ? base : base + path.sep;
    const normAbs = abs.endsWith(path.sep) ? abs : abs + path.sep;
    if (!normAbs.startsWith(normBase)) {
      throw new TerrazulError(
        ErrorCode.SECURITY_VIOLATION,
        `Export path escapes package templates directory: ${rel}`,
      );
    }
    return abs;
  }

  // Primary template
  if (typeof exp.template === 'string') {
    const rel = exp.template.startsWith('templates/')
      ? exp.template.slice('templates/'.length)
      : exp.template;
    const abs = ensureWithinTemplates(rel);
    out.push({ abs, relUnderTemplates: rel });
  }

  // Known Claude extras: settings, settingsLocal, mcpServers; tolerate other keys
  const extraKeys: Array<keyof ExportEntry> = ['settings', 'settingsLocal', 'mcpServers'] as never;
  for (const k of extraKeys) {
    const v = (exp as Record<string, unknown>)[k];
    if (typeof v === 'string') {
      const rel = v.startsWith('templates/') ? v.slice('templates/'.length) : v;
      const abs = ensureWithinTemplates(rel);
      out.push({ abs, relUnderTemplates: rel });
    }
  }

  // Claude subagents directory (copy all files under dir)
  const subDirV = (exp as Record<string, unknown>)['subagentsDir'];
  if (typeof subDirV === 'string') {
    const relDir = subDirV.startsWith('templates/') ? subDirV.slice('templates/'.length) : subDirV;
    const absDir = ensureWithinTemplates(relDir);
    out.push(
      ...collectFilesRecursively(absDir).map((f) => ({
        abs: f,
        relUnderTemplates: path.join(relDir, path.relative(absDir, f)),
      })),
    );
  }

  return out;
}

function collectFilesRecursively(root: string): string[] {
  try {
    const stack: string[] = [root];
    const files: string[] = [];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      const dirents = readdirSync(cur, { withFileTypes: true });
      for (const d of dirents) {
        const abs = path.join(cur, d.name);
        if (d.isDirectory()) stack.push(abs);
        else if (d.isFile()) files.push(abs);
      }
    }
    return files;
  } catch {
    return [];
  }
}

export interface ApplyOptions {
  force?: boolean; // overwrite if exists
  dryRun?: boolean;
  // package filter: only render this package (name exactly as in agent_modules)
  packageName?: string;
  profileName?: string;
}

export async function planAndRender(
  projectRoot: string,
  agentModulesRoot: string,
  opts: ApplyOptions = {},
): Promise<RenderResult> {
  // Load user config for destination defaults
  const cfg = await loadConfig();
  const filesMap: RenderContext['files'] = cfg.context?.files as RenderContext['files'];

  // Discover installed packages
  const pkgs: Array<{ name: string; root: string }> = [];
  const level1 = await fs.readdir(agentModulesRoot).catch(() => [] as string[]);
  for (const d1 of level1) {
    const abs = path.join(agentModulesRoot, d1);
    const st = await fs.stat(abs).catch(() => null);
    if (!st || !st.isDirectory()) continue;
    if (d1.startsWith('@')) {
      const nested = await fs.readdir(abs).catch(() => [] as string[]);
      for (const d2 of nested) {
        const abs2 = path.join(abs, d2);
        const st2 = await fs.stat(abs2).catch(() => null);
        if (st2 && st2.isDirectory()) pkgs.push({ name: `${d1}/${d2}`, root: abs2 });
      }
    } else {
      pkgs.push({ name: d1, root: abs });
    }
  }
  pkgs.sort((a, b) => a.name.localeCompare(b.name));

  const projectManifest = (await readManifest(projectRoot)) ?? undefined;
  const projectName = projectManifest?.package?.name;
  const projectVersion = projectManifest?.package?.version;

  let filtered = pkgs;
  if (opts.packageName) {
    filtered = pkgs.filter((p) => p.name === opts.packageName);
  } else if (opts.profileName) {
    if (!projectManifest) {
      throw new TerrazulError(
        ErrorCode.CONFIG_NOT_FOUND,
        'agents.toml is required when using --profile',
      );
    }
    const profiles = projectManifest.profiles ?? {};
    const memberships = profiles[opts.profileName];
    if (!memberships || memberships.length === 0) {
      throw new TerrazulError(
        ErrorCode.INVALID_ARGUMENT,
        `Profile '${opts.profileName}' is not defined or has no packages`,
      );
    }
    const allowed = new Set(memberships);
    const missing = memberships.filter((name) => !pkgs.some((pkg) => pkg.name === name));
    if (missing.length > 0) {
      throw new TerrazulError(
        ErrorCode.INVALID_ARGUMENT,
        `Profile '${opts.profileName}' references packages that are not installed: ${missing.join(
          ', ',
        )}`,
      );
    }
    filtered = pkgs.filter((pkg) => allowed.has(pkg.name));
  }

  const written: string[] = [];
  const skipped: Array<{ dest: string; reason: string; code: SkipReasonCode }> = [];
  const backedUp: string[] = [];
  let backupRoot: string | undefined;
  const backedUpTargets = new Set<string>();

  async function backupExistingFile(target: string): Promise<void> {
    if (opts.dryRun) return;
    try {
      if (backedUpTargets.has(target)) return;
      const stat = await fs.lstat(target);
      if (!stat.isFile() && !stat.isSymbolicLink()) return;
      if (!backupRoot) {
        const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
        backupRoot = path.join(projectRoot, '.tz-backup', stamp);
      }
      const relativeTarget = path.relative(projectRoot, target);
      const backupPath = path.join(backupRoot, relativeTarget);
      await fs.mkdir(path.dirname(backupPath), { recursive: true });
      await fs.copyFile(target, backupPath);
      backedUp.push(path.relative(projectRoot, backupPath));
      backedUpTargets.add(target);
    } catch {
      /* ignore backup errors */
    }
  }

  for (const p of filtered) {
    const m = await readManifest(p.root);
    const exp = (m?.exports ?? {}) as Partial<
      Record<'claude' | 'codex' | 'cursor' | 'copilot', ExportEntry>
    >;
    const toRender: Array<{ abs: string; relUnderTemplates: string }> = [];
    if (exp?.claude) toRender.push(...collectFromExports(p.root, exp.claude));
    if (exp?.codex) toRender.push(...collectFromExports(p.root, exp.codex));
    if (exp?.cursor) toRender.push(...collectFromExports(p.root, exp.cursor));
    if (exp?.copilot) toRender.push(...collectFromExports(p.root, exp.copilot));

    // Build context once per package
    const ctx: RenderContext = {
      project: { root: projectRoot, name: projectName, version: projectVersion },
      pkg: { name: m?.package?.name, version: m?.package?.version },
      env: process.env,
      now: new Date().toISOString(),
      files: filesMap,
    };

    // Ensure strict strings for files mapping to satisfy type-aware lint
    const filesMapStrict: RenderContext['files'] = {
      claude: String(filesMap.claude),
      codex: String(filesMap.codex),
      cursor: String(filesMap.cursor),
      copilot: String(filesMap.copilot),
    };

    for (const item of toRender) {
      const tpl = await readTemplate(item.abs);
      const rel = item.relUnderTemplates.replaceAll('\\', '/');
      const dest = computeDestForRel(projectRoot, filesMapStrict, String(rel));
      const destDir = path.dirname(dest);

      let destStat: Stats | null = null;
      try {
        destStat = await fs.lstat(dest);
      } catch {
        destStat = null;
      }

      if (!opts.force && destStat?.isFile()) {
        skipped.push(makeSkip(dest, 'exists'));
        continue;
      }

      if (!opts.dryRun) {
        // Security: prevent symlink escapes by verifying existing ancestors and
        // destination symlink behavior before writing.
        const safety = await evaluateDestinationSafety(projectRoot, dest);
        if (!('safe' in safety) || safety.safe !== true) {
          const code =
            typeof safety === 'object' && 'safe' in safety && !safety.safe
              ? safety.reason
              : 'unsafe-symlink';
          skipped.push(makeSkip(dest, code));
          continue;
        }
        if (destStat) {
          await backupExistingFile(dest);
        }
        if (safety.unlinkDestSymlink) {
          try {
            await fs.unlink(dest);
          } catch {
            skipped.push(makeSkip(dest, 'unlink-failed'));
            continue;
          }
        }
        ensureDir(destDir);
        const compiled = Handlebars.compile(tpl);
        const out = compiled(ctx);
        await fs.writeFile(dest, out, 'utf8');
      }
      written.push(dest);
    }
  }

  return { written, skipped, backedUp };
}
