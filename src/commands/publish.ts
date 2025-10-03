import path from 'node:path';

import { buildPublishPlan, createTarball } from '../core/publisher';

import type { CLIContext } from '../utils/context';
import type { Command } from 'commander';

export function registerPublishCommand(
  program: Command,
  createCtx: (opts: { verbose?: boolean }) => CLIContext,
): void {
  program
    .command('publish')
    .description('Validate and publish a package to the registry')
    .option('--dry-run', 'Validate and print plan without uploading', false)
    .action(async (opts: { dryRun?: boolean }) => {
      const g = program.opts<{ verbose?: boolean }>();
      const ctx = createCtx({ verbose: g.verbose });
      const root = process.cwd();
      try {
        const plan = await buildPublishPlan(root);
        if (opts.dryRun) {
          ctx.logger.info(`publish (dry-run): ${plan.name}@${plan.version}`);
          ctx.logger.info(`files (${plan.files.length}):`);
          for (const f of plan.files) ctx.logger.info(` - ${f}`);
          ctx.logger.info(`size ~${plan.sizeEstimate} bytes (pre-gzip)`);
          return;
        }

        // Build tarball
        const tarball = await createTarball(root, plan.files);

        // Submit to registry
        const { getCliVersion } = await import('../utils/version.js');
        const meta = {
          cliVersion: getCliVersion(),
          cwd: path.basename(root),
          name: plan.name,
          version: plan.version,
        };
        const res = await ctx.registry.publishPackage(plan.name, tarball, meta);
        ctx.logger.info(`Published ${plan.name}@${res.version}`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        ctx.logger.error(`publish failed: ${msg}`);
        process.exitCode = 1;
      }
    });
}
