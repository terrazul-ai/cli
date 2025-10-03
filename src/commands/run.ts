import path from 'node:path';

import { planAndRender } from '../core/template-renderer';

import type { CLIContext } from '../utils/context';
import type { Command } from 'commander';

export function registerRunCommand(
  program: Command,
  createCtx: (opts: { verbose?: boolean }) => CLIContext,
): void {
  program
    .command('run')
    .allowExcessArguments(true)
    .argument('[args...]', 'Args forwarded to integration tool')
    .description('Aggregate MCP configs and spawn integration tool')
    .option('--profile <profile>', 'Limit execution to the packages under the given profile')
    .action(async (_args: string[], cmdOpts: { profile?: string }) => {
      const globalOpts = program.opts<{ verbose?: boolean }>();
      const ctx = createCtx({ verbose: globalOpts.verbose });
      const profileName = typeof cmdOpts.profile === 'string' ? cmdOpts.profile.trim() : undefined;

      if (profileName) {
        const projectDir = process.cwd();
        const agentModulesRoot = path.join(projectDir, 'agent_modules');
        try {
          await planAndRender(projectDir, agentModulesRoot, {
            dryRun: true,
            force: false,
            profileName,
          });
        } catch (error) {
          ctx.logger.error(error instanceof Error ? error.message : String(error));
          process.exitCode = 1;
          return;
        }
      }

      ctx.logger.info('run: stub — not implemented yet');
    });
}
