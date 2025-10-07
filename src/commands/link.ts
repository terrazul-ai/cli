import type { CLIContext } from '../utils/context.js';
import type { Command } from 'commander';

export function registerLinkCommand(
  program: Command,
  createCtx: (opts: { verbose?: boolean }) => CLIContext,
): void {
  program
    .command('link')
    .argument('[pkg]', 'Optional package name to link in current project')
    .description('Link local package for development, or link into current project')
    .hideHelp()
    .action((pkg: string | undefined) => {
      const opts = program.opts<{ verbose?: boolean }>();
      const ctx = createCtx({ verbose: opts.verbose });
      ctx.logger.info(`link (stub): ${pkg ?? '(register globally)'}`);
    });
}
