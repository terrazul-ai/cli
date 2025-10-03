import { logout as logoutUtil } from '../utils/auth';

import type { CLIContext } from '../utils/context';
import type { Command } from 'commander';
export function registerLogoutCommand(
  program: Command,
  createCtx: (opts: { verbose?: boolean }) => CLIContext,
): void {
  program
    .command('logout')
    .description('Logout and clear saved credentials')
    .action(async () => {
      const opts = program.opts<{ verbose?: boolean }>();
      const ctx = createCtx({ verbose: opts.verbose });
      await logoutUtil({ logger: ctx.logger });
    });
}
