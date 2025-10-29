import path from 'node:path';

import { planAndRender } from '../core/template-renderer.js';
import { reportSnippetExecutions } from '../utils/snippet-log.js';
import { normalizeToolOption } from '../utils/tool-options.js';

import type { SnippetProgress, TemplateProgress } from '../core/template-renderer.js';
import type { CLIContext } from '../utils/context.js';
import type { Command } from 'commander';

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
          const summarizePrompt = (prompt: string): string => {
            const singleLine = prompt.replaceAll(/\s+/g, ' ').trim();
            return singleLine.length > 120 ? `${singleLine.slice(0, 117)}…` : singleLine;
          };

          const onTemplateStart = ({ dest }: TemplateProgress): void => {
            const destLabel = path.relative(projectRoot, dest) || dest;
            if (templateStarts.has(destLabel)) return;
            templateStarts.add(destLabel);
            ctx.logger.info(`Previewing ${destLabel}`);
          };

          const onSnippetEvent = ({ event }: SnippetProgress): void => {
            switch (event.type) {
              case 'askAgent:start': {
                ctx.logger.info(`Running askAgent: "${summarizePrompt(event.prompt)}"`);
                break;
              }
              case 'askAgent:end': {
                ctx.logger.info('askAgent complete.');
                break;
              }
              case 'askAgent:error': {
                ctx.logger.warn(`askAgent failed: ${event.error.message}`);
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
