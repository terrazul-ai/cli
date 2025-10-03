import { promises as fs } from 'node:fs';
import path from 'node:path';

import inquirer from 'inquirer';

import type { CLIContext } from '../utils/context';
import type { Command } from 'commander';

export function registerInitCommand(
  program: Command,
  createCtx: (opts: { verbose?: boolean }) => CLIContext,
): void {
  program
    .command('init')
    .description('Initialize a new Terrazul project (agents.toml + .gitignore)')
    .option('--name <name>', 'Package name, e.g., @user/pkg')
    .option('--description <text>', 'Package description')
    .option('-y, --yes', 'Skip prompts; use defaults from CWD', false)
    .action(async (options: { name?: string; description?: string; yes?: boolean }) => {
      const opts = program.opts<{ verbose?: boolean }>();
      const ctx = createCtx({ verbose: opts.verbose });

      const cwd = process.cwd();
      const agentsTomlPath = path.join(cwd, 'agents.toml');
      const gitignorePath = path.join(cwd, '.gitignore');

      // If agents.toml exists, do nothing
      const exists = await fs
        .stat(agentsTomlPath)
        .then(() => true)
        .catch(() => false);
      if (exists) {
        ctx.logger.warn('agents.toml already exists — skipping');
        return;
      }

      // Resolve values: use flags if provided; otherwise prompt (if TTY)
      let name = options.name;
      let description = options.description ?? '';
      if (!name) {
        if (!options.yes && process.stdout.isTTY) {
          const answers = await inquirer.prompt<{ name: string; description: string }>([
            {
              name: 'name',
              message: 'Package name (@username/pkg):',
              validate: (s: string) => Boolean(s) || 'required',
            },
            { name: 'description', message: 'Description:' },
          ]);
          name = answers.name;
          description = options.description ?? answers.description ?? '';
        } else {
          const base = path.basename(cwd) || 'project';
          name = `@local/${base}`;
        }
      }

      let hasClaude = false;
      try {
        const stat = await fs.stat(path.join(cwd, '.claude'));
        hasClaude = stat.isDirectory();
      } catch {
        hasClaude = false;
      }

      const lines: string[] = [
        '[package]',
        `name = ${JSON.stringify(name)}`,
        'version = "0.1.0"',
        ...(description ? [`description = ${JSON.stringify(description)}`] : []),
        'license = "MIT"',
        'keywords = ["claude-code"]',
        '',
        '[dependencies]',
        '',
        // Always include compatibility; log if .claude/ directory not found
        '[compatibility]',
        'claude-code = ">=0.2.0"',
        '',
      ];
      // Optional scripts section (commented example for now)
      // lines.push('[scripts]');
      // lines.push("postinstall = \"echo 'Package installed'\"");

      const toml = lines.join('\n') + '\n';
      await fs.writeFile(agentsTomlPath, toml, 'utf8');
      ctx.logger.info('Created agents.toml');

      if (!hasClaude) {
        ctx.logger.info('Added [compatibility] for claude-code; .claude/ not detected.');
      }

      // Update .gitignore to include agent_modules/
      const gi = await fs.readFile(gitignorePath, 'utf8').catch(() => '');
      if (!gi.includes('agent_modules/')) {
        const updated = gi + (gi.endsWith('\n') ? '' : '\n') + 'agent_modules/\n';
        await fs.writeFile(gitignorePath, updated, 'utf8');
        ctx.logger.info('Updated .gitignore to ignore agent_modules/');
      }
    });
}
