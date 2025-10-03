import { LockfileManager } from '../core/lock-file';
import { exists, remove } from '../utils/fs';
import {
  readManifest,
  removeDependenciesFromManifest,
  removePackageFromProfiles,
} from '../utils/manifest';
import { agentModulesPath } from '../utils/path';
import { computeRemovalSet, listDependents } from '../utils/prune';

import type { CLIContext } from '../utils/context';
import type { Command } from 'commander';

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
        }
      } catch (error) {
        ctx.logger.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });
}
