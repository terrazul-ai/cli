import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import React from 'react';
import { render } from 'ink';

import { DependencyResolver } from '../core/dependency-resolver.js';
import { ErrorCode, TerrazulError } from '../core/errors.js';
import { LockfileManager } from '../core/lock-file.js';
import { planAndRender } from '../core/template-renderer.js';
import { createSymlink, ensureDir } from '../utils/fs.js';
import { addPackageToProfile } from '../utils/manifest.js';
import { agentModulesPath } from '../utils/path.js';
import { generateAskAgentSummary } from '../utils/ask-agent-summary.js';
import { AskAgentSpinner, type AskAgentTask } from '../ui/apply/AskAgentSpinner.js';

import type { SnippetProgress } from '../core/template-renderer.js';
import type { CLIContext } from '../utils/context.js';
import type { Command } from 'commander';
import type { Instance } from 'ink';

/**
 * parseSpec extracts package name and version range from a spec string.
 * Supports three formats:
 * 1. @owner/pkg@1.0.0 → { name: '@owner/pkg', range: '1.0.0' }
 * 2. @owner/pkg@latest → { name: '@owner/pkg', range: 'latest' }
 * 3. @owner/pkg → { name: '@owner/pkg', range: null }
 */
export function parseSpec(spec?: string): { name: string; range: string | null } | null {
  if (!spec) return null;

  // Match scoped packages: @scope/name[@version]
  const scopedMatch = spec.match(/^(@[^@]+\/[^@]+)(?:@(.+))?$/);
  if (scopedMatch) {
    return {
      name: scopedMatch[1],
      range: scopedMatch[2] || null,
    };
  }

  // Match unscoped packages: name[@version]
  const unscopedMatch = spec.match(/^([^@]+)(?:@(.+))?$/);
  if (unscopedMatch) {
    return {
      name: unscopedMatch[1],
      range: unscopedMatch[2] || null,
    };
  }

  return null;
}

/**
 * Compute a safe link path in agent_modules for the package name.
 */
function getSafeLinkPath(projectDir: string, pkgName: string): string {
  try {
    return agentModulesPath(projectDir, pkgName);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new TerrazulError(ErrorCode.SECURITY_VIOLATION, msg);
  }
}

/**
 * Resolves the version range to use for installation.
 * Handles three cases:
 * 1. Explicit version: use as-is and check if yanked
 * 2. @latest tag: fetch latest and proceed
 * 3. null (no version): fetch latest, check if already installed
 */
async function resolveVersionRange(
  parsed: { name: string; range: string | null },
  ctx: CLIContext,
  existingLock: ReturnType<typeof LockfileManager.read>,
): Promise<{ rangeToResolve: string; shouldSkip: boolean }> {
  // Case 1: Explicit version specified
  if (parsed.range !== null && parsed.range !== 'latest') {
    const versionsInfo = await ctx.registry.getPackageVersions(parsed.name);
    const exact = versionsInfo.versions[parsed.range];
    if (exact && exact.yanked) {
      throw new TerrazulError(
        ErrorCode.VERSION_YANKED,
        `Version ${parsed.range} of ${parsed.name} is yanked`,
      );
    }
    return { rangeToResolve: parsed.range, shouldSkip: false };
  }

  // Case 2 & 3: Fetch latest version for null or 'latest'
  const packageInfo = await ctx.registry.getPackageInfo(parsed.name);
  const latestVersion = packageInfo.latest;

  // Check if latest version is yanked
  const versionsInfo = await ctx.registry.getPackageVersions(parsed.name);
  const latestVersionInfo = versionsInfo.versions[latestVersion];

  if (latestVersionInfo && latestVersionInfo.yanked) {
    throw new TerrazulError(
      ErrorCode.VERSION_YANKED,
      `Latest version ${latestVersion} of ${parsed.name} is yanked${
        latestVersionInfo.yankedReason ? `: ${latestVersionInfo.yankedReason}` : ''
      }`,
    );
  }

  // Case 3: No version specified - check if already installed
  if (parsed.range === null) {
    const existingPackage = existingLock?.packages[parsed.name];
    if (existingPackage) {
      ctx.logger.info(`${parsed.name}@${existingPackage.version} is already installed`);
      return { rangeToResolve: '', shouldSkip: true };
    }
  }

  // Use caret range for flexibility (^X.Y.Z)
  ctx.logger.info(`Installing ${parsed.name}@${latestVersion} ...`);
  return { rangeToResolve: `^${latestVersion}`, shouldSkip: false };
}

/**
 * Downloads and installs a single package.
 */
async function installPackage(
  pkgName: string,
  info: { version: string; dependencies: Record<string, string> },
  ctx: CLIContext,
  projectDir: string,
): Promise<{
  integrity: string;
  tarInfo: { url: string };
}> {
  ctx.logger.info(`Adding ${pkgName}@${info.version} ...`);

  // Download tarball
  const tarInfo = await ctx.registry.getTarballInfo(pkgName, info.version);
  const tarball = await ctx.registry.downloadTarball(tarInfo.url);
  ctx.storage.store(tarball);

  // Extract to temporary file
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

  // Create symlink
  const storePath = ctx.storage.getPackagePath(pkgName, info.version);
  const linkPath = getSafeLinkPath(projectDir, pkgName);
  ensureDir(path.dirname(linkPath));
  await createSymlink(storePath, linkPath);

  // Compute integrity hash
  const integrity = LockfileManager.createIntegrityHash(tarball);

  return { integrity, tarInfo };
}

/**
 * Creates the Ink spinner renderer for askAgent operations.
 */
function createSpinnerRenderer(
  activeTasks: Map<string, AskAgentTask>,
  isTTY: boolean,
): {
  render: () => void;
  getInstance: () => Instance | null;
  setInstance: (instance: Instance | null) => void;
} {
  let inkInstance: Instance | null = null;

  return {
    render: () => {
      if (!isTTY) return;

      const tasks = Array.from(activeTasks.values());
      if (tasks.length === 0) {
        if (inkInstance !== null) {
          inkInstance.unmount();
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
    },
    getInstance: () => inkInstance,
    setInstance: (instance: Instance | null) => {
      inkInstance = instance;
    },
  };
}

/**
 * Creates the snippet event handler for askAgent operations.
 */
function createSnippetEventHandler(
  activeTasks: Map<string, AskAgentTask>,
  renderSpinner: () => void,
  ctx: CLIContext,
  isTTY: boolean,
): (progress: SnippetProgress) => void {
  return ({ event }: SnippetProgress): void => {
    switch (event.type) {
      case 'askAgent:start': {
        const taskId = event.snippet.id;

        // Skip duplicate tasks
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

          // Generate summary asynchronously
          void generateAskAgentSummary(event.prompt).then((summary) => {
            const existingTask = activeTasks.get(taskId);
            if (existingTask && existingTask.status === 'running') {
              existingTask.title = summary;
              renderSpinner();
            }
          });
        } else {
          ctx.logger.info('Running askAgent snippet...');
        }
        break;
      }
      case 'askAgent:end': {
        const taskId = event.snippet.id;
        const task = activeTasks.get(taskId);

        if (task) {
          task.status = 'complete';
          if (isTTY) {
            renderSpinner();
          } else {
            ctx.logger.info('askAgent complete.');
          }
        } else if (!isTTY) {
          ctx.logger.info('askAgent complete.');
        }
        break;
      }
      case 'askAgent:error': {
        const taskId = event.snippet.id;

        if (taskId) {
          const task = activeTasks.get(taskId);
          if (task) {
            task.status = 'error';
            task.error = event.error.message;
            if (isTTY) {
              renderSpinner();
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
}

/**
 * Renders templates for added packages using the apply system.
 */
async function renderTemplatesForPackages(
  addedNames: string[],
  projectDir: string,
  ctx: CLIContext,
  options: { force: boolean; dryRun: boolean },
): Promise<void> {
  const activeTasks = new Map<string, AskAgentTask>();
  const isTTY = process.stdout.isTTY ?? false;

  const spinner = createSpinnerRenderer(activeTasks, isTTY);
  const onSnippetEvent = createSnippetEventHandler(activeTasks, spinner.render, ctx, isTTY);

  const agentModulesRoot = path.join(projectDir, 'agent_modules');
  for (const name of addedNames) {
    const res = await planAndRender(projectDir, agentModulesRoot, {
      packageName: name,
      force: options.force,
      dryRun: options.dryRun,
      onSnippetEvent,
    });
    ctx.logger.info(`apply: wrote ${res.written.length} files for ${name}`);
    if (res.backedUp.length > 0) {
      for (const b of res.backedUp) ctx.logger.info(`backup: ${b}`);
    }
    for (const s of res.skipped) ctx.logger.warn(`skipped: ${s.dest} (${s.reason})`);
  }

  // Clean up Ink instance
  const instance = spinner.getInstance();
  if (instance !== null) {
    instance.unmount();
  }
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
        // Step 1: Resolve version range
        const { rangeToResolve, shouldSkip } = await resolveVersionRange(parsed, ctx, existingLock);

        if (shouldSkip) {
          process.exitCode = 0;
          return;
        }

        // Step 2: Resolve dependencies
        const { resolved, warnings } = await resolver.resolve({
          [parsed.name]: rangeToResolve,
        });
        for (const w of warnings) ctx.logger.warn(w);

        // Step 3: Install packages
        const updates: Record<
          string,
          ReturnType<typeof LockfileManager.merge>['packages'][string]
        > = {};
        const addedNames: string[] = [];

        for (const [pkgName, info] of resolved) {
          const { integrity, tarInfo } = await installPackage(pkgName, info, ctx, projectDir);

          updates[pkgName] = {
            version: info.version,
            resolved: tarInfo.url,
            integrity,
            dependencies: info.dependencies,
            yanked: false,
          };
          addedNames.push(pkgName);
        }

        // Step 4: Update lockfile
        const updated = LockfileManager.merge(existingLock, updates);
        LockfileManager.write(updated, projectDir);
        ctx.logger.info('Add complete');

        // Step 5: Add to profile if requested
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

        // Step 6: Render templates if enabled
        const applyEnabled = raw['apply'] !== false; // --no-apply sets apply=false
        if (applyEnabled) {
          await renderTemplatesForPackages(addedNames, projectDir, ctx, {
            force: Boolean(raw['applyForce']),
            dryRun: false,
          });
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
