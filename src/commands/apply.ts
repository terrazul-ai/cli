import path from 'node:path';

import { planAndRender } from '../core/template-renderer.js';
import { reportSnippetExecutions } from '../utils/snippet-log.js';
import { normalizeToolOption } from '../utils/tool-options.js';

import type { SnippetProgress, TemplateProgress } from '../core/template-renderer.js';
import type { CLIContext } from '../utils/context.js';
import type { Command } from 'commander';

export function registerApplyCommand(
  program: Command,
  createCtx: (opts: { verbose?: boolean }) => CLIContext,
): void {
  program
    .command('apply')
    .argument('[package]', 'Optional package name to apply only that package')
    .description('Render installed templates into actual config files (CLAUDE.md, .claude, etc.)')
    .option('--force', 'Overwrite existing destination files', false)
    .option('--dry-run', 'Plan without writing any files', false)
    .option('--profile <profile>', 'Apply only the packages associated with the given profile')
    .option('--tool <tool>', 'Use a specific answer tool (claude or codex)')
    .option('--no-tool-safe-mode', 'Disable safe mode for tool execution')
    .option('--no-cache', 'Bypass cache and re-execute all snippets', false)
    .option('--cache-file <path>', 'Path to cache file (default: ./agents-cache.toml)')
    .action(
      async (
        _pkg: string | undefined,
        opts: {
          force?: boolean;
          dryRun?: boolean;
          profile?: string;
          tool?: string;
          toolSafeMode?: boolean;
          noCache?: boolean;
          cacheFile?: string;
        },
      ) => {
        const g = program.opts<{ verbose?: boolean }>();
        const ctx = createCtx({ verbose: g.verbose });
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
            ctx.logger.info(`Building ${destLabel}`);
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

          const res = await planAndRender(projectRoot, agentModulesRoot, {
            force: opts.force,
            dryRun: opts.dryRun,
            packageName: _pkg,
            profileName,
            tool: toolOverride,
            toolSafeMode,
            verbose: ctx.logger.isVerbose(),
            onTemplateStart,
            onSnippetEvent,
            noCache: opts.noCache,
            cacheFilePath: opts.cacheFile,
          });
          if (opts.dryRun) {
            ctx.logger.info(`apply (dry-run): would write ${res.written.length} files`);
          } else {
            ctx.logger.info(`apply: wrote ${res.written.length} files`);
          }
          if (res.backedUp.length > 0) {
            for (const b of res.backedUp) ctx.logger.info(`backup: ${b}`);
          }
          if (res.skipped.length > 0) {
            for (const s of res.skipped) ctx.logger.warn(`skipped: ${s.dest} (${s.reason})`);
          }
          if (res.snippets.length > 0) {
            reportSnippetExecutions(res.snippets, ctx.logger);
          }
        } catch (error) {
          ctx.logger.error(
            error instanceof Error ? error.message : `apply failed: ${String(error)}`,
          );
          process.exitCode = 1;
        }
      },
    );
}
