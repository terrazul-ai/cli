import { render } from 'ink-testing-library';
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';

import {
  type ExtractOptions,
  type ExtractPlan,
  type ExtractResult,
  type ExecuteOptions,
} from '../../src/core/extract/orchestrator';
import { ExtractWizard } from '../../src/ui/extract/ExtractWizard';

const baseOptions: ExtractOptions = {
  from: '/projects/demo',
  out: '/projects/demo/out',
  name: '@demo/pkg',
  version: '0.0.0',
  includeClaudeLocal: false,
  includeClaudeUser: false,
  includeCodexConfig: true,
  dryRun: false,
  force: false,
};

function createPlan(overrides: Partial<ExtractPlan> = {}): ExtractPlan {
  return {
    projectRoot: '/projects/demo',
    detected: {
      'codex.Agents': '/projects/demo/AGENTS.md',
      'claude.Readme': '/projects/demo/.claude/CLAUDE.md',
      'cursor.rules': '/projects/demo/.cursor/rules',
      'codex.config': '~/.codex/config.toml',
      'codex.mcp_servers': 'aggregated from MCP sources',
      'claude.mcp_servers': 'aggregated from MCP sources',
    },
    skipped: [],
    manifest: {},
    outputs: [
      {
        id: 'readme',
        artifactId: '__base.readme',
        relativePath: 'README.md',
        format: 'text',
        data: 'readme',
        alwaysInclude: true,
      },
      {
        id: 'codex.Agents',
        artifactId: 'codex.Agents',
        relativePath: 'templates/AGENTS.md.hbs',
        format: 'text',
        data: 'agents',
      },
      {
        id: 'claude.Readme',
        artifactId: 'claude.Readme',
        relativePath: 'templates/CLAUDE.md.hbs',
        format: 'text',
        data: 'claude',
      },
      {
        id: 'cursor.rules',
        artifactId: 'cursor.rules',
        relativePath: 'templates/cursor.rules.hbs',
        format: 'text',
        data: 'cursor',
      },
      {
        id: 'claude.mcp_servers',
        artifactId: 'claude.mcp_servers',
        relativePath: 'templates/claude/mcp_servers.json.hbs',
        format: 'json',
        data: {},
      },
      {
        id: 'codex.mcp_servers',
        artifactId: 'codex.mcp_servers',
        relativePath: 'templates/codex/agents.toml.hbs',
        format: 'toml',
        data: '',
      },
      {
        id: 'codex.config',
        artifactId: 'codex.config',
        relativePath: 'templates/codex/config.toml',
        format: 'toml',
        data: '',
      },
    ],
    mcpServers: [
      {
        id: 'codex:embeddings',
        name: 'embeddings',
        source: 'codex',
        origin: '~/.codex/config.toml',
        definition: { command: 'run-embeddings', args: [], env: {} },
        config: { command: 'run-embeddings' },
      },
      {
        id: 'project:search',
        name: 'search',
        source: 'project',
        origin: '/projects/demo/.mcp.json',
        definition: { command: './scripts/search.sh', args: [], env: {} },
        config: { command: './scripts/search.sh' },
      },
    ],
    codexConfigBase: { model: 'gpt-5-codex' },
    ...overrides,
  };
}

function createResult(): ExtractResult {
  return {
    summary: {
      projectRoot: '/projects/demo',
      detected: {
        'codex.Agents': '/projects/demo/AGENTS.md',
        'claude.Readme': '/projects/demo/.claude/CLAUDE.md',
        'codex.config': '~/.codex/config.toml',
        'codex.mcp_servers': 'aggregated from MCP sources',
      },
      outputs: [
        'README.md',
        'templates/AGENTS.md.hbs',
        'templates/codex/agents.toml.hbs',
        'templates/codex/config.toml',
      ],
      manifest: {},
      skipped: [],
    },
  };
}

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  isVerbose: () => false,
};

const stripAnsi = (value?: string): string =>
  value ? value.replaceAll(/\u001B\[[\d;?]*[ -/]*[@-~]/g, '') : '';

const pause = async (ms = 150): Promise<void> =>
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

async function expectFrameContains(
  getFrame: () => string | undefined,
  text: string,
  timeoutMs = 2000,
): Promise<void> {
  await vi.waitFor(
    () => {
      expect(stripAnsi(getFrame())).toContain(text);
    },
    { timeout: timeoutMs, interval: 25 },
  );
}

async function expectFrameNotContains(
  getFrame: () => string | undefined,
  text: string,
  timeoutMs = 2000,
): Promise<void> {
  await vi.waitFor(
    () => {
      expect(stripAnsi(getFrame())).not.toContain(text);
    },
    { timeout: timeoutMs, interval: 25 },
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe('ExtractWizard', () => {
  it('renders refreshed layout, enforces selection guard, and completes extraction via primary flow', async () => {
    const plan = createPlan();
    const analyze = vi.fn(async () => plan);
    const execute = vi.fn(async (_plan: ExtractPlan, _options: ExecuteOptions) => createResult());

    const { stdin, lastFrame } = render(
      <ExtractWizard
        baseOptions={baseOptions}
        initialPlan={plan}
        analyze={analyze}
        execute={execute}
        logger={noopLogger}
      />,
    );

    await pause();
    await expectFrameContains(lastFrame, 'Extract • Step 1/6 — Select Artifacts');
    await expectFrameContains(lastFrame, 'Enter • Continue');
    await expectFrameContains(lastFrame, 'Space • Toggle');
    await expectFrameContains(lastFrame, 'V • Show logs');

    stdin.write('n');
    await expectFrameContains(lastFrame, 'Select at least one artifact to continue');
    await expectFrameContains(lastFrame, 'Enter • Continue (disabled)');

    stdin.write('a');
    await expectFrameNotContains(lastFrame, 'Select at least one artifact to continue');
    await expectFrameContains(lastFrame, 'Enter • Continue');

    stdin.write('\t');
    await pause();
    await expectFrameContains(lastFrame, 'Extract • Step 2/6 — Select MCP Servers');

    stdin.write('\t');
    await pause();
    await expectFrameContains(lastFrame, 'Extract • Step 3/6 — Choose Output Directory');

    stdin.write('\t');
    await pause();
    await expectFrameContains(lastFrame, 'Extract • Step 4/6 — Confirm Package Metadata');

    stdin.write('\t');
    await pause();
    for (const _ of '0.0.0') {
      stdin.write('\u007F');
      await pause(10);
    }
    stdin.write('invalid');
    await pause();
    await expectFrameContains(lastFrame, 'Version must be valid semver (e.g., 0.0.0)');
    await expectFrameContains(lastFrame, 'Enter • Continue (disabled)');

    stdin.write('\r');
    await pause();
    await expectFrameContains(lastFrame, 'Extract • Step 4/6 — Confirm Package Metadata');

    for (const _ of 'invalid') {
      stdin.write('\u007F');
      await pause(10);
    }
    stdin.write('1.2.3');
    await pause();
    await expectFrameNotContains(lastFrame, 'Version must be valid semver (e.g., 0.0.0)');
    await expectFrameContains(lastFrame, 'Enter • Continue');

    stdin.write('\r');
    await pause();
    await expectFrameContains(lastFrame, 'Extract • Step 5/6 — Toggle Options');
    await expectFrameContains(lastFrame, 'Space • Toggle');
    await expectFrameNotContains(lastFrame, 'L • Claude local');
    await expectFrameContains(lastFrame, 'Include ~/.codex/config.toml');
    await expectFrameContains(lastFrame, 'Adds user-specific Codex configuration to the bundle.');

    stdin.write('\r');
    await pause();
    await expectFrameContains(lastFrame, 'Extract • Step 6/6 — Review & Extract');
    await expectFrameContains(lastFrame, 'Enter • Extract package');
    await expectFrameContains(lastFrame, '○ Include ~/.codex/config.toml');
    await expectFrameContains(lastFrame, 'Adds user-specific Codex configuration to the bundle.');
    await expectFrameNotContains(lastFrame, '✓ Codex • config.toml');

    stdin.write('\r');

    await vi.waitFor(
      () => {
        expect(execute).toHaveBeenCalledTimes(1);
      },
      { timeout: 1000 },
    );

    const [executedPlan, execOptions] = execute.mock.calls[0];
    expect(executedPlan).toBe(plan);
    expect(execOptions.includedArtifacts).toHaveLength(6);
    expect(new Set(execOptions.includedArtifacts)).toEqual(
      new Set([
        'codex.Agents',
        'claude.Readme',
        'cursor.rules',
        'codex.mcp_servers',
        'codex.config',
        'claude.mcp_servers',
      ]),
    );
    expect(execOptions.includedMcpServers).toEqual(['codex:embeddings', 'project:search']);

    await expectFrameContains(lastFrame, 'Extraction complete');
  });

  it('shows status bar during analysis and toggles the log drawer', async () => {
    vi.useFakeTimers();

    let resolveAnalysis: ((plan: ExtractPlan) => void) | null = null;
    const analyze = vi.fn(
      async () =>
        await new Promise<ExtractPlan>((resolve) => {
          resolveAnalysis = resolve;
        }),
    );
    const execute = vi.fn(async (_plan: ExtractPlan, _options: ExecuteOptions) => createResult());

    const { stdin, lastFrame } = render(
      <ExtractWizard
        baseOptions={baseOptions}
        analyze={analyze}
        execute={execute}
        logger={{
          ...noopLogger,
          info: (msg: string) => {
            noopLogger.info(msg);
          },
        }}
      />,
    );

    await expectFrameContains(lastFrame, 'Analyzing project…');
    await expectFrameNotContains(lastFrame, 'Extract • Step 1/6 — Select Artifacts', 10);

    await vi.waitFor(() => {
      expect(analyze).toHaveBeenCalledTimes(1);
    });

    expect(resolveAnalysis).not.toBeNull();
    resolveAnalysis?.(createPlan());

    await vi.advanceTimersByTimeAsync(200);

    await expectFrameContains(lastFrame, 'Extract • Step 1/6 — Select Artifacts');
    await expectFrameNotContains(lastFrame, 'Analyzing project…');
    await expectFrameNotContains(lastFrame, 'Activity log');

    stdin.write('v');
    await expectFrameContains(lastFrame, 'Activity log');
    await expectFrameContains(lastFrame, 'Analyzing project');

    stdin.write('v');
    await expectFrameNotContains(lastFrame, 'Activity log');
  });
});
