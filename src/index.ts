import { Command } from 'commander';

import { registerApplyCommand } from './commands/apply';
import { registerAuthCommand } from './commands/auth';
import { registerCacheCommand } from './commands/cache';
import { registerEnvCommand } from './commands/env';
import { registerExtractCommand } from './commands/extract';
import { registerInitCommand } from './commands/init';
import { registerInstallCommand } from './commands/install';
import { registerLinkCommand } from './commands/link';
import { registerLoginCommand } from './commands/login';
import { registerLogoutCommand } from './commands/logout';
import { registerPublishCommand } from './commands/publish';
import { registerRunCommand } from './commands/run';
import { registerUninstallCommand } from './commands/uninstall';
import { registerUnlinkCommand } from './commands/unlink';
import { registerUnyankCommand } from './commands/unyank';
import { registerUpdateCommand } from './commands/update';
import { registerValidateCommand } from './commands/validate';
import { registerYankCommand } from './commands/yank';
import { createCLIContext } from './utils/context';
import { getCliVersion } from './utils/version';

function buildProgram(argv: string[]): Command {
  const program = new Command();

  program
    .name('tz')
    .description('Terrazul CLI — The AI agent package manager')
    .version(getCliVersion())
    .option('-v, --verbose', 'Enable verbose logging', false);

  // Register commands (thin orchestration only)
  registerInitCommand(program, createCLIContext);
  registerInstallCommand(program, createCLIContext);
  registerUpdateCommand(program, createCLIContext);
  registerPublishCommand(program, createCLIContext);
  registerRunCommand(program, createCLIContext);
  registerYankCommand(program, createCLIContext);
  registerUnyankCommand(program, createCLIContext);
  registerUninstallCommand(program, createCLIContext);
  registerExtractCommand(program, createCLIContext);
  registerEnvCommand(program, createCLIContext);
  registerCacheCommand(program, createCLIContext);
  registerLinkCommand(program, createCLIContext);
  registerUnlinkCommand(program, createCLIContext);
  registerValidateCommand(program, createCLIContext);
  registerApplyCommand(program, createCLIContext);
  // Top-level auth aliases - might remove auth top level later
  registerLoginCommand(program, createCLIContext);
  registerLogoutCommand(program, createCLIContext);
  registerAuthCommand(program, createCLIContext);

  program.showHelpAfterError();
  program.showSuggestionAfterError();

  program.parse(argv);
  return program;
}

function main(argv: string[]): number {
  buildProgram(argv);
  return 0;
}

// Always execute when invoked as CLI entry
const args = process.argv as unknown as string[];
const code = main(args);
// Set exit code explicitly
process.exitCode = code;

export { buildProgram, main };
