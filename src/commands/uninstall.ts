import { promises as fs } from 'node:fs';
import path from 'node:path';

import { LockfileManager } from '../core/lock-file.js';
import { removeSymlinks } from '../integrations/symlink-manager.js';
import { injectPackageContext, type PackageInfo } from '../utils/context-file-injector.js';
import { exists, remove } from '../utils/fs.js';
import {
  readManifest,
  removeDependenciesFromManifest,
  removePackageFromProfiles,
} from '../utils/manifest.js';
import { agentModulesPath } from '../utils/path.js';
import { computeRemovalSet, listDependents } from '../utils/prune.js';

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

export function registerUninstallCommand(
  program: Command,
  createCtx: (opts: { verbose?: boolean }) => CLIContext,
): void {
  program
    .command('uninstall')
    .argument('<pkg>', 'Package to remove from agent_modules/')
    .description('Remove an installed package and update references')
    .action(async (pkg: string) => {
      const opts = program.opts<{ verbose?: boolean }>();
      const ctx = createCtx({ verbose: opts.verbose });
      const projectDir = process.cwd();

      let agentPath: string;
      try {
        agentPath = agentModulesPath(projectDir, pkg);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        ctx.logger.error(msg);
        process.exitCode = 1;
        return;
      }

      try {
        const manifest = await readManifest(projectDir);
        const dependencies = new Set(Object.keys(manifest?.dependencies ?? {}));
        dependencies.delete(pkg);

        const lock = LockfileManager.read(projectDir);
        const targets = new Set<string>([pkg]);
        if (lock) {
          const dependents = listDependents(lock.packages, pkg).filter(
            (name) => !targets.has(name),
          );
          if (dependents.length > 0) {
            ctx.logger.error(
              `Cannot uninstall ${pkg}; it is still required by installed packages: ${dependents.join(
                ', ',
              )}`,
            );
            process.exitCode = 1;
            return;
          }
        }

        const manifestChanged = await removeDependenciesFromManifest(projectDir, [pkg]);
        const profilesChanged = await removePackageFromProfiles(projectDir, pkg);

        const linkExisted = exists(agentPath);
        await remove(agentPath);

        let lockUpdated = false;
        let removedFromLock: string[] = [];
        if (lock) {
          const removalSet = computeRemovalSet(lock.packages, targets, dependencies);
          if (removalSet.size > 0) {
            const removalList = [...removalSet];
            const hadEntries = removalList.some((name) =>
              Object.prototype.hasOwnProperty.call(lock.packages, name),
            );
            if (hadEntries) {
              removedFromLock = removalList;
              const updated = LockfileManager.remove(lock, removalList);
              LockfileManager.write(updated, projectDir);
              lockUpdated = true;
            }
          }
        }

        if (lockUpdated) {
          for (const name of removedFromLock) {
            try {
              const modPath = agentModulesPath(projectDir, name);
              if (exists(modPath)) {
                await remove(modPath);
              }
            } catch {
              // Ignore invalid package names coming from lockfile (should not happen in practice).
            }
          }
        }

        if (linkExisted) {
          ctx.logger.info(`Removed agent_modules entry for ${pkg}`);
        }
        if (lockUpdated) {
          ctx.logger.info(
            `Updated agents-lock.toml (removed ${removedFromLock.sort().join(', ')})`,
          );
        }
        if (manifestChanged || profilesChanged) {
          ctx.logger.info('Updated agents.toml');
        }
        if (!linkExisted && removedFromLock.length === 0 && !manifestChanged) {
          ctx.logger.info(`${pkg} was not installed; nothing to do.`);
        } else {
          ctx.logger.info('Uninstall complete');

          // Remove symlinks for this package
          const symlinkResult = await removeSymlinks(projectDir, pkg);
          if (symlinkResult.removed.length > 0) {
            ctx.logger.info(
              `Removed ${symlinkResult.removed.length} symlink(s) from .claude/ directories`,
            );
            if (ctx.logger.isVerbose()) {
              for (const link of symlinkResult.removed) {
                const relPath = path.relative(projectDir, link);
                ctx.logger.debug(`  ${relPath}`);
              }
            }
          }

          if (symlinkResult.errors.length > 0) {
            for (const err of symlinkResult.errors) {
              ctx.logger.warn(`Failed to remove symlink: ${err.path} - ${err.error}`);
            }
          }

          // Inject package context from remaining packages
          const { packageFiles, packageInfos } =
            await collectPackageFilesFromAgentModules(projectDir);

          const claudeMd = path.join(projectDir, 'CLAUDE.md');
          const agentsMd = path.join(projectDir, 'AGENTS.md');

          const claudeResult = await injectPackageContext(
            claudeMd,
            projectDir,
            packageFiles,
            packageInfos,
          );
          if (claudeResult.modified) {
            ctx.logger.info('Injected package context into CLAUDE.md');
          }

          const agentsResult = await injectPackageContext(
            agentsMd,
            projectDir,
            packageFiles,
            packageInfos,
          );
          if (agentsResult.modified) {
            ctx.logger.info('Injected package context into AGENTS.md');
          }
        }
      } catch (error) {
        ctx.logger.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });
}
