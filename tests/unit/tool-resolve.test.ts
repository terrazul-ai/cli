import { afterEach, describe, expect, it, vi } from 'vitest';

import * as proc from '../../src/utils/proc';
import { choosePrimaryAnswerTool, computeOutputTargets } from '../../src/utils/tool-resolve';

import type { UserConfig } from '../../src/types/config';
import type { RunResult } from '../../src/utils/proc';

const defaultContextFiles = {
  claude: 'CLAUDE.md',
  codex: 'AGENTS.md',
  cursor: '.cursor/rules.mdc',
  copilot: '.github/copilot-instructions.md',
} as const;

function makeConfig(overrides: Partial<UserConfig> = {}): UserConfig {
  const environments: UserConfig['environments'] = {
    production: { registry: 'https://api.terrazul.com' },
    ...overrides.environments,
  };
  if (!environments.production) {
    environments.production = { registry: 'https://api.terrazul.com' };
  }

  const profile: UserConfig['profile'] = {
    tools: overrides.profile?.tools ?? [],
    ...overrides.profile,
  };

  const context: UserConfig['context'] = {
    ...overrides.context,
    files: {
      ...defaultContextFiles,
      ...overrides.context?.files,
    },
  };

  return {
    registry: overrides.registry ?? 'https://api.terrazul.com',
    environment: overrides.environment ?? 'production',
    environments,
    cache: overrides.cache ?? { ttl: 3600, maxSize: 500 },
    telemetry: overrides.telemetry ?? false,
    profile,
    context,
    token: overrides.token,
    tokenExpiry: overrides.tokenExpiry,
    username: overrides.username,
  };
}

describe('tool resolve', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('picks first available from profile priority', async () => {
    const cfg = makeConfig({
      profile: {
        tools: [
          { type: 'codex', command: 'codex' },
          { type: 'claude', command: 'claude' },
        ],
      },
    });
    const spy = vi.spyOn(proc, 'runCommand');
    // "which codex" fails, "which claude" passes
    spy.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 1 } as RunResult);
    spy.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as RunResult);
    const spec = await choosePrimaryAnswerTool(cfg);
    expect(spec.type).toBe('claude');
  });

  it('force --tool claude requires availability', async () => {
    const cfg = makeConfig();
    const spy = vi
      .spyOn(proc, 'runCommand')
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as RunResult); // which claude OK
    const spec = await choosePrimaryAnswerTool(cfg, 'claude');
    expect(spec.type).toBe('claude');
    expect(spy).toHaveBeenCalled();
  });

  it('force --tool codex supplies default args when not in profile', async () => {
    const cfg = makeConfig();
    const spy = vi
      .spyOn(proc, 'runCommand')
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as RunResult); // which codex OK
    const spec = await choosePrimaryAnswerTool(cfg, 'codex');
    expect(spec).toEqual({ type: 'codex', args: ['exec'] });
    expect(spy).toHaveBeenCalled();
  });

  it('computeOutputTargets returns all profile types in order (unique)', () => {
    const cfg = makeConfig({
      profile: {
        tools: [{ type: 'codex' }, { type: 'cursor' }, { type: 'copilot' }, { type: 'codex' }],
      },
    });
    expect(computeOutputTargets(cfg)).toEqual(['codex', 'cursor', 'copilot']);
    expect(computeOutputTargets(cfg, 'claude')).toEqual(['claude']);
  });
});
