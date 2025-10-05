import path from 'node:path';

import { planAndRender } from '../core/template-renderer.js';

import type { CLIContext } from '../utils/context.js';
import type { Command } from 'commander';

export function registerApplyCommand(
  program: Command,
  createCtx: (opts: { verbose?: boolean }) => CLIContext,
): void {
  program
    .command('apply')
    .argument('[package]', 'Optional package name to apply only that package')
    .description('Render installed templates into actual config files (CLAUDE.md, .claude, etc.)')
    .option('--force', 'Overwrite existing destination files', false)
    .option('--dry-run', 'Plan without writing any files', false)
    .option('--profile <profile>', 'Apply only the packages associated with the given profile')
    .action(
      async (
        _pkg: string | undefined,
        opts: { force?: boolean; dryRun?: boolean; profile?: string },
      ) => {
        const g = program.opts<{ verbose?: boolean }>();
        const ctx = createCtx({ verbose: g.verbose });
        const projectRoot = process.cwd();
        const agentModulesRoot = path.join(projectRoot, 'agent_modules');
        const profileName = typeof opts.profile === 'string' ? opts.profile.trim() : undefined;

        try {
          if (_pkg && profileName) {
            ctx.logger.error('Cannot combine package argument with --profile');
            process.exitCode = 1;
            return;
          }

          const res = await planAndRender(projectRoot, agentModulesRoot, {
            force: opts.force,
            dryRun: opts.dryRun,
            packageName: _pkg,
            profileName,
          });
          if (opts.dryRun) {
            ctx.logger.info(`apply (dry-run): would write ${res.written.length} files`);
          } else {
            ctx.logger.info(`apply: wrote ${res.written.length} files`);
          }
          if (res.backedUp.length > 0) {
            for (const b of res.backedUp) ctx.logger.info(`backup: ${b}`);
          }
          if (res.skipped.length > 0) {
            for (const s of res.skipped) ctx.logger.warn(`skipped: ${s.dest} (${s.reason})`);
          }
        } catch (error) {
          ctx.logger.error(
            error instanceof Error ? error.message : `apply failed: ${String(error)}`,
          );
          process.exitCode = 1;
        }
      },
    );
}
