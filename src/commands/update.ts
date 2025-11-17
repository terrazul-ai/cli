import path from 'node:path';

import { DependencyResolver } from '../core/dependency-resolver.js';
import { TerrazulError } from '../core/errors.js';
import { LockfileManager } from '../core/lock-file.js';
import { PackageManager } from '../core/package-manager.js';
import { planAndRender } from '../core/template-renderer.js';
import { injectTZMdReference } from '../utils/context-file-injector.js';
import { readManifest } from '../utils/manifest.js';
import { regenerateTZMdFromAgentModules } from '../utils/tz-md-generator.js';

import type { CLIContext } from '../utils/context.js';
import type { Command } from 'commander';

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

            // Regenerate TZ.md from all packages (including unchanged ones)
            await regenerateTZMdFromAgentModules(projectDir);
            ctx.logger.info('Regenerated .terrazul/TZ.md');

            // Inject @-mention of TZ.md into CLAUDE.md and AGENTS.md
            const claudeMd = path.join(projectDir, 'CLAUDE.md');
            const agentsMd = path.join(projectDir, 'AGENTS.md');

            const claudeResult = await injectTZMdReference(claudeMd, projectDir);
            if (claudeResult.modified) {
              ctx.logger.info('Injected TZ.md reference into CLAUDE.md');
            }

            const agentsResult = await injectTZMdReference(agentsMd, projectDir);
            if (agentsResult.modified) {
              ctx.logger.info('Injected TZ.md reference into AGENTS.md');
            }
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
