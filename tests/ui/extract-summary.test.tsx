import { describe, it, expect } from 'vitest';

import { type ExtractOptions, type ExtractPlan } from '../../src/core/extract/orchestrator';
import { buildReviewSummary } from '../../src/ui/extract/summary';

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
      'codex.mcp_servers': 'aggregated from MCP sources',
      'claude.mcp_servers': 'aggregated from MCP sources',
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

describe('buildReviewSummary', () => {
  it('groups selections with counts and human-readable labels', () => {
    const plan = createPlan();
    const summary = buildReviewSummary({
      plan,
      selectedArtifacts: new Set(['codex.Agents', 'claude.Readme', 'codex.mcp_servers']),
      selectedMcp: new Set(['project:search']),
      options: { ...baseOptions, dryRun: true, force: true },
    });

    expect(summary.sections).toHaveLength(2);

    const artifacts = summary.sections[0];
    expect(artifacts.id).toBe('artifacts');
    expect(artifacts.title).toBe('Artifacts');
    expect(artifacts.selectedCount).toBe(2);
    expect(artifacts.totalCount).toBe(5);
    expect(artifacts.items.map((item) => item.primary)).toEqual([
      'Codex • AGENTS.md',
      'Claude • CLAUDE.md',
    ]);
    expect(artifacts.items.map((item) => item.secondary)).toEqual([
      '/projects/demo/AGENTS.md',
      '/projects/demo/.claude/CLAUDE.md',
    ]);

    const mcp = summary.sections[1];
    expect(mcp.id).toBe('mcp');
    expect(mcp.title).toBe('MCP Servers');
    expect(mcp.selectedCount).toBe(2);
    expect(mcp.totalCount).toBe(2);
    expect(mcp.items.map((item) => item.primary)).toEqual([
      'Codex • config.toml',
      'PROJECT • search',
    ]);

    expect(summary.destination.path).toBe('/projects/demo/out');
    expect(summary.destination.packageName).toBe('@demo/pkg');
    expect(summary.destination.version).toBe('0.0.0');
    expect(summary.destination.dryRun).toBe(true);
    expect(summary.destination.force).toBe(true);
    expect(summary.codexConfigIncluded).toBe(true);
  });

  it('handles empty selections gracefully', () => {
    const plan = createPlan({ mcpServers: [] });

    const summary = buildReviewSummary({
      plan,
      selectedArtifacts: new Set(),
      selectedMcp: new Set(),
      options: baseOptions,
    });

    const artifacts = summary.sections[0];
    expect(artifacts.selectedCount).toBe(0);
    expect(artifacts.items).toHaveLength(0);
    expect(artifacts.emptyLabel).toBe('No artifacts selected');

    const mcp = summary.sections[1];
    expect(mcp.totalCount).toBe(0);
    expect(mcp.emptyLabel).toBe('Plan has no MCP servers');
    expect(summary.codexConfigIncluded).toBe(false);
  });
});
