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
import { ensureDir } from '../utils/fs.js';
import { readManifest } from '../utils/manifest.js';
import { agentModulesPath } from '../utils/path.js';
import { normalizeToolOption } from '../utils/tool-options.js';
import { generateAskAgentSummary } from '../utils/ask-agent-summary.js';
import { generateTZMd, type PackageInfo } from '../utils/tz-md-generator.js';
import { injectTZMdReference } from '../utils/context-file-injector.js';
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
 * Check if a package is installed in agent_modules/
 */
async function isPackageInstalled(projectRoot: string, packageName: string): Promise<boolean> {
  try {
    const pkgPath = agentModulesPath(projectRoot, packageName);
    await fs.access(pkgPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Update manifest file with a new dependency
 */
async function updateManifestWithDependency(
  projectRoot: string,
  packageName: string,
  versionRange: string,
): Promise<void> {
  const manifest = await readManifest(projectRoot);
  if (!manifest || !manifest.dependencies) {
    return;
  }

  manifest.dependencies[packageName] = versionRange;
  const manifestPath = path.join(projectRoot, 'agents.toml');
  const manifestContent = await fs.readFile(manifestPath, 'utf8');
  const lines = manifestContent.split('\n');

  // Find [dependencies] section and add the package
  let inDeps = false;
  let inserted = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '[dependencies]') {
      inDeps = true;
      continue;
    }
    if (inDeps && lines[i].trim().startsWith('[')) {
      // New section, insert before it
      lines.splice(i, 0, `"${packageName}" = "${versionRange}"`);
      inserted = true;
      break;
    }
  }
  if (!inserted) {
    lines.push(`"${packageName}" = "${versionRange}"`);
  }

  await fs.writeFile(manifestPath, lines.join('\n'), 'utf8');
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
      logger.verbose(`  rendered: ${file}`);
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

          // Parse and handle package spec
          let packageName: string | undefined = undefined;
          if (_pkg) {
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
              const installed = await isPackageInstalled(projectRoot, packageName);

              if (!installed) {
                await autoInstallPackage(ctx, projectRoot, parsed.name, parsed.range);
              }
            }
          }

          // Setup rendering options
          const toolOverride = normalizeToolOption(opts.tool);
          const toolSafeMode = opts.toolSafeMode ?? true;
          const force = opts.force ?? false;

          // Create spinner manager for askAgent progress
          const spinner = createSpinnerManager(ctx);

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
          });

          // Cleanup and report results
          spinner.cleanup();
          reportRenderResults(ctx.logger, result);

          // Generate TZ.md from rendered packages
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

            await generateTZMd(projectRoot, result.packageFiles, packageInfos);
            ctx.logger.info('Generated .terrazul/TZ.md with package context');

            // Log @-mentions in verbose mode
            if (ctx.logger.isVerbose()) {
              for (const [pkgName, files] of result.packageFiles) {
                if (files.length > 0) {
                  ctx.logger.verbose(`  ${pkgName}: ${files.length} file(s) referenced`);
                  for (const file of files) {
                    const relPath = path.relative(projectRoot, file);
                    ctx.logger.verbose(`    @${relPath}`);
                  }
                }
              }
            }

            // Inject @-mention of TZ.md into CLAUDE.md and AGENTS.md
            const claudeMd = path.join(projectRoot, 'CLAUDE.md');
            const agentsMd = path.join(projectRoot, 'AGENTS.md');

            const claudeResult = await injectTZMdReference(claudeMd, projectRoot);
            if (claudeResult.modified) {
              ctx.logger.info('Injected TZ.md reference into CLAUDE.md');
              if (ctx.logger.isVerbose() && claudeResult.content) {
                // Show the injected block
                const lines = claudeResult.content.split('\n');
                const beginIdx = lines.findIndex((l) => l.includes('terrazul:begin'));
                if (beginIdx >= 0 && beginIdx + 2 < lines.length) {
                  ctx.logger.verbose('  Injected content:');
                  ctx.logger.verbose(`    ${lines[beginIdx]}`);
                  ctx.logger.verbose(`    ${lines[beginIdx + 1]}`);
                  ctx.logger.verbose(`    ${lines[beginIdx + 2]}`);
                }
              }
            }

            const agentsResult = await injectTZMdReference(agentsMd, projectRoot);
            if (agentsResult.modified) {
              ctx.logger.info('Injected TZ.md reference into AGENTS.md');
              if (ctx.logger.isVerbose() && agentsResult.content) {
                // Show the injected block
                const lines = agentsResult.content.split('\n');
                const beginIdx = lines.findIndex((l) => l.includes('terrazul:begin'));
                if (beginIdx >= 0 && beginIdx + 2 < lines.length) {
                  ctx.logger.verbose('  Injected content:');
                  ctx.logger.verbose(`    ${lines[beginIdx]}`);
                  ctx.logger.verbose(`    ${lines[beginIdx + 1]}`);
                  ctx.logger.verbose(`    ${lines[beginIdx + 2]}`);
                }
              }
            }
          }

          // Discover packages for MCP config aggregation
          const packages = await discoverPackagesForMCP(projectRoot, packageName, profileName);

          // Aggregate MCP configs from all rendered packages (may be empty)
          const mcpConfig =
            packages.length > 0
              ? await aggregateMCPConfigs(projectRoot, packages)
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

            // Spawn Claude Code with MCP config
            const exitCode = await spawnClaudeCode(mcpConfigPath, [], projectRoot);

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
