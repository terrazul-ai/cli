import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as TOML from '@iarna/toml';

import { readManifest, type ProjectManifest } from './manifest.js';
import { ErrorCode, TerrazulError } from '../core/errors.js';
import {
  DEFAULT_ENVIRONMENTS,
  UserConfigSchema,
  type EnvironmentConfig,
  type UserConfig,
} from '../types/config.js';

const CONFIG_DIRNAME = '.terrazul';
const CONFIG_FILENAME = 'config.json';

export function getConfigDir(): string {
  return path.join(os.homedir(), CONFIG_DIRNAME);
}

export function getConfigPath(): string {
  return path.join(getConfigDir(), CONFIG_FILENAME);
}

async function ensureDirExists(dir: string): Promise<void> {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch {
    // ignore
  }
}

function withContextFileDefaults(cfg: UserConfig): UserConfig {
  // Ensure context and files map exist and include defaults; preserve user-provided values
  const defaults = {
    claude: 'CLAUDE.md',
    codex: 'AGENTS.md',
    cursor: '.cursor/rules',
    copilot: '.github/copilot-instructions.md',
  } as const;
  const files = (cfg.context?.files ?? {}) as Record<string, string>;
  const mergedFiles: { claude: string; codex: string; cursor: string; copilot: string } = {
    claude: files.claude ?? defaults.claude,
    codex: files.codex ?? defaults.codex,
    cursor: files.cursor ?? defaults.cursor,
    copilot: files.copilot ?? defaults.copilot,
  };
  cfg.context = cfg.context ? { ...cfg.context, files: mergedFiles } : { files: mergedFiles };
  return cfg;
}

type RawConfigInput = Partial<UserConfig> & {
  environments?: Record<string, Partial<EnvironmentConfig>>;
};

function normalizeEnvironmentConfig(cfg: UserConfig, raw?: RawConfigInput): UserConfig {
  const environmentName =
    cfg.environment && cfg.environment.length > 0 ? cfg.environment : 'production';
  const mergedEnvironments: Record<string, EnvironmentConfig> = {
    ...DEFAULT_ENVIRONMENTS,
    ...cfg.environments,
  };

  const rawRegistry = raw?.registry;
  const activeSource = mergedEnvironments[environmentName] ?? { registry: cfg.registry };
  const resolvedRegistry =
    rawRegistry ??
    activeSource.registry ??
    raw?.environments?.[environmentName]?.registry ??
    cfg.registry ??
    DEFAULT_ENVIRONMENTS.production.registry;
  const activeEnv: EnvironmentConfig = {
    registry: resolvedRegistry,
    token: activeSource.token ?? cfg.token,
    tokenExpiry: activeSource.tokenExpiry ?? cfg.tokenExpiry,
    username: activeSource.username ?? cfg.username,
  };

  mergedEnvironments[environmentName] = { ...activeEnv };

  const normalized: UserConfig = {
    ...cfg,
    environment: environmentName,
    environments: mergedEnvironments,
    registry: activeEnv.registry,
    token: activeEnv.token,
    tokenExpiry: activeEnv.tokenExpiry,
    username: activeEnv.username,
  };
  return normalized;
}

export function normalizeConfig(raw: unknown): UserConfig {
  const rawObj: RawConfigInput | undefined =
    raw && typeof raw === 'object' ? (raw as RawConfigInput) : undefined;
  const parsed = UserConfigSchema.parse(raw ?? {});
  const withEnv = normalizeEnvironmentConfig(parsed, rawObj);
  return withContextFileDefaults(withEnv);
}

export async function readUserConfigFrom(file: string): Promise<UserConfig> {
  try {
    const data = await fs.readFile(file, 'utf8');
    const parsed: unknown = JSON.parse(data);
    return normalizeConfig(parsed);
  } catch {
    // If file missing or invalid, fall back to defaults
    return normalizeConfig({});
  }
}

export async function loadConfig(): Promise<UserConfig> {
  return readUserConfigFrom(getConfigPath());
}

export async function saveConfig(config: UserConfig): Promise<void> {
  const file = getConfigPath();
  await ensureDirExists(path.dirname(file));
  const normalized = normalizeConfig(config);
  const json = JSON.stringify(normalized, null, 2) + '\n';
  await fs.writeFile(file, json, { encoding: 'utf8' });
  if (process.platform !== 'win32') {
    // 0600 perms on Unix-like systems
    await fs.chmod(file, 0o600);
  }
}

export async function updateConfig(patch: Partial<UserConfig>): Promise<UserConfig> {
  const current = await loadConfig();
  const merged = { ...current, ...patch } as UserConfig;
  // Validate before save
  const valid = normalizeConfig(merged);
  await saveConfig(valid);
  return valid;
}

export function getEffectiveToken(config?: UserConfig): string | undefined {
  const envToken = process.env.TERRAZUL_TOKEN;
  if (envToken && envToken.length > 0) return envToken;
  if (!config) return undefined;
  const activeEnv = config.environments?.[config.environment];
  if (activeEnv?.token) return activeEnv.token;
  return config.token;
}

// Resolve "env:NAME" indirection for tool env specs at spawn time.
export function expandEnvVars(
  envSpec?: Record<string, string>,
): Record<string, string | undefined> | undefined {
  if (!envSpec) return undefined;
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(envSpec)) {
    out[k] = v.startsWith('env:') ? process.env[v.slice(4)] : v;
  }
  return out;
}

export interface ProjectConfigData {
  manifest: ProjectManifest;
  dependencies: Record<string, string>;
}

function assertDependencyTable(value: unknown): void {
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TerrazulError(
      ErrorCode.CONFIG_INVALID,
      'Invalid [dependencies] table in agents.toml',
    );
  }
  for (const [dep, range] of Object.entries(value as Record<string, unknown>)) {
    if (typeof dep !== 'string' || dep.trim().length === 0) {
      throw new TerrazulError(ErrorCode.CONFIG_INVALID, 'Dependency names must be strings');
    }
    if (typeof range !== 'string' || range.trim().length === 0) {
      throw new TerrazulError(
        ErrorCode.CONFIG_INVALID,
        `Dependency '${dep}' must declare a version range string`,
      );
    }
  }
}

export async function loadProjectConfig(projectRoot: string): Promise<ProjectConfigData> {
  const manifestPath = path.join(projectRoot, 'agents.toml');
  let raw: string;
  try {
    raw = await fs.readFile(manifestPath, 'utf8');
  } catch {
    throw new TerrazulError(
      ErrorCode.CONFIG_NOT_FOUND,
      'agents.toml not found. Run `tz init` to create one.',
    );
  }

  let parsed: unknown;
  try {
    parsed = TOML.parse(raw);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Invalid agents.toml';
    throw new TerrazulError(ErrorCode.CONFIG_INVALID, msg, { cause: error });
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new TerrazulError(ErrorCode.CONFIG_INVALID, 'agents.toml must be a table');
  }

  assertDependencyTable((parsed as Record<string, unknown>)['dependencies']);

  const manifest = await readManifest(projectRoot);
  if (!manifest) {
    throw new TerrazulError(ErrorCode.CONFIG_INVALID, 'Failed to parse agents.toml');
  }

  return {
    manifest,
    dependencies: manifest.dependencies ?? {},
  };
}
