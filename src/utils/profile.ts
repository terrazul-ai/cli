import path from 'node:path';

import type { CLIContext } from './context.js';

function slugify(input: string): string {
  const lower = input.toLowerCase();
  const replaced = lower.replaceAll(/[^\da-z]+/g, '-');
  const trimmed = replaced.replaceAll(/^-+|-+$/g, '');
  return trimmed || 'package';
}

export function slugifySegment(input: string): string {
  return slugify(input);
}

export async function resolveProfileScope(
  ctx: Pick<CLIContext, 'config' | 'logger'>,
): Promise<string | undefined> {
  try {
    const cfg = await ctx.config.load();
    const activeEnv = cfg.environments?.[cfg.environment];
    const username = activeEnv?.username ?? cfg.username;
    const trimmed = username?.trim().replace(/^@+/, '');
    if (!trimmed || trimmed.length === 0) return undefined;
    const normalized = slugify(trimmed);
    return normalized || undefined;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.logger.debug?.(`profile: unable to load username from config: ${message}`);
    return undefined;
  }
}

export function deriveTargetDirFromName(name: string, cwd: string): string {
  const scopedMatch = name.match(/^@[^/]+\/(.+)$/);
  const segment = slugifySegment(scopedMatch ? scopedMatch[1] : name);
  return path.resolve(cwd, segment);
}
