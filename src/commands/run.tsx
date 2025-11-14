import path from 'node:path';

import React from 'react';
import { render } from 'ink';

import { planAndRender } from '../core/template-renderer.js';
import { reportSnippetExecutions } from '../utils/snippet-log.js';
import { normalizeToolOption } from '../utils/tool-options.js';
import { generateAskAgentSummary } from '../utils/ask-agent-summary.js';
import { AskAgentSpinner, type AskAgentTask } from '../ui/apply/AskAgentSpinner.js';

import type { SnippetProgress, TemplateProgress } from '../core/template-renderer.js';
import type { CLIContext } from '../utils/context.js';
import type { Command } from 'commander';
import type { Instance } from 'ink';

export function registerRunCommand(
  program: Command,
  createCtx: (opts: { verbose?: boolean }) => CLIContext,
): void {
  program
    .command('run')
    .argument('[package]', 'Optional package name to run only that package')
    .description('Execute templates and display results without writing files')
    .option('--profile <profile>', 'Limit execution to the packages under the given profile')
    .option('--tool <tool>', 'Use a specific answer tool (claude or codex)')
    .option('--no-tool-safe-mode', 'Disable safe mode for tool execution')
    .action(
      async (
        _pkg: string | undefined,
        opts: { profile?: string; tool?: string; toolSafeMode?: boolean },
      ) => {
        const globalOpts = program.opts<{ verbose?: boolean }>();
        const ctx = createCtx({ verbose: globalOpts.verbose });
        const projectRoot = process.cwd();
        const agentModulesRoot = path.join(projectRoot, 'agent_modules');
        const profileName = typeof opts.profile === 'string' ? opts.profile.trim() : undefined;

        try {
          if (_pkg && profileName) {
            ctx.logger.error('Cannot combine package argument with --profile');
            process.exitCode = 1;
            return;
          }

          const toolOverride = normalizeToolOption(opts.tool);
          const toolSafeMode = opts.toolSafeMode ?? true;

          const templateStarts = new Set<string>();

          const onTemplateStart = ({ dest }: TemplateProgress): void => {
            const destLabel = path.relative(projectRoot, dest) || dest;
            if (templateStarts.has(destLabel)) return;
            templateStarts.add(destLabel);
            ctx.logger.info(`Previewing ${destLabel}`);
          };

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

          // Force rendering so existing destination files do not short-circuit previews.
          const res = await planAndRender(projectRoot, agentModulesRoot, {
            dryRun: true,
            force: true,
            packageName: _pkg,
            profileName,
            tool: toolOverride,
            toolSafeMode,
            verbose: ctx.logger.isVerbose(),
            onTemplateStart,
            onSnippetEvent,
          });

          // Clean up Ink instance
          if (inkInstance !== null) {
            const instance: Instance = inkInstance;
            instance.unmount();
            inkInstance = null;
          }

          ctx.logger.info(`run: previewed ${res.written.length} files`);
          for (const entry of res.snippets) {
            const relDest = path.relative(projectRoot, entry.dest);
            ctx.logger.info(`--- ${relDest} ---`);
            const rendered = entry.output.trimEnd();
            if (rendered.length === 0) {
              ctx.logger.info('(empty output)');
            } else {
              ctx.logger.info(rendered);
            }
          }

          if (res.skipped.length > 0) {
            for (const s of res.skipped) ctx.logger.warn(`skipped: ${s.dest} (${s.reason})`);
          }

          reportSnippetExecutions(res.snippets, ctx.logger);
        } catch (error) {
          ctx.logger.error(error instanceof Error ? error.message : String(error));
          process.exitCode = 1;
        }
      },
    );
}
