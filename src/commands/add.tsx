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
import type { ResolvedPackage } from '../core/dependency-resolver.js';

type LockfilePackageEntry = ReturnType<typeof LockfileManager.merge>['packages'][string];
type AddSpec = { name: string; range: string };

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
        await ensureVersionNotYanked(ctx, parsed);

        const { updates, addedNames } = await resolveAndInstallPackages({
          ctx,
          projectDir,
          resolver,
          spec: parsed,
        });

        const updated = LockfileManager.merge(existingLock, updates);
        LockfileManager.write(updated, projectDir);
        ctx.logger.info('Add complete');

        await maybeAssignProfile(ctx, projectDir, profileName, parsed.name);
        await applyTemplatesIfEnabled(ctx, projectDir, addedNames, raw);
      } catch (error) {
        const err = error as TerrazulError | Error;
        ctx.logger.error(
          err instanceof TerrazulError ? err.toUserMessage() : String(err.message || err),
        );
        process.exitCode = err instanceof TerrazulError ? err.getExitCode() : 1;
      }
    });
}

async function ensureVersionNotYanked(ctx: CLIContext, spec: AddSpec): Promise<void> {
  const versionsInfo = await ctx.registry.getPackageVersions(spec.name);
  const exact = versionsInfo.versions[spec.range];
  if (exact && exact.yanked) {
    throw new TerrazulError(
      ErrorCode.VERSION_YANKED,
      `Version ${spec.range} of ${spec.name} is yanked`,
    );
  }
}

async function resolveAndInstallPackages(options: {
  ctx: CLIContext;
  projectDir: string;
  resolver: DependencyResolver;
  spec: AddSpec;
}): Promise<{ updates: Record<string, LockfilePackageEntry>; addedNames: string[] }> {
  const { ctx, projectDir, resolver, spec } = options;
  const { resolved, warnings } = await resolver.resolve({ [spec.name]: spec.range });
  for (const warning of warnings) ctx.logger.warn(warning);

  const updates: Record<string, LockfilePackageEntry> = {};
  const addedNames: string[] = [];
  for (const [pkgName, info] of resolved) {
    ctx.logger.info(`Adding ${pkgName}@${info.version} ...`);
    updates[pkgName] = await installPackage(ctx, projectDir, pkgName, info);
    addedNames.push(pkgName);
  }

  return { updates, addedNames };
}

async function installPackage(
  ctx: CLIContext,
  projectDir: string,
  pkgName: string,
  info: ResolvedPackage,
): Promise<LockfilePackageEntry> {
  const tarInfo = await ctx.registry.getTarballInfo(pkgName, info.version);
  const tarball = await ctx.registry.downloadTarball(tarInfo.url);
  ctx.storage.store(tarball);

  const tmpFile = createTempTarballPath();
  await fs.writeFile(tmpFile, tarball);
  try {
    await ctx.storage.extractTarball(tmpFile, pkgName, info.version);
  } finally {
    await safeRemove(tmpFile);
  }

  const storePath = ctx.storage.getPackagePath(pkgName, info.version);
  const linkPath = getSafeLinkPath(projectDir, pkgName);
  ensureDir(path.dirname(linkPath));
  await createSymlink(storePath, linkPath);

  const integrity = LockfileManager.createIntegrityHash(tarball);
  return {
    version: info.version,
    resolved: tarInfo.url,
    integrity,
    dependencies: info.dependencies,
    yanked: false,
  };
}

function createTempTarballPath(): string {
  return path.join(os.tmpdir(), `tz-${Date.now()}-${Math.random().toString(16).slice(2)}.tgz`);
}

async function safeRemove(filePath: string): Promise<void> {
  try {
    await fs.rm(filePath, { force: true });
  } catch {
    // ignore cleanup failures
  }
}

async function maybeAssignProfile(
  ctx: CLIContext,
  projectDir: string,
  profileName: string | undefined,
  packageName: string,
): Promise<void> {
  if (!profileName) return;

  const added = await addPackageToProfile(projectDir, profileName, packageName);
  if (added) {
    ctx.logger.info(`Added ${packageName} to profile '${profileName}' in agents.toml`);
  } else {
    ctx.logger.warn(
      `Profile update skipped: unable to add ${packageName} under profile '${profileName}'`,
    );
  }
}

async function applyTemplatesIfEnabled(
  ctx: CLIContext,
  projectDir: string,
  packageNames: string[],
  rawOptions: Record<string, unknown>,
): Promise<void> {
  if (!shouldApplyTemplates(rawOptions) || packageNames.length === 0) return;

  const { onSnippetEvent, cleanup } = createAskAgentUI(ctx);
  const agentModulesRoot = path.join(projectDir, 'agent_modules');
  try {
    for (const name of packageNames) {
      const res = await planAndRender(projectDir, agentModulesRoot, {
        packageName: name,
        force: Boolean(rawOptions['applyForce']),
        dryRun: false,
        onSnippetEvent,
      });
      ctx.logger.info(`apply: wrote ${res.written.length} files for ${name}`);
      if (res.backedUp.length > 0) {
        for (const backup of res.backedUp) ctx.logger.info(`backup: ${backup}`);
      }
      for (const skipped of res.skipped) {
        ctx.logger.warn(`skipped: ${skipped.dest} (${skipped.reason})`);
      }
    }
  } finally {
    cleanup();
  }
}

function shouldApplyTemplates(rawOptions: Record<string, unknown>): boolean {
  return rawOptions['apply'] !== false;
}

function createAskAgentUI(ctx: CLIContext): {
  onSnippetEvent: (progress: SnippetProgress) => void;
  cleanup: () => void;
} {
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
        const taskId = event.snippet.id;

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

  const cleanup = (): void => {
    if (inkInstance !== null) {
      const instance: Instance = inkInstance;
      instance.unmount();
      inkInstance = null;
    }
    activeTasks.clear();
  };

  return { onSnippetEvent, cleanup };
}
