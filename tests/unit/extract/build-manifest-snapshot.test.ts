import { describe, it, expect } from 'vitest';

import { buildAgentsToml } from '../../../src/core/extract/build-manifest';

describe('build-manifest snapshot', () => {
  it('produces a canonical agents.toml layout', () => {
    const toml = buildAgentsToml('@snap/demo', '0.0.1', {
      codex: {
        template: 'templates/AGENTS.md.hbs',
        mcpServers: 'templates/codex/agents.toml.hbs',
        config: 'templates/codex/config.toml',
      },
      claude: {
        template: 'templates/CLAUDE.md.hbs',
        settings: 'templates/claude/settings.json.hbs',
        mcpServers: 'templates/claude/mcp_servers.json.hbs',
        subagentsDir: 'templates/claude/agents',
      },
      cursor: { template: 'templates/cursor.rules.hbs' },
      copilot: { template: 'templates/copilot.md.hbs' },
    });

    const expected = [
      '[package]',
      'name = "@snap/demo"',
      'version = "0.0.1"',
      'description = "Extracted AI context package"',
      'license = "MIT"',
      '',
      '[exports.codex]',
      'template = "templates/AGENTS.md.hbs"',
      'mcpServers = "templates/codex/agents.toml.hbs"',
      'config = "templates/codex/config.toml"',
      '',
      '[exports.claude]',
      'template = "templates/CLAUDE.md.hbs"',
      'settings = "templates/claude/settings.json.hbs"',
      'mcpServers = "templates/claude/mcp_servers.json.hbs"',
      'subagentsDir = "templates/claude/agents"',
      '',
      '[exports.cursor]',
      'template = "templates/cursor.rules.hbs"',
      '',
      '[exports.copilot]',
      'template = "templates/copilot.md.hbs"',
      '',
      '[metadata]',
      'tz_spec_version = 1',
      '',
    ].join('\n');
    expect(toml).toBe(expected);
  });
});
