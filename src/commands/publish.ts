import { buildPublishPlan, createTarball } from '../core/publisher';

import type { Command } from 'commander';
import type { CLIContext } from '../utils/context.js';

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

        // Read full manifest for metadata
        const { readManifest } = await import('../utils/manifest.js');
        const manifest = await readManifest(root);
        if (!manifest?.package) {
          throw new Error('Invalid manifest: missing package section');
        }

        // Prepare publish metadata matching Go API's PublishMetadata struct
        const metadata = {
          name: plan.name,
          version: plan.version,
          description: manifest.package.description,
          homepage: manifest.package.homepage,
          repository: manifest.package.repository,
          documentation: manifest.package.documentation,
          license: manifest.package.license,
          keywords: manifest.package.keywords,
          authors: manifest.package.authors,
          is_private: manifest.package.is_private ?? false,
        };

        const res = await ctx.registry.publishPackage(plan.name, tarball, metadata);
        ctx.logger.info(`Published ${plan.name}@${res.version}`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        ctx.logger.error(`publish failed: ${msg}`);
        process.exitCode = 1;
      }
    });
}
