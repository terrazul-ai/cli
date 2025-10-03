import type { CLIContext } from '../utils/context';
import type { Command } from 'commander';

export function registerUnlinkCommand(
  program: Command,
  createCtx: (opts: { verbose?: boolean }) => CLIContext,
): void {
  program
    .command('unlink')
    .argument('<pkg>', 'Package name to unlink from current project')
    .description('Remove a dev link for a local package')
    .action((pkg: string) => {
      const opts = program.opts<{ verbose?: boolean }>();
      const ctx = createCtx({ verbose: opts.verbose });
      ctx.logger.info(`unlink (stub): ${pkg}`);
    });
}
