import { promises as fs, readdirSync, realpathSync, type Stats } from 'node:fs';
import path from 'node:path';

import { ensureFileDestination, resolveWritePath, safeResolveWithin } from './destinations.js';
import { ErrorCode, TerrazulError } from './errors.js';
import { loadConfig, getProfileTools, selectPrimaryTool } from '../utils/config.js';
import { ensureDir } from '../utils/fs.js';
import { readManifest, type ExportEntry } from '../utils/manifest.js';
import { renderTemplateWithSnippets } from '../utils/template.js';

import type { ToolType } from '../types/context.js';
import type { PreprocessResult, SnippetEvent } from '../types/snippet.js';

export interface RenderContext {
  [key: string]: unknown;
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
  snippets: Array<{ source: string; dest: string; output: string; preprocess: PreprocessResult }>;
}

export interface TemplateProgress {
  templateRel: string;
  dest: string;
  pkgName: string | undefined;
}

export interface SnippetProgress {
  event: SnippetEvent;
  templateRel: string;
  dest: string;
  pkgName: string | undefined;
}

interface SnippetFailureDetail {
  pkgName?: string;
  dest: string;
  templateRel: string;
  snippetId: string;
  snippetType: 'askUser' | 'askAgent';
  message: string;
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
  tool: ToolType,
  relUnderTemplates: string,
): string {
  const rel = relUnderTemplates.replaceAll('\\', '/');

  if (tool === 'codex' && rel === 'AGENTS.md.hbs') {
    return resolveWritePath({
      projectDir: projectRoot,
      value: filesMap.codex,
      tool,
      contextFiles: filesMap,
    }).path;
  }
  if (tool === 'claude' && rel === 'CLAUDE.md.hbs') {
    return resolveWritePath({
      projectDir: projectRoot,
      value: filesMap.claude,
      tool,
      contextFiles: filesMap,
    }).path;
  }
  if (tool === 'cursor' && (rel === 'cursor.rules.mdc.hbs' || rel === 'cursor.rules.hbs')) {
    return resolveWritePath({
      projectDir: projectRoot,
      value: filesMap.cursor,
      tool,
      contextFiles: filesMap,
    }).path;
  }
  if (tool === 'copilot') {
    const segment = rel.split('/').pop()?.toLowerCase();
    if (segment === 'copilot.md.hbs') {
      return resolveWritePath({
        projectDir: projectRoot,
        value: filesMap.copilot,
        tool,
        contextFiles: filesMap,
      }).path;
    }
  }

  if (tool === 'claude' && rel === 'claude/settings.json.hbs') {
    return safeResolveWithin(projectRoot, path.join('.claude', 'settings.json'));
  }
  if (tool === 'claude' && rel === 'claude/settings.local.json.hbs') {
    return safeResolveWithin(projectRoot, path.join('.claude', 'settings.local.json'));
  }
  if (tool === 'claude' && rel === 'claude/mcp_servers.json.hbs') {
    return safeResolveWithin(projectRoot, path.join('.claude', 'mcp_servers.json'));
  }
  if (tool === 'claude' && rel.startsWith('claude/agents/')) {
    const tail = rel.slice('claude/agents/'.length);
    const under = tail.endsWith('.hbs') ? tail.slice(0, -4) : tail;
    return safeResolveWithin(projectRoot, path.join('.claude', 'agents', String(under)));
  }

  const cleaned = rel.endsWith('.hbs') ? rel.slice(0, -4) : rel;
  return safeResolveWithin(projectRoot, String(cleaned));
}

function collectFromExports(
  pkgRoot: string,
  tool: ToolType,
  exp: ExportEntry | undefined,
): Array<{ abs: string; relUnderTemplates: string; tool: ToolType }> {
  if (!exp) return [];
  const out: Array<{ abs: string; relUnderTemplates: string; tool: ToolType }> = [];
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

  if (typeof exp.template === 'string') {
    const rel = exp.template.startsWith('templates/')
      ? exp.template.slice('templates/'.length)
      : exp.template;
    const abs = ensureWithinTemplates(rel);
    out.push({ abs, relUnderTemplates: rel, tool });
  }

  const extraKeys: Array<keyof ExportEntry> = ['settings', 'settingsLocal', 'mcpServers'] as never;
  for (const k of extraKeys) {
    const v = (exp as Record<string, unknown>)[k];
    if (typeof v === 'string') {
      const rel = v.startsWith('templates/') ? v.slice('templates/'.length) : v;
      const abs = ensureWithinTemplates(rel);
      out.push({ abs, relUnderTemplates: rel, tool });
    }
  }

  const subDirV = (exp as Record<string, unknown>)['subagentsDir'];
  if (typeof subDirV === 'string') {
    const relDir = subDirV.startsWith('templates/') ? subDirV.slice('templates/'.length) : subDirV;
    const absDir = ensureWithinTemplates(relDir);
    out.push(
      ...collectFilesRecursively(absDir).map((f) => ({
        abs: f,
        relUnderTemplates: path.join(relDir, path.relative(absDir, f)),
        tool,
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

function collectSnippetFailures(
  preprocess: PreprocessResult,
  dest: string,
  templateRel: string,
  pkgName: string | undefined,
): SnippetFailureDetail[] {
  const failures: SnippetFailureDetail[] = [];
  for (const snippet of preprocess.parsed) {
    const execution = preprocess.execution.snippets[snippet.id];
    if (!execution || !execution.error) continue;
    failures.push({
      pkgName,
      dest,
      templateRel,
      snippetId: snippet.id,
      snippetType: snippet.type,
      message: execution.error.message,
    });
  }
  return failures;
}

function formatSnippetFailureMessage(
  projectRoot: string,
  failures: SnippetFailureDetail[],
): string {
  const count = failures.length;
  const header =
    count === 1
      ? 'Snippet execution failed while rendering templates.'
      : `${count} snippets failed while rendering templates.`;
  const lines = failures.map((failure) => {
    const destLabel = path.relative(projectRoot, failure.dest) || failure.dest;
    const locationParts = [];
    if (failure.pkgName) locationParts.push(failure.pkgName);
    locationParts.push(failure.templateRel);
    const location = locationParts.join(':');
    return `- ${destLabel} :: ${failure.snippetId} (${failure.snippetType}) from ${location} — ${failure.message}`;
  });
  return [header, ...lines].join('\n');
}

export interface ApplyOptions {
  force?: boolean; // overwrite if exists
  dryRun?: boolean;
  // package filter: only render this package (name exactly as in agent_modules)
  packageName?: string;
  profileName?: string;
  tool?: ToolType;
  toolSafeMode?: boolean;
  verbose?: boolean;
  onTemplateStart?: (info: TemplateProgress) => void;
  onSnippetEvent?: (progress: SnippetProgress) => void;
}

export async function planAndRender(
  projectRoot: string,
  agentModulesRoot: string,
  opts: ApplyOptions = {},
): Promise<RenderResult> {
  // Load user config for destination defaults
  const cfg = await loadConfig();
  const profileTools = getProfileTools(cfg);
  const primaryTool = selectPrimaryTool(cfg, opts.tool);
  const toolSafeMode = opts.toolSafeMode ?? true;
  const contextFilesRaw = cfg.context?.files as Partial<RenderContext['files']> | undefined;
  const filesMap: RenderContext['files'] = {
    claude: contextFilesRaw?.claude ?? 'CLAUDE.md',
    codex: contextFilesRaw?.codex ?? 'AGENTS.md',
    cursor: contextFilesRaw?.cursor ?? '.cursor/rules.mdc',
    copilot: contextFilesRaw?.copilot ?? '.github/copilot-instructions.md',
  };

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
  const snippetExecutions: Array<{
    source: string;
    dest: string;
    output: string;
    preprocess: PreprocessResult;
  }> = [];
  const snippetFailures: SnippetFailureDetail[] = [];

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
    const toRender: Array<{ abs: string; relUnderTemplates: string; tool: ToolType }> = [];
    if (exp?.claude) toRender.push(...collectFromExports(p.root, 'claude', exp.claude));
    if (exp?.codex) toRender.push(...collectFromExports(p.root, 'codex', exp.codex));
    if (exp?.cursor) toRender.push(...collectFromExports(p.root, 'cursor', exp.cursor));
    if (exp?.copilot) toRender.push(...collectFromExports(p.root, 'copilot', exp.copilot));

    // Build context once per package
    const ctx: RenderContext = {
      project: { root: projectRoot, name: projectName, version: projectVersion },
      pkg: { name: m?.package?.name, version: m?.package?.version },
      env: process.env,
      now: new Date().toISOString(),
      files: filesMap,
    };

    for (const item of toRender) {
      const rel = item.relUnderTemplates.replaceAll('\\', '/');
      let dest = computeDestForRel(projectRoot, filesMap, item.tool, rel);
      dest = await ensureFileDestination(dest, item.tool, projectRoot);
      const destDir = path.dirname(dest);

      opts.onTemplateStart?.({ templateRel: rel, dest, pkgName: p.name });

      const reporter = opts.onSnippetEvent
        ? (event: SnippetEvent) =>
            opts.onSnippetEvent?.({
              event,
              templateRel: rel,
              dest,
              pkgName: p.name,
            })
        : undefined;

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

      const renderResult = await renderTemplateWithSnippets(item.abs, ctx, {
        preprocess: {
          projectDir: projectRoot,
          packageDir: p.root,
          currentTool: primaryTool,
          availableTools: profileTools,
          toolSafeMode,
          verbose: opts.verbose ?? false,
          dryRun: opts.dryRun ?? false,
          report: reporter,
        },
      });

      snippetExecutions.push({
        source: item.abs,
        dest,
        output: renderResult.output,
        preprocess: renderResult.preprocess,
      });

      const failures = collectSnippetFailures(renderResult.preprocess, dest, rel, p.name);
      if (failures.length > 0) {
        snippetFailures.push(...failures);
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
        await fs.writeFile(dest, renderResult.output, 'utf8');
      }
      written.push(dest);
    }
  }

  if (snippetFailures.length > 0) {
    throw new TerrazulError(
      ErrorCode.TOOL_EXECUTION_FAILED,
      formatSnippetFailureMessage(projectRoot, snippetFailures),
      { snippetFailures },
    );
  }

  return { written, skipped, backedUp, snippets: snippetExecutions };
}
