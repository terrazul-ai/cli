import { URL } from 'node:url';

import type { EnvironmentConfig, EnvironmentName, UserConfig } from '../types/config';
import type { CLIContext } from '../utils/context';
import type { Command } from 'commander';

interface UseEnvOptions {
  registry?: string;
}

function validateRegistryUrl(raw?: string): string | undefined {
  if (!raw) return undefined;
  const url = new URL(raw);
  const isLoopback = ['localhost', '127.0.0.1'].some(
    (host) => url.hostname === host || url.hostname.startsWith('127.'),
  );
  if (url.protocol !== 'https:' && !isLoopback) {
    throw new Error(`Registry URL must use https:// (got ${url.protocol}//)`);
  }
  return url.toString().replace(/\/$/, '');
}

function formatEnvLine(name: string, env: EnvironmentConfig, active: boolean): string {
  const status = active ? '*' : ' ';
  const tokenStatus = env.token ? 'token' : 'no-token';
  return `${status} ${name.padEnd(12)} ${env.registry} (${tokenStatus})`;
}

function ensureEnvironment(
  cfg: UserConfig,
  name: EnvironmentName,
  defaults?: Partial<EnvironmentConfig>,
): EnvironmentConfig {
  const existing = cfg.environments[name];
  if (existing) {
    cfg.environments[name] = { ...existing, ...defaults };
    return cfg.environments[name];
  }
  const registry = defaults?.registry;
  if (!registry) {
    throw new Error(
      `Environment "${name}" is not defined. Provide --registry to create it, e.g. tz env use ${name} --registry <url>`,
    );
  }
  cfg.environments[name] = {
    registry,
    token: defaults?.token,
    tokenExpiry: defaults?.tokenExpiry,
    username: defaults?.username,
  };
  return cfg.environments[name];
}

function switchEnvironment(cfg: UserConfig, name: string, env: EnvironmentConfig): UserConfig {
  return {
    ...cfg,
    environment: name,
    registry: env.registry,
    token: env.token,
    tokenExpiry: env.tokenExpiry,
    username: env.username,
  };
}

export function registerEnvCommand(
  program: Command,
  createCtx: (opts: { verbose?: boolean }) => CLIContext,
): void {
  const env = program.command('env').description('Manage Terrazul registry environments');

  env
    .command('list')
    .description('List configured environments')
    .action(async () => {
      const opts = program.opts<{ verbose?: boolean }>();
      const ctx = createCtx({ verbose: opts.verbose });
      const cfg = await ctx.config.load();
      const entries = Object.entries(cfg.environments ?? {});
      if (entries.length === 0) {
        ctx.logger.info('No environments configured.');
        return;
      }
      ctx.logger.info('Environments ("*" = active):');
      for (const [name, envConfig] of entries.sort(([a], [b]) => a.localeCompare(b))) {
        ctx.logger.info(formatEnvLine(name, envConfig, cfg.environment === name));
      }
    });

  env
    .command('current')
    .description('Show the active environment details')
    .action(async () => {
      const opts = program.opts<{ verbose?: boolean }>();
      const ctx = createCtx({ verbose: opts.verbose });
      const cfg = await ctx.config.load();
      const active = cfg.environments[cfg.environment];
      if (!active) {
        ctx.logger.warn(`Active environment "${cfg.environment}" is missing from config.`);
        return;
      }
      ctx.logger.info(`Active environment: ${cfg.environment}`);
      ctx.logger.info(`Registry: ${active.registry}`);
      ctx.logger.info(`Token: ${active.token ? 'configured' : 'not set'}`);
      if (active.username) {
        ctx.logger.info(`Username: ${active.username}`);
      }
    });

  env
    .command('use')
    .argument('<name>', 'Environment name to activate')
    .description('Switch active environment, optionally overriding the registry URL')
    .option('--registry <url>', 'Override or create the environment with a registry URL')
    .action(async (name: string, options: UseEnvOptions) => {
      const opts = program.opts<{ verbose?: boolean }>();
      const ctx = createCtx({ verbose: opts.verbose });
      const cfg = await ctx.config.load();
      const registry = validateRegistryUrl(options.registry);
      const envConfig = ensureEnvironment(cfg, name, registry ? { registry } : undefined);
      if (registry) envConfig.registry = registry;
      const next = switchEnvironment(cfg, name, envConfig);
      await ctx.config.save(next);
      ctx.logger.info(`Environment set to ${name} (${envConfig.registry}).`);
    });

  env
    .command('set')
    .argument('<name>', 'Environment name to create or update')
    .argument('<registry>', 'Registry base URL (https://...)')
    .description('Create or update an environment registry without switching')
    .action(async (name: string, registry: string) => {
      const opts = program.opts<{ verbose?: boolean }>();
      const ctx = createCtx({ verbose: opts.verbose });
      const cfg = await ctx.config.load();
      const normalizedRegistry = validateRegistryUrl(registry);
      if (!normalizedRegistry) {
        throw new Error('Registry URL is required');
      }
      const envConfig = ensureEnvironment(cfg, name, { registry: normalizedRegistry });
      envConfig.registry = normalizedRegistry ?? envConfig.registry;
      await ctx.config.save(cfg);
      ctx.logger.info(`Environment ${name} set to ${envConfig.registry}.`);
    });
}
