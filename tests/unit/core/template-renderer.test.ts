import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { planAndRender } from '../../../src/core/template-renderer';

async function mkdtemp(prefix: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
}

async function write(file: string, data: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, data, 'utf8');
}

describe('core/template-renderer', () => {
  let projectRoot = '';
  let agentModules = '';
  let pkgRoot = '';

  beforeAll(async () => {
    projectRoot = await mkdtemp('tz-tr-proj');
    agentModules = path.join(projectRoot, 'agent_modules');
    await fs.mkdir(agentModules, { recursive: true });
    // minimal agents.toml in project to provide project name/version context
    await write(
      path.join(projectRoot, 'agents.toml'),
      `\n[package]\nname = "@test/project"\nversion = "0.1.0"\n`,
    );

    // create installed package layout under agent_modules/@scope/name
    pkgRoot = path.join(agentModules, '@test', 'demo');
    await fs.mkdir(pkgRoot, { recursive: true });
    await write(
      path.join(pkgRoot, 'agents.toml'),
      `\n[package]\nname = "@test/demo"\nversion = "1.2.3"\n\n[exports.codex]\ntemplate = "templates/AGENTS.md.hbs"\n\n[exports.claude]\ntemplate = "templates/CLAUDE.md.hbs"\nsettingsLocal = "templates/claude/settings.local.json.hbs"\nsubagentsDir = "templates/claude/agents"\n\n[exports.cursor]\ntemplate = "templates/cursor.rules.hbs"\n`,
    );
    await write(path.join(pkgRoot, 'templates', 'AGENTS.md.hbs'), '# Codex for {{project.name}}');
    await write(path.join(pkgRoot, 'templates', 'CLAUDE.md.hbs'), '# Claude {{pkg.name}}');
    await write(
      path.join(pkgRoot, 'templates', 'claude', 'settings.local.json.hbs'),
      '{ "pkg": "{{pkg.name}}", "when": "{{now}}" }',
    );
    await write(
      path.join(pkgRoot, 'templates', 'claude', 'agents', 'reviewer.md.hbs'),
      'agent for {{project.version}}',
    );
    await write(path.join(pkgRoot, 'templates', 'cursor.rules.hbs'), 'rule: {{env.USER}}');
  });

  afterAll(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('renders templates to expected destinations', async () => {
    const res = await planAndRender(projectRoot, agentModules, { packageName: '@test/demo' });
    // expect CLAUDE.md, AGENTS.md, .claude/settings.local.json, .claude/agents/reviewer.md, .cursor/rules
    const expected = [
      path.join(projectRoot, 'CLAUDE.md'),
      path.join(projectRoot, 'AGENTS.md'),
      path.join(projectRoot, '.claude', 'settings.local.json'),
      path.join(projectRoot, '.claude', 'agents', 'reviewer.md'),
      path.join(projectRoot, '.cursor', 'rules'),
    ];
    for (const f of expected) {
      const st = await fs.stat(f).catch(() => null);
      expect(st && st.isFile()).toBe(true);
    }
    expect(res.written.length).toBeGreaterThanOrEqual(5);
  });

  it('skips existing files unless forced', async () => {
    const before = await planAndRender(projectRoot, agentModules, {
      packageName: '@test/demo',
      force: false,
    });
    expect(before.skipped.length).toBeGreaterThan(0);
    expect(before.backedUp.length).toBe(0);
    const after = await planAndRender(projectRoot, agentModules, {
      packageName: '@test/demo',
      force: true,
    });
    expect(after.written.length).toBeGreaterThan(0);
    expect(after.backedUp.length).toBeGreaterThan(0);
  });
});
