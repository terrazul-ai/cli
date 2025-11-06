import { AuthService } from '../core/auth/service.js';
import { logout as logoutUtil } from '../utils/auth.js';

import type { CLIContext } from '../utils/context.js';
import type { Command } from 'commander';

export function registerLogoutCommand(
  program: Command,
  createCtx: (opts: { verbose?: boolean }) => CLIContext,
): void {
  program
    .command('logout')
    .description('Logout and clear saved credentials')
    .addHelpText(
      'after',
      '\nRevokes the active token remotely before clearing local config data.\n',
    )
    .action(async () => {
      const opts = program.opts<{ verbose?: boolean }>();
      const ctx = createCtx({ verbose: opts.verbose });

      const config = await ctx.config.load();
      const token = ctx.config.getToken(config);
      if (!token) {
        ctx.logger.info('[logout] Not currently logged in.');
        return;
      }

      const usingEnv = Boolean(process.env.TERRAZUL_TOKEN);
      const authService = new AuthService({ baseUrl: config.registry });

      // Get tokenId from config
      const activeEnv = config.environment;
      const envConfig = config.environments?.[activeEnv];
      const tokenId = envConfig?.tokenId ?? config.tokenId;

      try {
        if (tokenId) {
          // Revoke using stored token ID
          await authService.revokeToken(token, tokenId);
          ctx.logger.info('[logout] Revoked token.');
        } else {
          // Fallback: revoke by token value when tokenId not stored
          ctx.logger.warn('[logout] No tokenId stored; using fallback revocation by token value.');
          await authService.revokeTokenByValue(token);
          ctx.logger.info('[logout] Revoked token.');
        }
      } catch (error) {
        const message =
          error instanceof Error && error.message
            ? error.message
            : 'Failed to revoke token remotely.';
        ctx.logger.warn(`[logout] ${message} Clearing local credentials regardless.`);
      }

      await logoutUtil({ logger: ctx.logger });

      if (usingEnv) {
        ctx.logger.warn(
          '[logout] Cleared local credentials, but TERRAZUL_TOKEN remains set in your environment.',
        );
      } else {
        ctx.logger.info('[logout] Logged out successfully.');
      }
    });
}
