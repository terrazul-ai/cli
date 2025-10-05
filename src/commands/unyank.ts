import type { CLIContext } from '../utils/context.js';
import type { Command } from 'commander';

export function registerUnyankCommand(
  program: Command,
  createCtx: (opts: { verbose?: boolean }) => CLIContext,
): void {
  program
    .command('unyank')
    .argument('<spec>', 'Package spec to unyank, e.g., @pkg@1.0.0')
    .description('Reverse a yank operation for a previously yanked version')
    .action((spec: string) => {
      const opts = program.opts<{ verbose?: boolean }>();
      const ctx = createCtx({ verbose: opts.verbose });
      ctx.logger.info(`unyank (stub): ${spec}`);
    });
}
