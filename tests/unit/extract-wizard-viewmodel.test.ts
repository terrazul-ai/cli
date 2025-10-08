import { describe, expect, it } from 'vitest';

import {
  CLAUDE_MCP_ARTIFACT_ID,
  CLAUDE_SUBAGENT_ARTIFACT_ID,
  CODEX_CONFIG_ARTIFACT_ID,
  CODEX_MCP_ARTIFACT_ID,
} from '../../src/ui/extract/extract-wizard-config';
import { computeIncludedArtifacts } from '../../src/ui/extract/extract-wizard-viewmodel';

import type { ExtractOptions, ExtractPlan } from '../../src/core/extract/orchestrator';
import type { WizardSelections } from '../../src/ui/extract/extract-wizard-state';

const baseOptions: ExtractOptions = {
  from: '/projects/demo',
  out: '/projects/demo/out',
  name: '@demo/pkg',
  version: '0.0.0',
  includeClaudeLocal: false,
  includeClaudeUser: false,
  includeCodexConfig: false,
  dryRun: false,
  force: false,
};

function createPlan(overrides: Partial<ExtractPlan> = {}): ExtractPlan {
  return {
    projectRoot: '/projects/demo',
    detected: {
      'codex.Agents': '/projects/demo/AGENTS.md',
      'claude.Readme': '/projects/demo/.claude/CLAUDE.md',
      [CLAUDE_SUBAGENT_ARTIFACT_ID]: ['/projects/demo/.claude/agents/demo.md'],
      [CLAUDE_MCP_ARTIFACT_ID]: '/projects/demo/.claude/mcp_servers.json',
      [CODEX_MCP_ARTIFACT_ID]: '~/.codex/agents.toml',
      [CODEX_CONFIG_ARTIFACT_ID]: '~/.codex/config.toml',
    },
    skipped: [],
    manifest: {},
    outputs: [],
    mcpServers: [
      {
        id: 'codex:embeddings',
        name: 'embeddings',
        source: 'codex',
        origin: '~/.codex/config.toml',
        definition: { command: 'run-embeddings', args: [], env: {} },
        config: { command: 'run-embeddings' },
      },
    ],
    codexConfigBase: { model: 'gpt-5-codex' },
    ...overrides,
  };
}

function createSelections(
  overrides: {
    artifacts?: string[];
    subagents?: string[];
    mcpServers?: string[];
  } = {},
): WizardSelections {
  return {
    artifacts: new Set(overrides.artifacts ?? ['codex.Agents', 'claude.Readme']),
    subagents: new Set(overrides.subagents ?? []),
    mcpServers: new Set(overrides.mcpServers ?? []),
  };
}

describe('computeIncludedArtifacts', () => {
  it('includes Claude MCP artifact when plan bundles MCP servers', () => {
    const plan = createPlan();
    const selections = createSelections();
    const included = new Set(computeIncludedArtifacts(plan, selections, baseOptions));

    expect(included).toEqual(new Set(['codex.Agents', 'claude.Readme', CLAUDE_MCP_ARTIFACT_ID]));
  });

  it('adds Claude subagents artifact when subagent files are selected', () => {
    const plan = createPlan();
    const selections = createSelections({ subagents: ['demo'] });
    const included = new Set(computeIncludedArtifacts(plan, selections, baseOptions));

    expect(included.has(CLAUDE_SUBAGENT_ARTIFACT_ID)).toBe(true);
  });

  it('adds Codex artifacts when Codex config inclusion is requested and available', () => {
    const plan = createPlan();
    const selections = createSelections();
    const options = { ...baseOptions, includeCodexConfig: true };

    const included = new Set(computeIncludedArtifacts(plan, selections, options));

    expect(included.has(CODEX_MCP_ARTIFACT_ID)).toBe(true);
    expect(included.has(CODEX_CONFIG_ARTIFACT_ID)).toBe(true);
  });

  it('omits Codex artifacts when Codex context is unavailable', () => {
    const plan = createPlan({
      codexConfigBase: null,
      mcpServers: [
        {
          id: 'project:search',
          name: 'search',
          source: 'project',
          origin: '/projects/demo/.mcp.json',
          definition: { command: './scripts/search.sh', args: [], env: {} },
          config: { command: './scripts/search.sh' },
        },
      ],
    });
    const selections = createSelections();
    const options = { ...baseOptions, includeCodexConfig: true };

    const included = new Set(computeIncludedArtifacts(plan, selections, options));

    expect(included.has(CODEX_MCP_ARTIFACT_ID)).toBe(false);
    expect(included.has(CODEX_CONFIG_ARTIFACT_ID)).toBe(false);
  });

  it('omits Claude MCP artifact when no MCP servers are detected', () => {
    const plan = createPlan({ mcpServers: [] });
    const selections = createSelections();
    const included = new Set(computeIncludedArtifacts(plan, selections, baseOptions));

    expect(included.has(CLAUDE_MCP_ARTIFACT_ID)).toBe(false);
  });
});
