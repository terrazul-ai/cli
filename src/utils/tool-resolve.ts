import { runCommand } from './proc';
import { ErrorCode, TerrazulError } from '../core/errors';

import type { UserConfig } from '../types/config';
import type { ToolSpec, ToolType } from '../types/context';

export const ANSWER_TOOLS: ToolType[] = ['claude', 'codex'];

export function isAnswerTool(t: ToolType): boolean {
  return ANSWER_TOOLS.includes(t);
}

async function isCmdAvailable(cmd: string): Promise<boolean> {
  const whichCmd = process.platform === 'win32' ? 'where' : 'which';
  const { exitCode } = await runCommand(whichCmd, [cmd]).catch(() => ({
    exitCode: -1,
    stdout: '',
    stderr: '',
  }));
  return exitCode === 0;
}

// Return the first available claude/codex entry from profile; else from PATH.
export async function choosePrimaryAnswerTool(
  cfg: UserConfig,
  force?: ToolType,
): Promise<ToolSpec> {
  const requested = force && isAnswerTool(force) ? force : undefined;
  const list = (cfg.profile?.tools ?? []) as ToolSpec[];

  // If forced to an answer tool, honor it if available (prefer profile spec if present)
  if (requested) {
    const fromProfile = list.find((t) => t.type === requested);
    const spec: ToolSpec =
      fromProfile ??
      (requested === 'codex' ? { type: 'codex', args: ['exec'] } : { type: requested });
    const cmd = spec.command ?? spec.type;
    if (await isCmdAvailable(cmd)) return spec;
    throw new TerrazulError(
      ErrorCode.TOOL_NOT_FOUND,
      `Requested tool '${requested}' not found on PATH`,
    );
  }

  // Profile priority
  for (const t of list) {
    if (!isAnswerTool(t.type)) continue;
    const cmd = t.command ?? t.type;
    if (await isCmdAvailable(cmd)) return t;
  }

  // PATH fallback
  if (await isCmdAvailable('claude')) return { type: 'claude' } as ToolSpec;
  if (await isCmdAvailable('codex')) return { type: 'codex', args: ['exec'] } as ToolSpec;

  throw new TerrazulError(
    ErrorCode.TOOL_NOT_FOUND,
    'No supported answer tool found on PATH (install Claude or Codex).',
  );
}

// Targets to render: if --tool specified, just that one; otherwise every tool listed in profile (unique by type).
export function computeOutputTargets(cfg: UserConfig, onlyTool?: ToolType): ToolType[] {
  if (onlyTool) return [onlyTool];
  const types = (cfg.profile?.tools ?? []).map((t) => t.type);
  const list = types.length > 0 ? types : [];
  return [...new Set(list)] as ToolType[]; // empty if no profile.tools
}
