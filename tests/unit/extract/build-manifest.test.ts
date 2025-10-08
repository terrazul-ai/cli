import * as TOML from '@iarna/toml';
import { describe, it, expect } from 'vitest';

import { buildAgentsToml } from '../../../src/core/extract/build-manifest';

describe('build-manifest (agents.toml generation)', () => {
  it('generates TOML with package, exports, and metadata', () => {
    const toml = buildAgentsToml('@user/pkg', '1.2.3', {
      codex: {
        template: 'templates/AGENTS.md.hbs',
        mcpServers: 'templates/codex/agents.toml.hbs',
      },
      claude: {
        template: 'templates/CLAUDE.md.hbs',
        settings: 'templates/claude/settings.json.hbs',
        mcpServers: 'templates/claude/mcp_servers.json.hbs',
      },
      cursor: { template: 'templates/cursor.rules.hbs' },
      copilot: { template: 'templates/copilot.md.hbs' },
      // Unknown tools should round-trip under [exports]
      custom: { template: 'templates/custom.hbs', extra: 'x' },
    });

    const obj = TOML.parse(toml) as {
      package: { name: string; version: string; description: string };
      metadata: { tz_spec_version: number };
      exports: {
        codex: { template: string; mcpServers: string };
        claude: { template: string; settings: string; mcpServers: string };
        cursor: { template: string };
        copilot: { template: string };
        custom: { template: string; extra: string };
      };
    };
    expect(obj.package.name).toBe('@user/pkg');
    expect(obj.package.version).toBe('1.2.3');
    expect(obj.package.description).toBe('Extracted AI context package');
    expect(obj.metadata.tz_spec_version).toBe(1);
    expect(obj.exports.codex.template).toBe('templates/AGENTS.md.hbs');
    expect(obj.exports.codex.mcpServers).toBe('templates/codex/agents.toml.hbs');
    expect(obj.exports.claude.template).toBe('templates/CLAUDE.md.hbs');
    expect(obj.exports.claude.settings).toBe('templates/claude/settings.json.hbs');
    expect(obj.exports.claude.mcpServers).toBe('templates/claude/mcp_servers.json.hbs');
    expect(obj.exports.cursor.template).toBe('templates/cursor.rules.hbs');
    expect(obj.exports.copilot.template).toBe('templates/copilot.md.hbs');
    // Unknown tool preserved
    expect(obj.exports.custom.template).toBe('templates/custom.hbs');
    expect(obj.exports.custom.extra).toBe('x');
  });

  it('is deterministic for the same exports map', () => {
    const exportsMap = {
      codex: {
        template: 'templates/AGENTS.md.hbs',
        mcpServers: 'templates/codex/agents.toml.hbs',
      },
      claude: { template: 'templates/CLAUDE.md.hbs' },
    } as const;
    const a = buildAgentsToml('@u/p', '0.1.0', exportsMap);
    const b = buildAgentsToml('@u/p', '0.1.0', exportsMap);
    expect(a).toBe(b);
  });
});
