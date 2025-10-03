import packageJson from '../../package.json';
import { listSupportedTargets, prefetchSeaTargets } from '../runtime/sea-fetcher';

import type { CLIContext } from '../utils/context';
import type { Command } from 'commander';

function parseTargets(raw?: string): string[] | undefined {
  if (!raw) return undefined;
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function registerCacheCommand(
  program: Command,
  createCtx: (opts: { verbose?: boolean }) => CLIContext,
): void {
  const cache = program.command('cache').description('Cache management commands');

  cache
    .command('prefetch')
    .description('Download SEA binaries into the local cache for offline use')
    .option('--cli-version <semver>', 'Override CLI version to prefetch')
    .option('--targets <list>', 'Comma-separated list of targets to prefetch')
    .option('--base-url <url>', 'Override base URL for SEA downloads')
    .option('--manifest <path>', 'Path to manifest.json (defaults to packaged manifest)')
    .option('--cache-dir <path>', 'Override cache directory (defaults to ~/.terrazul/cache/sea)')
    .action(
      async (options: {
        cliVersion?: string;
        targets?: string;
        baseUrl?: string;
        manifest?: string;
        cacheDir?: string;
      }) => {
        const globalOptions = program.opts<{ verbose?: boolean }>();
        const ctx = createCtx({ verbose: globalOptions.verbose });

        const requestedTargets = parseTargets(options.targets);
        const supportedTargets = new Set(listSupportedTargets());
        const selectedTargets = requestedTargets?.filter((target) => supportedTargets.has(target));
        const invalidTargets = requestedTargets?.filter((target) => !supportedTargets.has(target));

        if (invalidTargets && invalidTargets.length > 0) {
          ctx.logger.warn(`Ignoring unsupported targets: ${invalidTargets.join(', ')}`);
        }

        const cliVersion = options.cliVersion ?? packageJson.version;

        const results = await prefetchSeaTargets({
          cliVersion,
          cacheDir: options.cacheDir,
          manifestPath: options.manifest,
          baseUrlOverride: options.baseUrl,
          targets: selectedTargets && selectedTargets.length > 0 ? selectedTargets : undefined,
        });

        const entries = Object.entries(results);
        if (entries.length === 0) {
          ctx.logger.info('No SEA binaries were prefetched (targets may already be cached).');
          return;
        }

        ctx.logger.info('Prefetched SEA binaries:');
        for (const [target, location] of entries) {
          ctx.logger.info(`  ${target}: ${location}`);
        }
      },
    );
}
