import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

import { ensureBuilt, run } from '../helpers/cli';
import { createTempProject } from '../helpers/project';

async function mkdtemp(prefix: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
}

describe('manifest snapshot (exports layout)', () => {
  it('matches expected TOML for common inputs', async () => {
    const cli = await ensureBuilt();
    const proj = await createTempProject();
    await proj.addCodexAgents('# Codex');
    await proj.addClaudeReadme('# Claude');
    await proj.setClaudeSettings({ env: { KEY: 'X' } });
    await proj.setClaudeMcp({ tool: { command: '/bin/echo', args: [] } });
    await proj.addClaudeAgent('agent.md', 'hello');
    await proj.addCursorRulesFile('001.txt', 'A');
    await proj.addCopilot('cp');
    const out = await mkdtemp('tz-extract-out');

    await run('node', [
      cli,
      'extract',
      '--from',
      proj.root,
      '--out',
      out,
      '--name',
      '@you/ctx',
      '--pkg-version',
      '1.0.0',
    ]);
    const toml = await fs.readFile(path.join(out, 'agents.toml'), 'utf8');
    const expected = [
      '[package]',
      'name = "@you/ctx"',
      'version = "1.0.0"',
      'description = "Extracted AI context package"',
      'license = "MIT"',
      '',
      '[exports.codex]',
      'template = "templates/AGENTS.md.hbs"',
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
