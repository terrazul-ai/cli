import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { DependencyResolver } from '../core/dependency-resolver';
import { ErrorCode, TerrazulError } from '../core/errors';
import { LockfileManager } from '../core/lock-file';
import { planAndRender } from '../core/template-renderer';
import { createSymlink, ensureDir } from '../utils/fs';
import { addPackageToProfile } from '../utils/manifest';
import { agentModulesPath } from '../utils/path';

import type { CLIContext } from '../utils/context';
import type { Command } from 'commander';

function parseSpec(spec?: string): { name: string; range: string } | null {
  if (!spec) return null;
  const m = spec.match(/^(@[^@]+?)@([^@]+)$/) || spec.match(/^([^@]+)@([^@]+)$/);
  if (!m) return null;
  return { name: m[1], range: m[2] };
}

// Compute a safe link path in agent_modules for the package name.
function getSafeLinkPath(projectDir: string, pkgName: string): string {
  try {
    return agentModulesPath(projectDir, pkgName);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new TerrazulError(ErrorCode.SECURITY_VIOLATION, msg);
  }
}

export function registerInstallCommand(
  program: Command,
  createCtx: (opts: { verbose?: boolean }) => CLIContext,
): void {
  program
    .command('install')
    .argument('[spec]', 'Package spec like @scope/name@1.0.0 or with range')
    .description('Resolve, download, verify, extract, and link packages')
    .option('--no-apply', 'Do not render templates after install')
    .option('--apply-force', 'Overwrite existing files when applying templates', false)
    .option(
      '--profile <profile>',
      'Assign the installed package to the given profile in agents.toml',
    )
    .action(async (_spec: string | undefined, raw: Record<string, unknown>) => {
      const opts = program.opts<{ verbose?: boolean }>();
      const ctx = createCtx({ verbose: opts.verbose });
      const projectDir = process.cwd();

      const parsed = parseSpec(_spec);
      if (!parsed) {
        ctx.logger.error('Please provide a spec like @scope/name@1.0.0');
        process.exitCode = 1;
        return;
      }

      const profileName = typeof raw['profile'] === 'string' ? raw['profile'].trim() : undefined;

      const existingLock = LockfileManager.read(projectDir);
      const resolver = new DependencyResolver(ctx.registry, {
        lockfile: existingLock,
        logger: ctx.logger,
      });
      try {
        // If exact version specified, ensure not yanked
        const versionsInfo = await ctx.registry.getPackageVersions(parsed.name);
        const exact = versionsInfo.versions[parsed.range];
        if (exact && exact.yanked) {
          throw new TerrazulError(
            ErrorCode.VERSION_YANKED,
            `Version ${parsed.range} of ${parsed.name} is yanked`,
          );
        }

        const { resolved, warnings } = await resolver.resolve({ [parsed.name]: parsed.range });
        for (const w of warnings) ctx.logger.warn(w);

        const updates: Record<
          string,
          ReturnType<typeof LockfileManager.merge>['packages'][string]
        > = {};
        const installedNames: string[] = [];
        for (const [pkgName, info] of resolved) {
          ctx.logger.info(`Installing ${pkgName}@${info.version} ...`);
          const tarInfo = await ctx.registry.getTarballInfo(pkgName, info.version);
          const tarball = await ctx.registry.downloadTarball(tarInfo.url);
          ctx.storage.store(tarball);

          const tmpFile = path.join(
            os.tmpdir(),
            `tz-${Date.now()}-${Math.random().toString(16).slice(2)}.tgz`,
          );
          await fs.writeFile(tmpFile, tarball);
          try {
            await ctx.storage.extractTarball(tmpFile, pkgName, info.version);
          } finally {
            try {
              await fs.rm(tmpFile, { force: true });
            } catch {
              /* ignore */
            }
          }

          const storePath = ctx.storage.getPackagePath(pkgName, info.version);
          const linkPath = getSafeLinkPath(projectDir, pkgName);
          ensureDir(path.dirname(linkPath));
          await createSymlink(storePath, linkPath);

          const integrity = LockfileManager.createIntegrityHash(tarball);
          updates[pkgName] = {
            version: info.version,
            resolved: tarInfo.url,
            integrity,
            dependencies: info.dependencies,
            yanked: false,
          };
          installedNames.push(pkgName);
        }

        const updated = LockfileManager.merge(existingLock, updates);
        LockfileManager.write(updated, projectDir);
        ctx.logger.info('Install complete');

        if (profileName) {
          const added = await addPackageToProfile(projectDir, profileName, parsed.name);
          if (added) {
            ctx.logger.info(`Added ${parsed.name} to profile '${profileName}' in agents.toml`);
          } else {
            ctx.logger.warn(
              `Profile update skipped: unable to add ${parsed.name} under profile '${profileName}'`,
            );
          }
        }

        // Optionally render templates after install
        const applyEnabled = raw['apply'] !== false; // --no-apply sets apply=false
        if (applyEnabled) {
          const agentModulesRoot = path.join(projectDir, 'agent_modules');
          for (const name of installedNames) {
            const res = await planAndRender(projectDir, agentModulesRoot, {
              packageName: name,
              force: Boolean(raw['applyForce']),
              dryRun: false,
            });
            ctx.logger.info(`apply: wrote ${res.written.length} files for ${name}`);
            if (res.backedUp.length > 0) {
              for (const b of res.backedUp) ctx.logger.info(`backup: ${b}`);
            }
            for (const s of res.skipped) ctx.logger.warn(`skipped: ${s.dest} (${s.reason})`);
          }
        }
      } catch (error) {
        const err = error as TerrazulError | Error;
        ctx.logger.error(
          err instanceof TerrazulError ? err.toUserMessage() : String(err.message || err),
        );
        process.exitCode = err instanceof TerrazulError ? err.getExitCode() : 1;
      }
    });
}
