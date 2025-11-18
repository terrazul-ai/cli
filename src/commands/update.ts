import { promises as fs } from 'node:fs';
import path from 'node:path';

import { DependencyResolver } from '../core/dependency-resolver.js';
import { TerrazulError } from '../core/errors.js';
import { LockfileManager } from '../core/lock-file.js';
import { PackageManager } from '../core/package-manager.js';
import { planAndRender } from '../core/template-renderer.js';
import { type PackageInfo } from '../utils/context-file-injector.js';
import { readManifest } from '../utils/manifest.js';

import type { CLIContext } from '../utils/context.js';
import type { Command } from 'commander';

/**
 * Helper to scan agent_modules and build packageFiles map for context injection
 */
async function collectPackageFilesFromAgentModules(projectRoot: string): Promise<{
  packageFiles: Map<string, string[]>;
  packageInfos: PackageInfo[];
}> {
  const agentModules = path.join(projectRoot, 'agent_modules');
  const packageFiles = new Map<string, string[]>();
  const packageInfos: PackageInfo[] = [];

  try {
    const entries = await fs.readdir(agentModules, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      // Handle scoped packages (e.g., @scope/)
      if (entry.name.startsWith('@')) {
        const scopeDir = path.join(agentModules, entry.name);
        const pkgs = await fs.readdir(scopeDir, { withFileTypes: true });

        for (const pkg of pkgs) {
          if (!pkg.isDirectory()) continue;

          const pkgName = `${entry.name}/${pkg.name}`;
          const pkgRoot = path.join(scopeDir, pkg.name);

          // Collect rendered files recursively
          const files = await collectFilesRecursively(pkgRoot);
          if (files.length > 0) {
            packageFiles.set(pkgName, files);

            // Read manifest for version info
            const manifest = await readManifest(pkgRoot);
            packageInfos.push({
              name: pkgName,
              version: manifest?.package?.version,
              root: pkgRoot,
            });
          }
        }
      } else {
        // Unscoped package
        const pkgName = entry.name;
        const pkgRoot = path.join(agentModules, pkgName);

        // Collect rendered files recursively
        const files = await collectFilesRecursively(pkgRoot);
        if (files.length > 0) {
          packageFiles.set(pkgName, files);

          // Read manifest for version info
          const manifest = await readManifest(pkgRoot);
          packageInfos.push({
            name: pkgName,
            version: manifest?.package?.version,
            root: pkgRoot,
          });
        }
      }
    }
  } catch {
    // agent_modules doesn't exist or can't be read
  }

  return { packageFiles, packageInfos };
}

/**
 * Recursively collect files from a directory
 */
async function collectFilesRecursively(dir: string): Promise<string[]> {
  const files: string[] = [];

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Recursively collect files from subdirectories
        const subFiles = await collectFilesRecursively(fullPath);
        files.push(...subFiles);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  return files;
}

export function registerUpdateCommand(
  program: Command,
  createCtx: (opts: { verbose?: boolean }) => CLIContext,
): void {
  program
    .command('update')
    .argument('[pkg]', 'Optional package to update')
    .option('--dry-run', 'Preview updates without applying')
    .option('--no-apply', 'Do not render templates after update')
    .option('--apply-force', 'Overwrite existing files when applying templates', false)
    .description('Update to highest compatible non-yanked versions')
    .action(
      async (
        pkg: string | undefined,
        opts: { dryRun?: boolean; apply?: boolean; applyForce?: boolean },
      ) => {
        const progOpts = program.opts<{ verbose?: boolean }>();
        const ctx = createCtx({ verbose: progOpts.verbose });
        const projectDir = process.cwd();

        const lockfile = LockfileManager.read(projectDir);
        if (!lockfile) {
          ctx.logger.error('No lockfile found');
          process.exitCode = 1;
          return;
        }

        const roots: Record<string, string> = {};
        if (pkg) {
          // Constrain only the requested package to its current major
          const locked = lockfile.packages[pkg];
          if (!locked) {
            ctx.logger.error(`Package ${pkg} not found in lockfile`);
            process.exitCode = 1;
            return;
          }
          roots[pkg] = `^${locked.version}`;
        } else {
          // Prefer manifest dependencies as top-level roots
          const manifest = await readManifest(projectDir);
          if (manifest?.dependencies && Object.keys(manifest.dependencies).length > 0) {
            for (const [name, range] of Object.entries(manifest.dependencies)) {
              roots[name] = range;
            }
          } else {
            // Fallback: infer roots as packages that are not depended upon by others
            const all = lockfile.packages;
            const dependedUpon = new Set<string>();
            for (const info of Object.values(all)) {
              for (const depName of Object.keys(info.dependencies || {})) {
                dependedUpon.add(depName);
              }
            }
            for (const name of Object.keys(all)) {
              if (!dependedUpon.has(name)) {
                roots[name] = `^${all[name].version}`;
              }
            }
          }
        }

        // During update we intentionally ignore the existing lockfile preference order
        // to allow upgrading to the highest compatible versions.
        const resolver = new DependencyResolver(ctx.registry, {
          lockfile: undefined,
          logger: ctx.logger,
          preferLatest: true,
        });

        try {
          const { resolved, warnings } = await resolver.resolve(roots);
          for (const w of warnings) {
            ctx.logger.warn(w);
          }

          const plan: Array<{ name: string; from?: string; to: string }> = [];
          for (const [name, info] of resolved) {
            const current = lockfile.packages[name]?.version;
            if (current !== info.version) {
              plan.push({ name, from: current, to: info.version });
            }
          }

          if (opts.dryRun) {
            if (plan.length === 0) ctx.logger.info('All packages up to date');
            for (const p of plan) {
              ctx.logger.info(`${p.name}: ${p.from ?? 'none'} -> ${p.to}`);
            }
            return;
          }

          const updates: Record<
            string,
            ReturnType<typeof LockfileManager.merge>['packages'][string]
          > = {};
          const changed: string[] = [];
          const packageManager = new PackageManager(ctx);

          for (const [pkgName, info] of resolved) {
            const current = lockfile.packages[pkgName]?.version;
            if (current === info.version) continue; // skip unchanged
            ctx.logger.info(`Updating ${pkgName} to ${info.version}`);

            const { integrity } = await packageManager.installSinglePackage(
              projectDir,
              pkgName,
              info.version,
            );

            const tarInfo = await ctx.registry.getTarballInfo(pkgName, info.version);
            updates[pkgName] = {
              version: info.version,
              resolved: tarInfo.url,
              integrity,
              dependencies: info.dependencies,
              yanked: false,
            };
            changed.push(pkgName);
          }

          const updated = LockfileManager.merge(lockfile, updates);
          LockfileManager.write(updated, projectDir);
          ctx.logger.info('Update complete');

          // Optionally render templates for changed packages
          const applyEnabled = opts.apply !== false; // --no-apply sets false
          if (applyEnabled && changed.length > 0) {
            const agentModulesRoot = path.join(projectDir, 'agent_modules');
            for (const name of changed) {
              const res = await planAndRender(projectDir, agentModulesRoot, {
                packageName: name,
                force: Boolean(opts.applyForce),
                dryRun: false,
              });
              ctx.logger.info(`apply: wrote ${res.written.length} files for ${name}`);
              for (const s of res.skipped) ctx.logger.warn(`skipped: ${s.dest} (${s.reason})`);
            }

            // Inject package context from all packages (including unchanged ones)
            const { packageFiles, packageInfos } =
              await collectPackageFilesFromAgentModules(projectDir);

            // Inject @-mentions and create symlinks
            const { executePostRenderTasks } = await import('../utils/post-render-tasks.js');
            await executePostRenderTasks(projectDir, packageFiles, ctx.logger, packageInfos);
          }
        } catch (error) {
          const err = error as TerrazulError | Error;
          ctx.logger.error(
            err instanceof TerrazulError ? err.toUserMessage() : String(err.message || err),
          );
          process.exitCode = err instanceof TerrazulError ? err.getExitCode() : 1;
        }
      },
    );
}
