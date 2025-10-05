import { login as loginUtil, logout as logoutUtil } from '../utils/auth.js';

import type { CLIContext } from '../utils/context.js';
import type { Command } from 'commander';

export function registerAuthCommand(
  program: Command,
  createCtx: (opts: { verbose?: boolean }) => CLIContext,
): void {
  const auth = program.command('auth').description('Authentication commands');

  auth
    .command('login')
    .description('Login using a Personal Access Token (tz_...)')
    .option('--token <token>', 'Personal Access Token (tz_...)')
    .option('--username <name>', 'Optional username to associate')
    .action(async (options: { token?: string; username?: string }) => {
      const opts = program.opts<{ verbose?: boolean }>();
      const ctx = createCtx({ verbose: opts.verbose });
      await loginUtil({ token: options.token, username: options.username, logger: ctx.logger });
    });

  auth
    .command('logout')
    .description('Logout and clear saved tokens')
    .action(async () => {
      const opts = program.opts<{ verbose?: boolean }>();
      const ctx = createCtx({ verbose: opts.verbose });
      await logoutUtil({ logger: ctx.logger });
    });
}
