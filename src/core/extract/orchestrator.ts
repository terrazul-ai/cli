import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ensureDir } from '../../utils/fs.js';
import { resolveWithin } from '../../utils/path.js';
import { ErrorCode, TerrazulError } from '../errors.js';
import { buildAgentsToml, type ExportMap } from './build-manifest.js';
import { parseCodexMcpServers } from './mcp/codex-config.js';
import { parseProjectMcpServers } from './mcp/project-config.js';
import {
  resolveProjectRoot,
  sanitizeEnv,
  sanitizeMcpServers,
  sanitizeSettingsJson,
  sanitizeText,
} from './sanitize.js';

import type {
  ExecuteOptions,
  ExtractOptions,
  ExtractPlan,
  ExtractResult,
  LoggerLike,
  ManifestPatch,
  MCPServerPlan,
  PlannedOutput,
} from './types.js';

export type {
  ExecuteOptions, ExtractOptions, ExtractPlan, ExtractResult, LoggerLike, MCPServerPlan,
  PlannedOutput
} from './types.js';

const CLAUDE_SUBAGENT_ARTIFACT_ID = 'claude.subagents';
const CLAUDE_TEMPLATE_PREFIX = 'templates/claude/agents/';
const TEMPLATE_SUFFIX = '.hbs';

export function getSubagentIdFromTemplatePath(relativePath: string): string | null {
  if (!relativePath.startsWith(CLAUDE_TEMPLATE_PREFIX)) return null;
  const trimmed = relativePath.slice(CLAUDE_TEMPLATE_PREFIX.length);
  if (trimmed.endsWith(TEMPLATE_SUFFIX)) {
    return trimmed.slice(0, -TEMPLATE_SUFFIX.length);
  }
  return trimmed;
}

export function getSubagentIdFromSourcePath(absPath: string): string {
  const segments = absPath.split(path.sep);
  const claudeIndex = segments.findIndex((segment) => segment === '.claude');
  if (claudeIndex >= 0 && segments[claudeIndex + 1] === 'agents') {
    return segments.slice(claudeIndex + 2).join('/');
  }
  return segments.slice(-1).join('/');
}

export function getPlanSubagentIds(plan: ExtractPlan): string[] {
  const raw = plan.detected[CLAUDE_SUBAGENT_ARTIFACT_ID];
  if (!Array.isArray(raw)) return [];
  return raw.map((abs) => getSubagentIdFromSourcePath(abs)).filter((id) => id.length > 0);
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function isNonEmptyDir(p: string): Promise<boolean> {
  try {
    const st = await fs.stat(p);
    if (!st.isDirectory()) return false;
    const entries = await fs.readdir(p);
    return entries.length > 0;
  } catch {
    return false;
  }
}

async function readJsonMaybe(p: string): Promise<unknown> {
  try {
    const txt = await fs.readFile(p, 'utf8');
    const parsed: unknown = JSON.parse(txt);
    return parsed;
  } catch {
    return null;
  }
}

function stableSort<T>(arr: T[], map: (v: T) => string): T[] {
  return [...arr].sort((a, b) => map(a).localeCompare(map(b)));
}

// Defensive join to ensure writes never escape the intended output directory.
function safeJoinWithin(baseDirAbs: string, ...parts: string[]): string {
  try {
    return resolveWithin(baseDirAbs, ...parts);
  } catch {
    throw new TerrazulError(
      ErrorCode.SECURITY_VIOLATION,
      'Refusing to write outside of --out directory',
    );
  }
}

function mergeManifestEntry(target: ExportMap, patch?: ManifestPatch): void {
  if (!patch) return;
  const existing = target[patch.tool] ?? {};
  target[patch.tool] = { ...existing, ...patch.properties };
}

function buildManifestFromOutputs(outputs: PlannedOutput[]): ExportMap {
  const manifest: ExportMap = {};
  for (const output of outputs) {
    mergeManifestEntry(manifest, output.manifestPatch);
  }
  return manifest;
}

function dedupeMcpServers(servers: MCPServerPlan[]): MCPServerPlan[] {
  const map = new Map<string, MCPServerPlan>();
  for (const server of servers) {
    if (!map.has(server.id)) {
      map.set(server.id, server);
    }
  }
  return [...map.values()];
}

function buildMcpServersObject(servers: MCPServerPlan[]): Record<string, unknown> {
  const entries = servers.map((server) => {
    const def: Record<string, unknown> = { command: server.definition.command };
    if (server.definition.args.length > 0) def.args = server.definition.args;
    if (Object.keys(server.definition.env).length > 0) def.env = server.definition.env;
    return [server.name, def] as const;
  });
  entries.sort(([a], [b]) => a.localeCompare(b));
  const out: Record<string, unknown> = {};
  for (const [name, def] of entries) {
    out[name] = def;
  }
  return out;
}

function normalizeProjectMcpObject(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (obj.mcpServers && typeof obj.mcpServers === 'object') {
    return obj.mcpServers as Record<string, unknown>;
  }
  return obj;
}

function createClaudeMcpPlans(
  sanitized: unknown,
  projectRootAbs: string,
  origin: string,
): MCPServerPlan[] {
  const section = normalizeProjectMcpObject(sanitized);
  if (!section) return [];
  const plans: MCPServerPlan[] = [];
  for (const [name, value] of Object.entries(section)) {
    if (!value || typeof value !== 'object') continue;
    const record = value as Record<string, unknown>;
    const commandRaw = record.command;
    if (typeof commandRaw !== 'string' || commandRaw.trim() === '') continue;
    const argsRaw = Array.isArray(record.args) ? record.args : [];
    const envRaw = record.env && typeof record.env === 'object' ? record.env : undefined;
    const sanitizedArgs = argsRaw
      .filter((arg): arg is string => typeof arg === 'string')
      .map((arg) => sanitizeText(String(arg), projectRootAbs));
    const envEntries = envRaw
      ? Object.entries(envRaw as Record<string, unknown>).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        )
      : [];
    const sanitizedEnv = sanitizeEnv(Object.fromEntries(envEntries));
    plans.push({
      id: `claude:${name}`,
      source: 'claude',
      name,
      origin,
      definition: {
        command: sanitizeText(String(commandRaw), projectRootAbs),
        args: sanitizedArgs,
        env: sanitizedEnv ?? {},
      },
    });
  }
  plans.sort((a, b) => a.id.localeCompare(b.id));
  return plans;
}

export async function analyzeExtractSources(options: ExtractOptions): Promise<ExtractPlan> {
  const fromAbs = path.resolve(options.from);
  const projectRoot = resolveProjectRoot(fromAbs);

  const plan: ExtractPlan = {
    projectRoot,
    detected: {},
    skipped: [],
    manifest: {},
    outputs: [],
    mcpServers: [],
  };

  const addOutput = (output: PlannedOutput): void => {
    plan.outputs.push(output);
    mergeManifestEntry(plan.manifest, output.manifestPatch);
  };

  addOutput({
    id: 'scaffold:README.md',
    artifactId: '__base.readme',
    relativePath: 'README.md',
    format: 'text',
    data: `# ${options.name}\n\nThis package was generated via 'tz extract'.\n`,
    alwaysInclude: true,
  });

  const candidates = {
    codexAgents: [
      path.join(projectRoot, 'AGENTS.md'),
      path.join(projectRoot, '.codex', 'AGENTS.md'),
    ],
    claudeMd: [path.join(projectRoot, 'CLAUDE.md'), path.join(projectRoot, '.claude', 'CLAUDE.md')],
    claudeSettings: [path.join(projectRoot, '.claude', 'settings.json')],
    claudeSettingsLocal: [path.join(projectRoot, '.claude', 'settings.local.json')],
    claudeMcp: [
      path.join(projectRoot, '.claude', 'mcp_servers.json'),
      path.join(projectRoot, '.claude', 'mcp-servers.json'),
    ],
    claudeAgentsDir: [path.join(projectRoot, '.claude', 'agents')],
    cursorRules: [path.join(projectRoot, '.cursor', 'rules')],
    copilot: [path.join(projectRoot, '.github', 'copilot-instructions.md')],
  } as const;

  const exists: Record<keyof typeof candidates, string | null> = {
    codexAgents: null,
    claudeMd: null,
    claudeSettings: null,
    claudeSettingsLocal: null,
    claudeMcp: null,
    claudeAgentsDir: null,
    cursorRules: null,
    copilot: null,
  };

  for (const key of Object.keys(candidates) as (keyof typeof candidates)[]) {
    for (const candidatePath of candidates[key]) {
      if (await pathExists(candidatePath)) {
        exists[key] = candidatePath;
        break;
      }
    }
  }

  let agentFiles: string[] = [];
  if (exists.claudeAgentsDir) {
    const relRoot = exists.claudeAgentsDir;
    const rootLst = await fs.lstat(relRoot).catch(() => null);
    if (rootLst && rootLst.isSymbolicLink()) {
      plan.skipped.push('claude.agents (symlink dir ignored)');
    } else {
      const stack: string[] = [relRoot];
      const collected: string[] = [];
      while (stack.length > 0) {
        const cur = stack.pop()!;
        const entries = await fs.readdir(cur);
        for (const ent of entries) {
          const abs = path.join(cur, ent);
          const lst = await fs.lstat(abs);
          if (lst.isSymbolicLink()) continue;
          if (lst.isDirectory()) {
            stack.push(abs);
          } else if (lst.isFile() && /\.md$/i.test(ent)) {
            collected.push(abs);
          }
        }
      }
      agentFiles = stableSort(collected, (p) => p);
    }
  }

  if (exists.codexAgents) {
    const src = exists.codexAgents;
    const lst = await fs.lstat(src);
    if (lst.isSymbolicLink()) {
      plan.skipped.push('codex.Agents (symlink ignored)');
    } else {
      const sanitized = sanitizeText(await fs.readFile(src, 'utf8'), projectRoot);
      plan.detected['codex.Agents'] = src;
      addOutput({
        id: 'codex.Agents:templates/AGENTS.md.hbs',
        artifactId: 'codex.Agents',
        relativePath: 'templates/AGENTS.md.hbs',
        format: 'text',
        data: sanitized,
        manifestPatch: { tool: 'codex', properties: { template: 'templates/AGENTS.md.hbs' } },
      });
    }
  }

  if (exists.claudeMd) {
    const src = exists.claudeMd;
    const lst = await fs.lstat(src);
    if (lst.isSymbolicLink()) {
      plan.skipped.push('claude.Readme (symlink ignored)');
    } else {
      const sanitized = sanitizeText(await fs.readFile(src, 'utf8'), projectRoot);
      plan.detected['claude.Readme'] = src;
      addOutput({
        id: 'claude.Readme:templates/CLAUDE.md.hbs',
        artifactId: 'claude.Readme',
        relativePath: 'templates/CLAUDE.md.hbs',
        format: 'text',
        data: sanitized,
        manifestPatch: { tool: 'claude', properties: { template: 'templates/CLAUDE.md.hbs' } },
      });
    }
  }

  if (exists.claudeSettings) {
    const src = exists.claudeSettings;
    const lst = await fs.lstat(src);
    if (lst.isSymbolicLink()) {
      plan.skipped.push('claude.settings (symlink ignored)');
    } else {
      const raw = await readJsonMaybe(src);
      const sanitized = sanitizeSettingsJson(raw, projectRoot);
      plan.detected['claude.settings'] = src;
      addOutput({
        id: 'claude.settings:templates/claude/settings.json.hbs',
        artifactId: 'claude.settings',
        relativePath: 'templates/claude/settings.json.hbs',
        format: 'json',
        data: sanitized ?? {},
        manifestPatch: {
          tool: 'claude',
          properties: { settings: 'templates/claude/settings.json.hbs' },
        },
      });
    }
  }

  if (exists.claudeSettingsLocal) {
    const src = exists.claudeSettingsLocal;
    if (options.includeClaudeLocal) {
      const lst = await fs.lstat(src);
      if (lst.isSymbolicLink()) {
        plan.skipped.push('claude.settings.local (symlink ignored)');
      } else {
        const raw = await readJsonMaybe(src);
        const sanitized = sanitizeSettingsJson(raw, projectRoot);
        plan.detected['claude.settings.local'] = src;
        addOutput({
          id: 'claude.settings.local:templates/claude/settings.local.json.hbs',
          artifactId: 'claude.settings.local',
          relativePath: 'templates/claude/settings.local.json.hbs',
          format: 'json',
          data: sanitized ?? {},
          manifestPatch: {
            tool: 'claude',
            properties: { settingsLocal: 'templates/claude/settings.local.json.hbs' },
          },
        });
      }
    } else {
      plan.skipped.push('claude.settings.local (use --include-claude-local to include)');
    }
  }

  if (options.includeClaudeUser) {
    const userJson = path.join(os.homedir(), '.claude.json');
    if (await pathExists(userJson)) {
      const lst = await fs.lstat(userJson);
      if (lst.isSymbolicLink()) {
        plan.skipped.push('claude.user.settings (symlink ignored)');
      } else {
        const raw = await readJsonMaybe(userJson);
        const rawObj =
          raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : undefined;
        const projects =
          rawObj?.projects && typeof rawObj.projects === 'object'
            ? (rawObj.projects as Record<string, unknown>)
            : undefined;
        const projBlock = projects ? projects[projectRoot] : undefined;
        if (projBlock && typeof projBlock === 'object') {
          const sanitized = sanitizeSettingsJson(projBlock, projectRoot);
          plan.detected['claude.user.settings'] = userJson;
          addOutput({
            id: 'claude.user.settings:templates/claude/user.settings.json.hbs',
            artifactId: 'claude.user.settings',
            relativePath: 'templates/claude/user.settings.json.hbs',
            format: 'json',
            data: sanitized ?? {},
            manifestPatch: {
              tool: 'claude',
              properties: { userSettings: 'templates/claude/user.settings.json.hbs' },
            },
          });
        }
      }
    }
  }

  if (exists.claudeMcp) {
    const src = exists.claudeMcp;
    const lst = await fs.lstat(src);
    if (lst.isSymbolicLink()) {
      plan.skipped.push('claude.mcp_servers (symlink ignored)');
    } else {
      const raw = await readJsonMaybe(src);
      const sanitized = sanitizeMcpServers(raw, projectRoot) ?? {};
      plan.detected['claude.mcp_servers'] = src;
      addOutput({
        id: 'claude.mcp_servers:templates/claude/mcp_servers.json.hbs',
        artifactId: 'claude.mcp_servers',
        relativePath: 'templates/claude/mcp_servers.json.hbs',
        format: 'json',
        data: sanitized,
        manifestPatch: {
          tool: 'claude',
          properties: { mcpServers: 'templates/claude/mcp_servers.json.hbs' },
        },
      });
      plan.mcpServers.push(...createClaudeMcpPlans(sanitized, projectRoot, src));
    }
  }

  if (agentFiles.length > 0 && exists.claudeAgentsDir) {
    plan.detected['claude.subagents'] = agentFiles;
    let manifestApplied = false;
    for (const src of agentFiles) {
      const relUnderAgents = path.relative(exists.claudeAgentsDir, src);
      const normalized = relUnderAgents.split(path.sep).join('/');
      const sanitized = sanitizeText(await fs.readFile(src, 'utf8'), projectRoot);
      addOutput({
        id: `claude.subagents:templates/claude/agents/${normalized}.hbs`,
        artifactId: 'claude.subagents',
        relativePath: `templates/claude/agents/${normalized}.hbs`,
        format: 'text',
        data: sanitized,
        manifestPatch: manifestApplied
          ? undefined
          : {
              tool: 'claude',
              properties: { subagentsDir: 'templates/claude/agents' },
            },
      });
      manifestApplied = true;
    }
  }

  if (exists.cursorRules) {
    const src = exists.cursorRules;
    const lstRoot = await fs.lstat(src);
    if (lstRoot.isSymbolicLink()) {
      plan.skipped.push('cursor.rules (symlink ignored)');
    } else {
      const st = await fs.stat(src);
      let content = '';
      if (st.isFile()) {
        content = await fs.readFile(src, 'utf8');
      } else if (st.isDirectory()) {
        const stack: string[] = [src];
        const files: string[] = [];
        while (stack.length > 0) {
          const cur = stack.pop()!;
          const entries = await fs.readdir(cur);
          for (const ent of entries) {
            const abs = path.join(cur, ent);
            const lst = await fs.lstat(abs);
            if (lst.isSymbolicLink()) continue;
            if (lst.isDirectory()) {
              stack.push(abs);
            } else if (lst.isFile()) {
              const ext = path.extname(ent).toLowerCase();
              if (ext === '.txt' || ext === '.mdc') files.push(abs);
            }
          }
        }
        for (const file of stableSort(files, (p) => p)) {
          content += `${await fs.readFile(file, 'utf8')}\n`;
        }
      }
      const sanitized = sanitizeText(content, projectRoot);
      plan.detected['cursor.rules'] = src;
      addOutput({
        id: 'cursor.rules:templates/cursor.rules.hbs',
        artifactId: 'cursor.rules',
        relativePath: 'templates/cursor.rules.hbs',
        format: 'text',
        data: sanitized,
        manifestPatch: { tool: 'cursor', properties: { template: 'templates/cursor.rules.hbs' } },
      });
    }
  }

  if (exists.copilot) {
    const src = exists.copilot;
    const lst = await fs.lstat(src);
    if (lst.isSymbolicLink()) {
      plan.skipped.push('copilot (symlink ignored)');
    } else {
      const sanitized = sanitizeText(await fs.readFile(src, 'utf8'), projectRoot);
      plan.detected['copilot'] = src;
      addOutput({
        id: 'copilot:templates/copilot.md.hbs',
        artifactId: 'copilot',
        relativePath: 'templates/copilot.md.hbs',
        format: 'text',
        data: sanitized,
        manifestPatch: { tool: 'copilot', properties: { template: 'templates/copilot.md.hbs' } },
      });
    }
  }

  const codexConfigPath =
    options.codexConfigPath ?? path.join(os.homedir(), '.codex', 'config.toml');
  if (await pathExists(codexConfigPath)) {
    const toml = await fs.readFile(codexConfigPath, 'utf8');
    plan.mcpServers.push(...parseCodexMcpServers(toml, projectRoot, codexConfigPath));
  }

  const projectMcpPath = options.projectMcpConfigPath ?? path.join(projectRoot, '.mcp.json');
  if (await pathExists(projectMcpPath)) {
    const json = await fs.readFile(projectMcpPath, 'utf8');
    plan.mcpServers.push(...parseProjectMcpServers(json, projectRoot, projectMcpPath));
  }

  plan.mcpServers = dedupeMcpServers(plan.mcpServers).sort((a, b) => a.id.localeCompare(b.id));

  const mcpOutput = plan.outputs.find(
    (output: PlannedOutput) => output.artifactId === 'claude.mcp_servers',
  );
  if (mcpOutput) {
    mcpOutput.data = buildMcpServersObject(plan.mcpServers);
  }

  if (Object.keys(plan.detected).length === 0) {
    throw new TerrazulError(
      ErrorCode.INVALID_ARGUMENT,
      `No recognized inputs found under ${projectRoot}. Ensure at least one exists: AGENTS.md, .codex/AGENTS.md, .claude/CLAUDE.md, .claude/settings.json, .claude/mcp_servers.json, .claude/agents/**/*.md, .cursor/rules, .github/copilot-instructions.md`,
    );
  }

  plan.manifest = buildManifestFromOutputs(plan.outputs);
  return plan;
}

export async function executeExtract(
  plan: ExtractPlan,
  execOptions: ExecuteOptions,
  logger: LoggerLike,
): Promise<ExtractResult> {
  const outAbs = path.resolve(execOptions.out);
  const willWrite = !execOptions.dryRun;
  const selectedArtifacts = new Set(execOptions.includedArtifacts ?? []);
  const includedSubagentSet = new Set(execOptions.includedSubagentFiles ?? []);
  const canonicalSubagentPatch = plan.outputs.find(
    (output) => output.artifactId === CLAUDE_SUBAGENT_ARTIFACT_ID && output.manifestPatch,
  )?.manifestPatch;

  const outputsToWrite: PlannedOutput[] = [];
  const subagentIndexes: number[] = [];

  for (const output of plan.outputs) {
    if (output.artifactId === CLAUDE_SUBAGENT_ARTIFACT_ID) {
      if (!selectedArtifacts.has(CLAUDE_SUBAGENT_ARTIFACT_ID)) continue;
      const subagentId = getSubagentIdFromTemplatePath(output.relativePath);
      if (includedSubagentSet.size > 0 && (!subagentId || !includedSubagentSet.has(subagentId))) {
        continue;
      }
      outputsToWrite.push(output);
      subagentIndexes.push(outputsToWrite.length - 1);
      continue;
    }
    if (output.alwaysInclude || selectedArtifacts.has(output.artifactId)) {
      outputsToWrite.push(output);
    }
  }

  if (subagentIndexes.length > 0 && canonicalSubagentPatch) {
    const hasPatch = subagentIndexes.some((idx) => outputsToWrite[idx].manifestPatch);
    if (!hasPatch) {
      const firstIdx = subagentIndexes[0];
      outputsToWrite[firstIdx] = {
        ...outputsToWrite[firstIdx],
        manifestPatch: canonicalSubagentPatch,
      };
    }
  }

  const detected: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(plan.detected)) {
    if (!selectedArtifacts.has(key)) continue;
    if (key === CLAUDE_SUBAGENT_ARTIFACT_ID && Array.isArray(value)) {
      if (includedSubagentSet.size === 0) {
        detected[key] = value;
      } else {
        const filtered = (value as string[]).filter((abs) =>
          includedSubagentSet.has(getSubagentIdFromSourcePath(abs)),
        );
        if (filtered.length > 0) {
          detected[key] = filtered;
        }
      }
      continue;
    }
    detected[key] = value;
  }

  if (Object.keys(detected).length === 0) {
    throw new TerrazulError(
      ErrorCode.INVALID_ARGUMENT,
      'No recognized inputs selected. Include at least one artifact before executing extract.',
    );
  }

  if (willWrite) {
    if (await pathExists(outAbs)) {
      const lst = await fs.lstat(outAbs);
      if (lst.isSymbolicLink()) {
        throw new TerrazulError(
          ErrorCode.SECURITY_VIOLATION,
          `Output path is a symlink: ${outAbs}. Refusing to use --out that points elsewhere.`,
        );
      }
      if (lst.isDirectory()) {
        if (await isNonEmptyDir(outAbs)) {
          if (execOptions.force) {
            await fs.rm(outAbs, { recursive: true, force: true });
            ensureDir(outAbs);
          } else {
            throw new TerrazulError(
              ErrorCode.FILE_EXISTS,
              `Output directory not empty: ${outAbs}. Re-run with --force or choose an empty directory.`,
            );
          }
        }
      } else {
        throw new TerrazulError(
          ErrorCode.FILE_EXISTS,
          `Output path exists and is a file: ${outAbs}. Choose a directory path or remove the file.`,
        );
      }
    } else {
      ensureDir(outAbs);
    }
  }

  const selectedMcpIds = new Set(execOptions.includedMcpServers ?? []);
  const includeAllMcp = selectedMcpIds.size === 0;
  const selectedMcpServers = plan.mcpServers.filter((server: MCPServerPlan) =>
    includeAllMcp ? true : selectedMcpIds.has(server.id),
  );
  const mcpJson = buildMcpServersObject(selectedMcpServers);

  const outputsWritten: string[] = [];

  if (willWrite) {
    ensureDir(outAbs);
    for (const output of outputsToWrite) {
      const dest = safeJoinWithin(outAbs, ...output.relativePath.split('/'));
      ensureDir(path.dirname(dest));
      let content: string;
      if (output.artifactId === 'claude.mcp_servers') {
        content = JSON.stringify(mcpJson, null, 2);
      } else if (output.format === 'json') {
        content = JSON.stringify(output.data ?? {}, null, 2);
      } else {
        content = String(output.data ?? '');
      }
      await fs.writeFile(dest, content, 'utf8');
      try {
        await fs.chmod(dest, 0o644);
      } catch {
        // ignore chmod errors on non-POSIX filesystems
      }
      outputsWritten.push(output.relativePath);
    }
  }

  const manifestOut = buildManifestFromOutputs(outputsToWrite);

  if (willWrite) {
    const toml = buildAgentsToml(execOptions.name, execOptions.version, manifestOut);
    const manifestPath = safeJoinWithin(outAbs, 'agents.toml');
    await fs.writeFile(manifestPath, toml, 'utf8');
    try {
      await fs.chmod(manifestPath, 0o644);
    } catch {
      // ignore chmod errors on non-POSIX filesystems
    }
    outputsWritten.push('agents.toml');
  }

  logger.info(`extract: found ${Object.keys(detected).length} artifacts`);

  return {
    summary: {
      projectRoot: plan.projectRoot,
      detected,
      outputs: outputsWritten.sort(),
      manifest: manifestOut,
      skipped: plan.skipped,
    },
  };
}

export async function performExtract(
  options: ExtractOptions,
  logger: LoggerLike,
): Promise<ExtractResult> {
  const plan = await analyzeExtractSources(options);
  const execOptions: ExecuteOptions = {
    ...options,
    includedArtifacts: Object.keys(plan.detected),
    includedMcpServers: plan.mcpServers.map((server) => server.id),
    includedSubagentFiles: getPlanSubagentIds(plan),
  };
  return await executeExtract(plan, execOptions, logger);
}
