import { existsSync, readFileSync } from 'node:fs';

import {
  getConfigPath,
  getEffectiveToken,
  loadConfig,
  normalizeConfig,
  saveConfig,
  updateConfig,
} from './config.js';
import { createLogger } from './logger.js';
import { RegistryClient } from '../core/registry-client.js';
import { StorageManager } from '../core/storage.js';
import { DEFAULT_ENVIRONMENTS } from '../types/config.js';

import type { Logger } from './logger.js';
import type { UserConfig } from '../types/config.js';

export interface CreateContextOptions {
  verbose?: boolean;
}

export interface RegistryClientAPI {
  getPackageInfo: (name: string) => Promise<unknown>;
}

export interface StorageAPI {
  getPackagePath: (name: string, version: string) => string;
}

export interface ResolverStub {
  resolve: () => Promise<'ok'>;
}

export interface ConfigAPI {
  load: () => Promise<UserConfig>;
  save: (cfg: UserConfig) => Promise<void>;
  update: (patch: Partial<UserConfig>) => Promise<UserConfig>;
  path: () => string;
  getToken: (cfg?: UserConfig) => string | undefined;
}

export interface CLIContext {
  logger: Logger;
  config: ConfigAPI;
  registry: RegistryClient;
  storage: StorageManager;
  resolver: ResolverStub;
}

export function createCLIContext(opts: CreateContextOptions = {}): CLIContext {
  const logger = createLogger({ verbose: opts.verbose });

  // Read config synchronously to derive registry and token; fall back to defaults
  let initialRegistry: string = DEFAULT_ENVIRONMENTS.production.registry;
  let initialToken: string | undefined;
  try {
    const cfgPath = getConfigPath();
    if (existsSync(cfgPath)) {
      const raw = readFileSync(cfgPath, 'utf8');
      const parsed = normalizeConfig(JSON.parse(raw));
      const activeEnv = parsed.environments?.[parsed.environment];
      if (activeEnv?.registry) {
        initialRegistry = activeEnv.registry;
      } else if (parsed.registry) {
        initialRegistry = parsed.registry;
      }
      initialToken = getEffectiveToken(parsed);
    } else {
      initialToken = getEffectiveToken();
    }
    // Allow env override for convenience in tests
    if (process.env.TERRAZUL_REGISTRY) {
      initialRegistry = process.env.TERRAZUL_REGISTRY;
    }
  } catch {
    initialToken = getEffectiveToken();
  }

  const configAPI: ConfigAPI = {
    load: () => loadConfig(),
    save: (cfg) => saveConfig(cfg),
    update: (patch) => updateConfig(patch),
    path: () => getConfigPath(),
    getToken: (cfg?: UserConfig) => getEffectiveToken(cfg),
  };

  const registry = new RegistryClient({
    registryUrl: initialRegistry,
    token: initialToken,
  });

  const storage = new StorageManager();

  const resolver: ResolverStub = {
    resolve() {
      logger.debug('Resolver stub resolve');
      return Promise.resolve('ok' as const);
    },
  };

  return { logger, config: configAPI, registry, storage, resolver };
}
