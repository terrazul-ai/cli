import path from 'node:path';

import { readManifest, validateManifest } from '../utils/manifest';

import type { CLIContext } from '../utils/context';
import type { Command } from 'commander';

export function registerValidateCommand(
  program: Command,
  createCtx: (opts: { verbose?: boolean }) => CLIContext,
): void {
  program
    .command('validate')
    .description('Validate package structure and configuration')
    .action(async () => {
      const opts = program.opts<{ verbose?: boolean }>();
      const ctx = createCtx({ verbose: opts.verbose });
      const cwd = process.cwd();
      const manifest = await readManifest(cwd);
      if (!manifest) {
        ctx.logger.error(`No agents.toml found at ${path.join(cwd, 'agents.toml')}`);
        process.exitCode = 1;
        return;
      }

      const { warnings, errors } = await validateManifest(cwd, manifest);

      for (const w of warnings) ctx.logger.warn(w);
      if (errors.length > 0) {
        for (const e of errors) ctx.logger.error(e);
        process.exitCode = 1;
        return;
      }

      ctx.logger.info('Manifest is valid');
    });
}
