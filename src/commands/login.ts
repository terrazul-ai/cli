import os from 'node:os';

import { runInteractiveLogin, LoginFlowError } from '../core/auth/interactive-login.js';
import { AuthService } from '../core/auth/service.js';
import { login as loginUtil } from '../utils/auth.js';
import { ConfigPermissionError } from '../utils/config.js';

import type { CLIContext } from '../utils/context.js';
import type { Command } from 'commander';

function toEpochSeconds(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return undefined;
  return Math.floor(ms / 1000);
}

export function registerLoginCommand(
  program: Command,
  createCtx: (opts: { verbose?: boolean }) => CLIContext,
): void {
  program
    .command('login')
    .description('Authenticate with Terrazul')
    .option('--token <token>', 'Personal Access Token (tz_...)')
    .option('--username <name>', 'Optional username to associate when using --token')
    .addHelpText(
      'after',
      `
Examples:
  tz login
  tz login --token tz_example --username alice

Accessibility:
  Configure ~/.terrazul/config.json [accessibility] to enable large text or audio feedback.

Telemetry:
  Set "telemetry": true in config to emit login flow events (no token values recorded).
`,
    )
    .action(async (options: { token?: string; username?: string }) => {
      const opts = program.opts<{ verbose?: boolean }>();
      const ctx = createCtx({ verbose: opts.verbose });
      if (options.token) {
        await loginUtil({ token: options.token, username: options.username, logger: ctx.logger });
        return;
      }

      const config = await ctx.config.load();
      const registryBase = config.registry;
      try {
        const authService = new AuthService({ baseUrl: registryBase });
        const result = await runInteractiveLogin({
          logger: ctx.logger,
          authService,
          hostname: os.hostname(),
          input: process.stdin,
          output: process.stdout,
          telemetry: ctx.telemetry,
        });

        const expirySeconds = toEpochSeconds(result.expiresAt);

        const activeEnv = config.environment;
        const envRecord = { ...config.environments };
        const currentEnv = envRecord[activeEnv] ?? { registry: registryBase };
        envRecord[activeEnv] = {
          ...currentEnv,
          registry: currentEnv.registry ?? registryBase,
          token: result.token,
          tokenId: result.tokenId,
          tokenExpiry: expirySeconds,
          tokenCreatedAt: result.createdAt,
          tokenExpiresAt: result.expiresAt,
          username: result.user.username,
          user: result.user,
        };

        await ctx.config.save(
          {
            ...config,
            token: result.token,
            tokenId: result.tokenId,
            tokenExpiry: expirySeconds,
            tokenCreatedAt: result.createdAt,
            tokenExpiresAt: result.expiresAt,
            username: result.user.username,
            user: result.user,
            environments: envRecord,
          },
          { logger: ctx.logger },
        );

        console.log(`\n\n✅ Logged in as @${result.user.username}.`);
        ctx.logger.debug(`[login] Token expires ${result.expiresAt}.`);
      } catch (error) {
        if (error instanceof LoginFlowError) {
          ctx.logger.error(error.message);
          process.exitCode = error.exitCode;
          return;
        }
        if (error instanceof ConfigPermissionError) {
          ctx.logger.error(error.message);
          process.exitCode = error.exitCode;
          return;
        }
        const message =
          error instanceof Error && error.message.length > 0
            ? error.message
            : 'Unexpected error during login.';
        ctx.logger.error(message);
        process.exitCode = 1;
      }
    });
}
