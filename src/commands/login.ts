import { login as loginUtil } from '../utils/auth.js';

import type { CLIContext } from '../utils/context.js';
import type { Command } from 'commander';
export function registerLoginCommand(
  program: Command,
  createCtx: (opts: { verbose?: boolean }) => CLIContext,
): void {
  program
    .command('login')
    .description('Login using a Personal Access Token (tz_...)')
    .option('--token <token>', 'Personal Access Token (tz_...)')
    .option('--username <name>', 'Optional username to associate')
    .action(async (options: { token?: string; username?: string }) => {
      const opts = program.opts<{ verbose?: boolean }>();
      const ctx = createCtx({ verbose: opts.verbose });
      await loginUtil({ token: options.token, username: options.username, logger: ctx.logger });
    });
}
