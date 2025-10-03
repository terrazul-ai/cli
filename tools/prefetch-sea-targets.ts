#!/usr/bin/env tsx

import { Command } from 'commander';

import { listSupportedTargets, prefetchSeaTargets } from '../src/runtime/sea-fetcher';

const program = new Command();

program
  .name('prefetch-sea-targets')
  .description('Prefetch SEA binaries into the local cache using a manifest override')
  .option('--manifest <path>', 'Path to manifest.json', process.env.TERRAZUL_SEA_MANIFEST)
  .option('--targets <list>', 'Comma-separated list of targets to prefetch')
  .option('--cache-dir <path>', 'Override cache directory')
  .action(async (options: { manifest?: string; targets?: string; cacheDir?: string }) => {
    const supportedTargets = new Set(listSupportedTargets());
    const targets = options.targets
      ?.split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    const validTargets = targets?.filter((target) => supportedTargets.has(target));
    const invalidTargets = targets?.filter((target) => !supportedTargets.has(target));

    if (invalidTargets && invalidTargets.length > 0) {
      console.warn(`Ignoring unsupported targets: ${invalidTargets.join(', ')}`);
    }

    const result = await prefetchSeaTargets({
      manifestPath: options.manifest,
      cacheDir: options.cacheDir,
      targets: validTargets && validTargets.length > 0 ? validTargets : undefined,
    });

    if (Object.keys(result).length === 0) {
      console.log('No SEA binaries were prefetched; cache may already contain all targets.');
      return;
    }

    console.log('Prefetched SEA binaries:');
    for (const [target, resolvedPath] of Object.entries(result)) {
      console.log(`  ${target}: ${resolvedPath}`);
    }
  });

program.parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
