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
import {
  aggregateMCPConfigs,
  generateMCPConfigFile,
  cleanupMCPConfig,
  spawnClaudeCode,
} from '../integrations/claude-code.js';
import { createSymlinks } from '../integrations/symlink-manager.js';
import { ensureDir } from '../utils/fs.js';
import { addOrUpdateDependency, readManifest } from '../utils/manifest.js';
import { agentModulesPath, isFilesystemPath, resolvePathSpec } from '../utils/path.js';
import { normalizeToolOption } from '../utils/tool-options.js';
import { generateAskAgentSummary } from '../utils/ask-agent-summary.js';
import { injectPackageContext, type PackageInfo } from '../utils/context-file-injector.js';
import { AskAgentSpinner, type AskAgentTask } from '../ui/apply/AskAgentSpinner.js';

import type { SnippetProgress } from '../core/template-renderer.js';
import type { CLIContext } from '../utils/context.js';
import type { Command } from 'commander';
import type { Instance } from 'ink';

/**
 * Parse package spec like @scope/name@1.0.0 or @scope/name@^1.0.0
 */
function parseSpec(spec?: string): { name: string; range: string } | null {
  if (!spec) return null;
  const m = spec.match(/^(@[^@]+?)@([^@]+)$/) || spec.match(/^([^@]+)@([^@]+)$/);
  if (!m) return null;
  return { name: m[1], range: m[2] };
}

/**
 * Check if a package is installed in agent_modules/ and optionally verify version
 */
async function isPackageInstalled(
  projectRoot: string,
  packageName: string,
  requestedRange?: string,
): Promise<boolean> {
  try {
    const pkgPath = agentModulesPath(projectRoot, packageName);
    await fs.access(pkgPath);

    // If a specific version range is requested, check lockfile
    if (requestedRange) {
      const lock = LockfileManager.read(projectRoot);
      if (!lock?.packages) {
        return false;
      }

      const installedVersion = lock.packages[packageName]?.version;
      if (!installedVersion) {
        return false;
      }

      // Check if installed version satisfies the requested range
      const semver = await import('semver');
      return semver.satisfies(installedVersion, requestedRange);
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Update manifest file with a new dependency (idempotent)
 */
async function updateManifestWithDependency(
  projectRoot: string,
  packageName: string,
  versionRange: string,
): Promise<void> {
  await addOrUpdateDependency(projectRoot, packageName, versionRange);
}

/**
 * Auto-install a package if it's not already installed
 */
async function autoInstallPackage(
  ctx: CLIContext,
  projectRoot: string,
  packageName: string,
  versionRange: string,
): Promise<void> {
  ctx.logger.info(`Package ${packageName} not installed, installing...`);

  // Resolve dependencies
  const existingLock = LockfileManager.read(projectRoot);
  const resolver = new DependencyResolver(ctx.registry, {
    lockfile: existingLock,
    logger: ctx.logger,
  });

  // Check if yanked
  const versionsInfo = await ctx.registry.getPackageVersions(packageName);
  const exact = versionsInfo.versions[versionRange];
  if (exact && exact.yanked) {
    throw new TerrazulError(
      ErrorCode.VERSION_YANKED,
      `Version ${versionRange} of ${packageName} is yanked`,
    );
  }

  const { resolved, warnings } = await resolver.resolve({
    [packageName]: versionRange,
  });
  for (const w of warnings) ctx.logger.warn(w);

  // Install each resolved package
  const updates: Record<string, ReturnType<typeof LockfileManager.merge>['packages'][string]> = {};
  const packageManager = new PackageManager(ctx);

  for (const [pkgName, info] of resolved) {
    ctx.logger.info(`Installing ${pkgName}@${info.version} ...`);

    const { integrity } = await packageManager.installSinglePackage(
      projectRoot,
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
  }

  // Update lockfile
  const updated = LockfileManager.merge(existingLock, updates);
  LockfileManager.write(updated, projectRoot);

  // Update manifest
  await updateManifestWithDependency(projectRoot, packageName, versionRange);

  ctx.logger.info('Installation complete');
}

/**
 * Validate a local package directory
 */
async function validateLocalPackage(packagePath: string): Promise<{
  name: string;
  version: string;
}> {
  // Check directory exists
  try {
    const stats = await fs.stat(packagePath);
    if (!stats.isDirectory()) {
      throw new TerrazulError(ErrorCode.INVALID_PACKAGE, `Path is not a directory: ${packagePath}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new TerrazulError(
        ErrorCode.PACKAGE_NOT_FOUND,
        `Package directory not found: ${packagePath}`,
      );
    }
    throw error;
  }

  // Read and validate manifest
  const manifest = await readManifest(packagePath);
  if (!manifest || !manifest.package?.name || !manifest.package?.version) {
    throw new TerrazulError(
      ErrorCode.INVALID_PACKAGE,
      `Invalid package: agents.toml must contain [package] with name and version`,
    );
  }

  return {
    name: manifest.package.name,
    version: manifest.package.version,
  };
}

/**
 * Setup local package for rendering (create agent_modules entry)
 */
async function setupLocalPackage(
  ctx: CLIContext,
  projectRoot: string,
  localPath: string,
): Promise<{ packageName: string; version: string }> {
  const validated = await validateLocalPackage(localPath);
  const packageName = validated.name;

  ctx.logger.info(`Using local package ${packageName}@${validated.version} from ${localPath}`);

  // Create agent_modules directory for this package
  const linkPath = agentModulesPath(projectRoot, packageName);
  await ensureDir(path.dirname(linkPath));
  await ensureDir(linkPath);

  return { packageName, version: validated.version };
}

/**
 * Report rendering results to the logger
 */
function reportRenderResults(
  logger: CLIContext['logger'],
  result: Awaited<ReturnType<typeof planAndRender>>,
): void {
  logger.info(`run: wrote ${result.written.length} files`);

  // In verbose mode, show each written file
  if (logger.isVerbose() && result.written.length > 0) {
    for (const file of result.written) {
      logger.debug(`  rendered: ${file}`);
    }
  }

  if (result.skipped.length > 0) {
    logger.info(`run: skipped ${result.skipped.length} files (already exist)`);
  }
  if (result.backedUp.length > 0) {
    for (const b of result.backedUp) logger.info(`backup: ${b}`);
  }
}

/**
 * Discover packages to use for MCP config aggregation
 */
async function discoverPackagesForMCP(
  projectRoot: string,
  packageName?: string,
  profileName?: string,
): Promise<string[]> {
  const agentModulesRoot = path.join(projectRoot, 'agent_modules');

  // If specific package specified, use only that
  if (packageName) {
    return [packageName];
  }

  // If profile specified, get packages from manifest
  if (profileName) {
    const manifest = await readManifest(projectRoot);
    if (manifest?.profiles?.[profileName]) {
      return manifest.profiles[profileName];
    }
    return [];
  }

  // Otherwise, discover all installed packages
  try {
    const entries = await fs.readdir(agentModulesRoot, { withFileTypes: true });
    const packages: string[] = [];

    for (const entry of entries) {
      if (entry.isDirectory() || entry.isSymbolicLink()) {
        if (entry.name.startsWith('@')) {
          // Scoped package, need to read subdirectories
          const scopedPath = path.join(agentModulesRoot, entry.name);
          const scopedEntries = await fs.readdir(scopedPath, { withFileTypes: true });
          for (const scopedEntry of scopedEntries) {
            if (scopedEntry.isDirectory() || scopedEntry.isSymbolicLink()) {
              packages.push(`${entry.name}/${scopedEntry.name}`);
            }
          }
        } else {
          packages.push(entry.name);
        }
      }
    }

    return packages;
  } catch {
    return [];
  }
}

/**
 * Create a spinner manager for askAgent progress tracking
 */
function createSpinnerManager(ctx: CLIContext) {
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
            ctx.logger.info(`[run] Skipping duplicate askAgent task: ${taskId}`);
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
        const task = activeTasks.get(taskId);

        if (task) {
          task.status = 'error';
          task.error = event.error.message;
          if (isTTY) {
            renderSpinner();
          } else {
            ctx.logger.warn(`askAgent failed: ${event.error.message}`);
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
  };

  return { onSnippetEvent, cleanup };
}

export function registerRunCommand(
  program: Command,
  createCtx: (opts: { verbose?: boolean }) => CLIContext,
): void {
  program
    .command('run')
    .argument('[package]', 'Package spec like @scope/name@1.0.0 (will auto-install if needed)')
    .description('Install (if needed), render templates, and execute with Claude Code')
    .option('--profile <profile>', 'Limit execution to the packages under the given profile')
    .option('--tool <tool>', 'Use a specific answer tool (claude or codex)')
    .option('--no-tool-safe-mode', 'Disable safe mode for tool execution')
    .option('--force', 'Force re-rendering even if files already exist')
    .action(
      async (
        _pkg: string | undefined,
        opts: { profile?: string; tool?: string; toolSafeMode?: boolean; force?: boolean },
      ) => {
        const globalOpts = program.opts<{ verbose?: boolean }>();
        const ctx = createCtx({ verbose: globalOpts.verbose });
        const projectRoot = process.cwd();
        const agentModulesRoot = path.join(projectRoot, 'agent_modules');
        const profileName = typeof opts.profile === 'string' ? opts.profile.trim() : undefined;

        try {
          // Validate arguments
          if (_pkg && profileName) {
            ctx.logger.error('Cannot combine package argument with --profile');
            process.exitCode = 1;
            return;
          }

          // Parse and handle package spec or filesystem path
          let packageName: string | undefined = undefined;
          let localStorePath: string | undefined = undefined;

          if (_pkg) {
            // Check if it's a filesystem path
            if (isFilesystemPath(_pkg)) {
              const resolvedPath = resolvePathSpec(_pkg);
              const result = await setupLocalPackage(ctx, projectRoot, resolvedPath);
              packageName = result.packageName;
              localStorePath = resolvedPath;

              ctx.logger.info(`Running local package ${packageName} from ${resolvedPath}`);
            } else {
              // Handle as package spec
              const parsed = parseSpec(_pkg);
              if (!parsed) {
                // No version specified, treat as package name only
                packageName = _pkg;
                const installed = await isPackageInstalled(projectRoot, packageName);

                if (!installed) {
                  // Auto-install with latest version
                  await autoInstallPackage(ctx, projectRoot, packageName, '*');
                }
              } else {
                packageName = parsed.name;
                const installed = await isPackageInstalled(projectRoot, packageName, parsed.range);

                if (!installed) {
                  await autoInstallPackage(ctx, projectRoot, parsed.name, parsed.range);
                }
              }
            }
          }

          // Setup rendering options
          const toolOverride = normalizeToolOption(opts.tool);
          const toolSafeMode = opts.toolSafeMode ?? true;
          // Local packages should always force re-render to reflect latest changes
          const force = opts.force ?? localStorePath !== undefined;

          // Create spinner manager for askAgent progress
          const spinner = createSpinnerManager(ctx);

          // Prepare local package paths map if we have a local package
          const localPackagePaths =
            localStorePath && packageName ? new Map([[packageName, localStorePath]]) : undefined;

          // Render templates (with isolated mode to render to agent_modules/<pkg>/rendered/)
          const result = await planAndRender(projectRoot, agentModulesRoot, {
            dryRun: false,
            force,
            packageName,
            profileName,
            tool: toolOverride,
            toolSafeMode,
            verbose: ctx.logger.isVerbose(),
            onSnippetEvent: spinner.onSnippetEvent,
            localPackagePaths,
          });

          // Cleanup and report results
          spinner.cleanup();
          reportRenderResults(ctx.logger, result);

          // Inject package context directly into CLAUDE.md and AGENTS.md
          if (result.packageFiles && result.packageFiles.size > 0) {
            // Build PackageInfo array from packageFiles
            const packageInfos: PackageInfo[] = [];
            for (const [pkgName, files] of result.packageFiles) {
              if (files.length > 0) {
                const pkgRoot = agentModulesPath(projectRoot, pkgName);
                const manifest = await readManifest(pkgRoot);
                packageInfos.push({
                  name: pkgName,
                  version: manifest?.package?.version,
                  root: pkgRoot,
                });
              }
            }

            // Inject direct @-mentions into CLAUDE.md and AGENTS.md
            const claudeMd = path.join(projectRoot, 'CLAUDE.md');
            const agentsMd = path.join(projectRoot, 'AGENTS.md');

            const claudeResult = await injectPackageContext(
              claudeMd,
              projectRoot,
              result.packageFiles,
              packageInfos,
            );
            if (claudeResult.modified) {
              ctx.logger.info('Injected package context into CLAUDE.md');
              if (ctx.logger.isVerbose() && claudeResult.content) {
                // Show the injected block
                const lines = claudeResult.content.split('\n');
                const beginIdx = lines.findIndex((l) => l.includes('terrazul:begin'));
                if (beginIdx >= 0) {
                  const endIdx = lines.findIndex((l) => l.includes('terrazul:end'));
                  if (endIdx > beginIdx) {
                    ctx.logger.debug('  Injected content:');
                    for (let i = beginIdx; i <= endIdx && i < beginIdx + 10; i++) {
                      ctx.logger.debug(`    ${lines[i]}`);
                    }
                  }
                }
              }
            }

            const agentsResult = await injectPackageContext(
              agentsMd,
              projectRoot,
              result.packageFiles,
              packageInfos,
            );
            if (agentsResult.modified) {
              ctx.logger.info('Injected package context into AGENTS.md');
              if (ctx.logger.isVerbose() && agentsResult.content) {
                // Show the injected block
                const lines = agentsResult.content.split('\n');
                const beginIdx = lines.findIndex((l) => l.includes('terrazul:begin'));
                if (beginIdx >= 0) {
                  const endIdx = lines.findIndex((l) => l.includes('terrazul:end'));
                  if (endIdx > beginIdx) {
                    ctx.logger.debug('  Injected content:');
                    for (let i = beginIdx; i <= endIdx && i < beginIdx + 10; i++) {
                      ctx.logger.debug(`    ${lines[i]}`);
                    }
                  }
                }
              }
            }

            // Log @-mentions in verbose mode
            if (ctx.logger.isVerbose()) {
              for (const [pkgName, files] of result.packageFiles) {
                if (files.length > 0) {
                  ctx.logger.debug(`  ${pkgName}: ${files.length} file(s) rendered`);
                  for (const file of files) {
                    const relPath = path.relative(projectRoot, file);
                    ctx.logger.debug(`    ${relPath}`);
                  }
                }
              }
            }
          }

          // Discover packages for rendering, symlinks, and MCP config
          const packages = await discoverPackagesForMCP(projectRoot, packageName, profileName);

          // Create symlinks for agents/, commands/, hooks/, skills/ files
          if (packages.length > 0) {
            const symlinkResult = await createSymlinks({
              projectRoot,
              packages,
              renderedFiles: result.renderedFiles,
              activeTool: toolOverride ?? 'claude',
            });

            if (symlinkResult.created.length > 0) {
              ctx.logger.info(
                `Created ${symlinkResult.created.length} symlink(s) in .claude/ directories`,
              );
              if (ctx.logger.isVerbose()) {
                for (const link of symlinkResult.created) {
                  const relPath = path.relative(projectRoot, link);
                  ctx.logger.debug(`  ${relPath}`);
                }
              }
            }

            if (symlinkResult.errors.length > 0) {
              for (const err of symlinkResult.errors) {
                ctx.logger.warn(`Failed to create symlink: ${err.path} - ${err.error}`);
              }
            }
          }

          // Aggregate MCP configs from all rendered packages (may be empty)
          const mcpConfig =
            packages.length > 0
              ? await aggregateMCPConfigs(projectRoot, packages, { agentModulesRoot, ctx })
              : { mcpServers: {} };

          // Generate temporary MCP config file
          const terrazulDir = path.join(projectRoot, '.terrazul');
          ensureDir(terrazulDir);
          const mcpConfigPath = path.join(terrazulDir, 'mcp-config.json');

          try {
            await generateMCPConfigFile(mcpConfigPath, mcpConfig);

            // Skip spawning Claude Code in non-interactive environments (tests, CI)
            const skipSpawn = process.env.TZ_SKIP_SPAWN === 'true' || !process.stdout.isTTY;

            if (skipSpawn) {
              const serverCount = Object.keys(mcpConfig.mcpServers).length;
              ctx.logger.info(
                `Rendered templates with ${serverCount} MCP server(s). Skipping Claude Code launch (non-interactive).`,
              );
              await cleanupMCPConfig(mcpConfigPath);
              return;
            }

            const serverCount = Object.keys(mcpConfig.mcpServers).length;
            if (serverCount > 0) {
              ctx.logger.info(`Launching Claude Code with ${serverCount} MCP server(s)...`);
            } else {
              ctx.logger.info('Launching Claude Code...');
            }

            // Get model from user config
            const userConfig = await ctx.config.load();
            const claudeTool = userConfig.profile?.tools?.find((t) => t.type === 'claude');
            const model = claudeTool?.model;

            // Spawn Claude Code with MCP config
            const exitCode = await spawnClaudeCode(mcpConfigPath, [], projectRoot, model);

            // Cleanup temp config
            await cleanupMCPConfig(mcpConfigPath);

            process.exitCode = exitCode;
          } catch (error) {
            // Ensure cleanup even on error
            await cleanupMCPConfig(mcpConfigPath);
            throw error;
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
