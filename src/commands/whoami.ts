import { AuthService } from '../core/auth/service.js';

import type { CLIContext } from '../utils/context.js';
import type { Command } from 'commander';

function formatRelative(expiryIso: string): { display: string; daysRemaining?: number } {
  const expiresAt = new Date(expiryIso);
  if (Number.isNaN(expiresAt.getTime())) {
    return { display: expiryIso };
  }
  const now = Date.now();
  const diffMs = expiresAt.getTime() - now;
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  return {
    display: `${expiresAt.toISOString()} (${
      days >= 0 ? `in ${days} day${days === 1 ? '' : 's'}` : 'expired'
    })`,
    daysRemaining: days,
  };
}

export function registerWhoamiCommand(
  program: Command,
  createCtx: (opts: { verbose?: boolean }) => CLIContext,
): void {
  program
    .command('whoami')
    .description('Show the authenticated user profile')
    .addHelpText(
      'after',
      '\nDisplays token metadata, warns when expiration is near, and honors TERRAZUL_TOKEN.\n',
    )
    .action(async () => {
      const opts = program.opts<{ verbose?: boolean }>();
      const ctx = createCtx({ verbose: opts.verbose });

      const config = await ctx.config.load();
      const token = ctx.config.getToken(config);
      if (!token) {
        console.warn("\nNot authenticated. Run 'tz login' to authenticate.");
        return;
      }

      const usingEnv = Boolean(process.env.TERRAZUL_TOKEN);
      if (usingEnv) {
        console.log('Using TERRAZUL_TOKEN environment variable for authentication.');
      }

      try {
        // Verify token is still valid by calling /auth/v1/me
        const authService = new AuthService({ baseUrl: config.registry });
        const result = await authService.getAuthenticatedUser(token);

        // Display user info from API response
        console.log(`Logged in as: @${result.user.username}`);
        if (result.user.email) {
          console.log(`Email: ${result.user.email}`);
        }

        // Display token metadata from local config
        // Check both environment-specific and global config
        const activeEnv = config.environment;
        const envConfig = config.environments?.[activeEnv];
        const tokenCreatedAt = envConfig?.tokenCreatedAt ?? config.tokenCreatedAt;
        const tokenExpiresAt = envConfig?.tokenExpiresAt ?? config.tokenExpiresAt;

        if (tokenCreatedAt) {
          const created = new Date(tokenCreatedAt);
          if (!Number.isNaN(created.getTime())) {
            console.log(`Token created: ${created.toISOString()}`);
          }
        }

        if (tokenExpiresAt) {
          const expiryInfo = formatRelative(tokenExpiresAt);
          console.log(`Token expires: ${expiryInfo.display}`);

          if (expiryInfo.daysRemaining !== undefined && expiryInfo.daysRemaining < 7) {
            if (expiryInfo.daysRemaining < 0) {
              console.warn('Token has expired. Please log in again.');
            } else {
              console.warn(
                `Token expiring soon (in ${expiryInfo.daysRemaining} day${
                  expiryInfo.daysRemaining === 1 ? '' : 's'
                }). Consider refreshing.`,
              );
            }
          }
        }
      } catch (error) {
        const message =
          error instanceof Error && error.message.length > 0
            ? error.message
            : 'Failed to fetch authentication details.';
        console.error(`${message}`);
        process.exitCode = 1;
      }
    });
}
