import { existsSync, readFileSync } from 'node:fs';

import {
  getConfigPath,
  getEffectiveToken,
  loadConfig,
  normalizeConfig,
  saveConfig,
  updateConfig,
  type SaveConfigOptions,
} from './config.js';
import { createLogger } from './logger.js';
import { createTelemetry, type Telemetry } from './telemetry.js';
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
  save: (cfg: UserConfig, opts?: SaveConfigOptions) => Promise<void>;
  update: (patch: Partial<UserConfig>, opts?: SaveConfigOptions) => Promise<UserConfig>;
  path: () => string;
  getToken: (cfg?: UserConfig) => string | undefined;
}

export interface CLIContext {
  logger: Logger;
  config: ConfigAPI;
  registry: RegistryClient;
  storage: StorageManager;
  resolver: ResolverStub;
  telemetry: Telemetry;
}

export function createCLIContext(opts: CreateContextOptions = {}): CLIContext {
  let parsedConfig: UserConfig | undefined;
  const cfgPath = getConfigPath();
  if (existsSync(cfgPath)) {
    try {
      const raw = readFileSync(cfgPath, 'utf8');
      parsedConfig = normalizeConfig(JSON.parse(raw));
    } catch {
      parsedConfig = undefined;
    }
  }

  let initialRegistry: string = DEFAULT_ENVIRONMENTS.production.registry;
  if (parsedConfig) {
    const activeEnv = parsedConfig.environments?.[parsedConfig.environment];
    if (activeEnv?.registry) {
      initialRegistry = activeEnv.registry;
    } else if (parsedConfig.registry) {
      initialRegistry = parsedConfig.registry;
    }
  }

  if (process.env.TERRAZUL_REGISTRY) {
    initialRegistry = process.env.TERRAZUL_REGISTRY;
  }

  const initialToken = getEffectiveToken(parsedConfig);

  const logger = createLogger({
    verbose: opts.verbose,
    accessibility: parsedConfig?.accessibility,
  });

  const telemetry = createTelemetry(parsedConfig?.telemetry ?? false, (message) => {
    if (logger.isVerbose()) {
      logger.debug(message);
    }
  });

  const configAPI: ConfigAPI = {
    load: () => loadConfig(),
    save: (cfg, saveOpts) => saveConfig(cfg, saveOpts),
    update: (patch, saveOpts) => updateConfig(patch, saveOpts),
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

  return { logger, config: configAPI, registry, storage, resolver, telemetry };
}
