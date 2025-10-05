import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { render } from 'ink';

import { ErrorCode, TerrazulError, isTerrazulError, wrapError } from '../core/errors.js';
import {
  analyzeExtractSources,
  executeExtract,
  performExtract,
  type ExecuteOptions,
  type ExtractOptions,
  type ExtractPlan,
  type ExtractResult,
} from '../core/extract/orchestrator.js';
import { ExtractWizard } from '../ui/extract/ExtractWizard.js';
import { createInkLogger } from '../ui/logger-adapter.js';

import type { Command } from 'commander';
import type { CLIContext } from '../utils/context.js';

function slugifySegment(input: string): string {
  const normalized = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'package';
}

function deriveDefaultName(fromDir: string): string {
  const base = path.basename(fromDir) || 'project';
  return `@local/${slugifySegment(base)}`;
}

function deriveDefaultOut(fromDir: string): string {
  return path.join(fromDir, 'my-first-package');
}

interface ExtractArgs {
  from?: string;
  out?: string;
  name?: string;
  pkgVersion?: string;
  includeClaudeLocal?: boolean;
  includeClaudeUser?: boolean;
  force?: boolean;
  dryRun?: boolean;
  interactive?: boolean;
}

async function resolveProfileScope(ctx: CLIContext): Promise<string | undefined> {
  try {
    const cfg = await ctx.config.load();
    const activeEnv = cfg.environments?.[cfg.environment];
    const username = activeEnv?.username ?? cfg.username;
    const trimmed = username?.trim().replace(/^@+/, '');
    if (!trimmed) return undefined;
    const normalized = slugifySegment(trimmed);
    return normalized || undefined;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.logger.debug(`extract: unable to read profile scope: ${message}`);
    return undefined;
  }
}

export async function buildInteractiveBaseOptions(
  args: ExtractArgs,
  ctx: CLIContext,
): Promise<ExtractOptions> {
  const fromAbs = path.resolve(args.from ?? process.cwd());
  const defaultOut = args.out ? path.resolve(args.out) : deriveDefaultOut(fromAbs);

  let name = args.name?.trim();
  if (!name) {
    const scope = await resolveProfileScope(ctx);
    if (scope) {
      const pkgSegment = slugifySegment(path.basename(fromAbs) || 'package');
      name = `@${scope}/${pkgSegment}`;
    }
  }
  if (!name) {
    name = deriveDefaultName(fromAbs);
  }

  return {
    from: fromAbs,
    out: defaultOut,
    name,
    version: args.pkgVersion ?? '1.0.0',
    includeClaudeLocal: Boolean(args.includeClaudeLocal),
    includeClaudeUser: Boolean(args.includeClaudeUser),
    force: Boolean(args.force),
    dryRun: Boolean(args.dryRun),
  };
}

interface InteractiveWizardResult {
  result: ExtractResult | null;
  execOptions: ExecuteOptions | null;
}

async function runInteractiveWizard(
  baseOptions: ExtractOptions,
  ctx: CLIContext,
): Promise<InteractiveWizardResult> {
  const inkLogger = createInkLogger({ baseLogger: ctx.logger, mirrorToBaseLogger: false });
  let finalResult: ExtractResult | null = null;
  let cancelled = false;
  let finalExecOptions: ExecuteOptions | null = null;
  let initialPlan: ExtractPlan | undefined;

  const planPath = process.env.TZ_EXTRACT_PLAN_PATH;
  if (planPath) {
    try {
      const raw = await fs.readFile(planPath, 'utf8');
      initialPlan = JSON.parse(raw) as ExtractPlan;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.logger.warn(`Loading extract plan from ${planPath} failed: ${message}`);
    }
  } else if (process.env.TZ_EXTRACT_PRECOMPUTE_PLAN === '1') {
    try {
      initialPlan = await analyzeExtractSources(baseOptions);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.logger.warn(`Precomputing extract plan failed: ${message}`);
    }
  }

  const ink = render(
    <ExtractWizard
      baseOptions={baseOptions}
      analyze={analyzeExtractSources}
      execute={(plan: ExtractPlan, execOptions: ExecuteOptions) =>
        executeExtract(plan, execOptions, inkLogger)
      }
      logger={inkLogger}
      initialPlan={initialPlan}
      onComplete={(result: ExtractResult, execOptions: ExecuteOptions) => {
        finalResult = result;
        finalExecOptions = execOptions;
      }}
      onCancel={() => {
        cancelled = true;
      }}
    />,
    { exitOnCtrlC: false },
  );

  await ink.waitUntilExit();

  if (cancelled) {
    process.exitCode = 1;
    return { result: null, execOptions: null };
  }

  return { result: finalResult, execOptions: finalExecOptions };
}

export function registerExtractCommand(
  program: Command,
  createCtx: (opts: { verbose?: boolean }) => CLIContext,
): void {
  program
    .command('extract')
    .description('Extract AI configs from a project into a package scaffold')
    .option('--from <path>', 'Source directory (project root or .claude)')
    .option('--out <path>', 'Output directory for the new package')
    .option('--name <name>', 'Package name, e.g., @user/ctx')
    .option('--pkg-version <semver>', 'Package version, e.g., 1.0.0')
    .option('--include-claude-local', 'Include .claude/settings.local.json (sanitized)', false)
    .option('--include-claude-user', 'Include user-scoped ~/.claude.json (sanitized)', false)
    .option('--force', 'Overwrite non-empty output directory', false)
    .option('--dry-run', 'Print plan without writing files', false)
    .option('--no-interactive', 'Disable interactive wizard')
    .action(async (raw: Record<string, unknown>) => {
      const opts = program.opts<{ verbose?: boolean }>();
      const ctx = createCtx({ verbose: opts.verbose });
      try {
        const config = await ctx.config.load();
        const token = ctx.config.getToken(config);
        if (!token) {
          throw new TerrazulError(
            ErrorCode.AUTH_REQUIRED,
            'Extract requires authentication. Run `tz login` first.',
          );
        }
        const r = raw as ExtractArgs;
        const wantsInteractive = r.interactive ?? true;
        const canInteractive = process.stdout.isTTY && wantsInteractive;

        if (canInteractive) {
          const baseOptions = await buildInteractiveBaseOptions(r, ctx);
          const { result, execOptions } = await runInteractiveWizard(baseOptions, ctx);
          if (result) {
            const effectiveOptions = execOptions ?? baseOptions;
            if (effectiveOptions.dryRun) {
              ctx.logger.info(JSON.stringify(result.summary, null, 2));
            } else {
              ctx.logger.info(`Extracted → ${path.resolve(effectiveOptions.out)}`);
            }
          }
          return;
        }

        const missing: string[] = [];
        if (!r.from) missing.push('--from');
        if (!r.out) missing.push('--out');
        if (!r.name) missing.push('--name');
        if (!r.pkgVersion) missing.push('--pkg-version');
        if (missing.length > 0) {
          program.error(`error: required option(s) ${missing.join(', ')} not specified`);
        }

        const options: ExtractOptions = {
          from: String(r.from),
          out: String(r.out),
          name: String(r.name),
          version: String(r.pkgVersion),
          includeClaudeLocal: Boolean(r.includeClaudeLocal),
          includeClaudeUser: Boolean(r.includeClaudeUser),
          force: Boolean(r.force),
          dryRun: Boolean(r.dryRun),
        };
        const result = await performExtract(options, ctx.logger);
        if (options.dryRun) {
          ctx.logger.info(JSON.stringify(result.summary, null, 2));
        } else {
          ctx.logger.info(`Extracted → ${path.resolve(options.out)}`);
        }
      } catch (error) {
        const te = isTerrazulError(error) ? error : wrapError(error);
        if (!isTerrazulError(error) && ctx.logger.isVerbose()) {
          const original = error instanceof Error ? (error.stack ?? error.message) : String(error);
          ctx.logger.error(original);
        }
        ctx.logger.error(te.toUserMessage());
        process.exitCode = te.getExitCode();
      }
    });
}
