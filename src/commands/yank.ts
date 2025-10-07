import type { CLIContext } from '../utils/context.js';
import type { Command } from 'commander';

export function registerYankCommand(
  program: Command,
  createCtx: (opts: { verbose?: boolean }) => CLIContext,
): void {
  program
    .command('yank')
    .argument('<spec>', 'Package version to yank, e.g., @pkg@1.0.0')
    .description('Yank or unyank a published package version')
    .option('--unyank', 'Unyank instead of yank')
    .action(() => {
      const opts = program.opts<{ verbose?: boolean }>();
      const ctx = createCtx({ verbose: opts.verbose });
      ctx.logger.info('yank: stub — not implemented yet');
    });
}
