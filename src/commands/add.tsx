import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import React from 'react';
import { render } from 'ink';

import { DependencyResolver } from '../core/dependency-resolver.js';
import { ErrorCode, TerrazulError } from '../core/errors.js';
import { LockfileManager } from '../core/lock-file.js';
import { PackageManager } from '../core/package-manager.js';
import { planAndRender } from '../core/template-renderer.js';
import { addPackageToProfile } from '../utils/manifest.js';
import { generateAskAgentSummary } from '../utils/ask-agent-summary.js';
import { AskAgentSpinner, type AskAgentTask } from '../ui/apply/AskAgentSpinner.js';

import type { SnippetProgress } from '../core/template-renderer.js';
import type { CLIContext } from '../utils/context.js';
import type { Command } from 'commander';
import type { Instance } from 'ink';

function parseSpec(spec?: string): { name: string; range: string } | null {
  if (!spec) return null;
  const m = spec.match(/^(@[^@]+?)@([^@]+)$/) || spec.match(/^([^@]+)@([^@]+)$/);
  if (!m) return null;
  return { name: m[1], range: m[2] };
}

export function registerAddCommand(
  program: Command,
  createCtx: (opts: { verbose?: boolean }) => CLIContext,
): void {
  program
    .command('add')
    .argument('[spec]', 'Package spec like @scope/name@1.0.0 or with range')
    .description('Resolve, download, verify, extract, and link packages')
    .option('--no-apply', 'Do not render templates after add')
    .option('--apply-force', 'Overwrite existing files when applying templates', false)
    .option('--profile <profile>', 'Assign the added package to the given profile in agents.toml')
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
        const addedNames: string[] = [];
        const packageManager = new PackageManager(ctx);

        for (const [pkgName, info] of resolved) {
          ctx.logger.info(`Adding ${pkgName}@${info.version} ...`);

          const { integrity, tarballBuffer } = await packageManager.installSinglePackage(
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
          addedNames.push(pkgName);
        }

        const updated = LockfileManager.merge(existingLock, updates);
        LockfileManager.write(updated, projectDir);
        ctx.logger.info('Add complete');

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

        // Optionally render templates after add
        const applyEnabled = raw['apply'] !== false; // --no-apply sets apply=false
        if (applyEnabled) {
          // Task management for Ink spinner
          const activeTasks = new Map<string, AskAgentTask>();
          let inkInstance: Instance | null = null;
          const isTTY = process.stdout.isTTY ?? false;

          const renderSpinner = (): void => {
            if (!isTTY) return;

            const tasks = Array.from(activeTasks.values());
            if (tasks.length === 0) {
              if (inkInstance !== null) {
                const instance: Instance = inkInstance;
                instance.unmount();
                inkInstance = null;
              }
              return;
            }

            if (inkInstance !== null) {
              inkInstance.rerender(<AskAgentSpinner tasks={tasks} />);
            } else {
              inkInstance = render(<AskAgentSpinner tasks={tasks} />, {
                stdout: process.stdout,
                stdin: process.stdin,
                exitOnCtrlC: false,
              });
            }
          };

          const onSnippetEvent = ({ event }: SnippetProgress): void => {
            switch (event.type) {
              case 'askAgent:start': {
                // Use stable task ID based on snippet ID to prevent duplicates
                const taskId = event.snippet.id;

                // If this task already exists, skip creating a duplicate
                if (activeTasks.has(taskId)) {
                  if (ctx.logger.isVerbose()) {
                    ctx.logger.info(`[add] Skipping duplicate askAgent task: ${taskId}`);
                  }
                  return;
                }

                const task: AskAgentTask = {
                  id: taskId,
                  title: 'Processing...',
                  status: 'running',
                };

                activeTasks.set(taskId, task);

                if (isTTY) {
                  renderSpinner();

                  // Generate summary asynchronously and update when ready
                  void generateAskAgentSummary(event.prompt).then((summary) => {
                    const existingTask = activeTasks.get(taskId);
                    if (existingTask && existingTask.status === 'running') {
                      existingTask.title = summary;
                      renderSpinner();
                    }
                  });
                } else {
                  // Non-TTY: just log the start
                  ctx.logger.info('Running askAgent snippet...');
                }
                break;
              }
              case 'askAgent:end': {
                // Use same stable task ID to find the exact task
                const taskId = event.snippet.id;
                const task = activeTasks.get(taskId);

                if (task) {
                  task.status = 'complete';
                  if (isTTY) {
                    renderSpinner();
                    // Keep completed task visible to show progress
                  } else {
                    ctx.logger.info('askAgent complete.');
                  }
                } else if (!isTTY) {
                  ctx.logger.info('askAgent complete.');
                }
                break;
              }
              case 'askAgent:error': {
                // Use same stable task ID to find the exact task
                const taskId = event.snippet.id;

                if (taskId) {
                  const task = activeTasks.get(taskId);
                  if (task) {
                    task.status = 'error';
                    task.error = event.error.message;
                    if (isTTY) {
                      renderSpinner();
                      // Keep error visible to show what failed
                    } else {
                      ctx.logger.warn(`askAgent failed: ${event.error.message}`);
                    }
                  }
                } else if (!isTTY) {
                  ctx.logger.warn(`askAgent failed: ${event.error.message}`);
                }
                break;
              }
              default: {
                break;
              }
            }
          };

          const agentModulesRoot = path.join(projectDir, 'agent_modules');
          const allPackageFiles = new Map<string, string[]>();

          for (const name of addedNames) {
            const res = await planAndRender(projectDir, agentModulesRoot, {
              packageName: name,
              force: Boolean(raw['applyForce']),
              dryRun: false,
              onSnippetEvent,
            });
            ctx.logger.info(`apply: wrote ${res.written.length} files for ${name}`);
            if (res.backedUp.length > 0) {
              for (const b of res.backedUp) ctx.logger.info(`backup: ${b}`);
            }
            for (const s of res.skipped) ctx.logger.warn(`skipped: ${s.dest} (${s.reason})`);

            // Collect packageFiles for post-render tasks
            if (res.packageFiles) {
              for (const [pkgName, files] of res.packageFiles) {
                allPackageFiles.set(pkgName, files);
              }
            }
          }

          // Inject @-mentions and create symlinks
          if (allPackageFiles.size > 0) {
            const { executePostRenderTasks } = await import('../utils/post-render-tasks.js');
            await executePostRenderTasks(projectDir, allPackageFiles, ctx.logger);
          }

          // Clean up Ink instance
          if (inkInstance !== null) {
            const instance: Instance = inkInstance;
            instance.unmount();
            inkInstance = null;
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
