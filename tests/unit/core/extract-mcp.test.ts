import path from 'node:path';

import * as TOML from '@iarna/toml';
import { describe, it, expect } from 'vitest';

import {
  parseCodexMcpServers,
  renderCodexMcpServers,
} from '../../../src/core/extract/mcp/codex-config';
import { parseProjectMcpServers } from '../../../src/core/extract/mcp/project-config';

describe('extract MCP server parsing', () => {
  const projectRoot = path.join('/tmp', 'terrazul-project');

  it('normalizes codex config servers with sanitized paths and env', () => {
    const toml = `
model = "gpt-5-codex"
[mcp_servers.packager]
command = "${path.join(projectRoot, 'bin', 'packager')}"
args = ["--config", "${path.join(projectRoot, 'configs', 'dev.json')}"]
env = { API_KEY = "secret" }

[mcp_servers."tools.remote"]
command = "npx"
args = ["-y", "terrazul-mcp"]
`;

    const extraction = parseCodexMcpServers(toml, projectRoot);
    expect(extraction.base?.model).toBe('gpt-5-codex');
    const servers = extraction.servers;
    expect(servers).toHaveLength(2);
    expect(servers.map((s) => s.id)).toEqual(['codex:packager', 'codex:tools.remote']);
    const packager = servers[0];
    expect(packager.definition.command).toContain('{{ PROJECT_ROOT }}');
    expect(packager.definition.args).toContain('{{ PROJECT_ROOT }}/configs/dev.json');
    expect(packager.definition.env.API_KEY).toBe('{{ env.API_KEY }}');
    const remote = servers[1];
    expect(remote.definition.command).toBe('npx');
    expect(remote.definition.args).toEqual(['-y', 'terrazul-mcp']);

    const codexToml = renderCodexMcpServers(servers);
    const parsed = TOML.parse(codexToml ?? '') as Record<string, unknown>;
    const codexServers = (parsed.mcp_servers ?? {}) as Record<string, unknown>;
    expect(Object.keys(codexServers)).toEqual(['packager', 'tools.remote']);
  });

  it('normalizes project mcp json servers and skips invalid entries', () => {
    const json = {
      mcpServers: {
        'local-tools': {
          command: './scripts/mcp.sh',
          args: ['--cwd', path.join(projectRoot, 'data')],
          env: { OPENAI_API_KEY: 'xyz' },
        },
        'broken-server': {
          command: '',
        },
      },
    };

    const servers = parseProjectMcpServers(json, projectRoot);
    expect(servers).toHaveLength(1);
    const only = servers[0];
    expect(only.id).toBe('project:local-tools');
    expect(only.definition.command).toBe('./scripts/mcp.sh');
    expect(only.definition.args).toEqual(['--cwd', '{{ PROJECT_ROOT }}/data']);
    expect(only.definition.env.OPENAI_API_KEY).toBe('{{ env.OPENAI_API_KEY }}');
  });
});
