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

      // Try to get tokenId from config first
      const activeEnv = config.environment;
      const envConfig = config.environments?.[activeEnv];
      let tokenId = envConfig?.tokenId ?? config.tokenId;

      try {
        // If we don't have a stored tokenId, try to fetch it
        if (!tokenId) {
          ctx.logger.debug('[logout] No stored token ID found; fetching from API.');
          const tokenDetails = await authService.getCurrentTokenDetails(token);
          tokenId = tokenDetails.id;
        }

        if (tokenId) {
          try {
            // Revoke using token ID
            await authService.revokeToken(token, tokenId);
            ctx.logger.info(`[logout] Revoked token.`);
          } catch (error) {
            const message =
              error instanceof Error && error.message
                ? error.message
                : 'Failed to revoke token remotely.';
            ctx.logger.warn(`[logout] ${message} Clearing local credentials regardless.`);
          }
        } else {
          ctx.logger.warn('[logout] Could not determine token ID; skipping remote revocation.');
        }
      } catch (error) {
        const message =
          error instanceof Error && error.message
            ? error.message
            : 'Could not get token details before logout.';
        ctx.logger.warn(`[logout] ${message} Proceeding to clear local credentials.`);
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
