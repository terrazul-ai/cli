import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

import { findAssets, findTask } from '../../src/utils/task-loader';

async function setupProject(structure: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'tz-scan-'));
  for (const [rel, content] of Object.entries(structure)) {
    const abs = path.join(dir, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content, 'utf8');
  }
  return dir;
}

describe('task scanning across agent_modules', () => {
  it('findTask returns first match and findAssets collects templates', async () => {
    const proj = await setupProject({
      // scoped package with task
      'agent_modules/@a/p1/agents.toml': `
[package]
name = "@a/p1"

[tasks]
"ctx.generate" = "tasks/ctx.yaml"
`,
      'agent_modules/@a/p1/tasks/ctx.yaml': 'version: v1\npipeline: []\n',
      // scoped package with exports only
      'agent_modules/@b/u2/agents.toml': `
[package]
name = "@b/u2"

[exports]
  [exports.codex]
  template = "templates/A.hbs"
`,
      'agent_modules/@b/u2/templates/A.hbs': '# AGENTS\n',
    });

    const found = await findTask(proj, 'ctx.generate');
    expect(found).not.toBeNull();
    expect(found?.pkg).toBe('@a/p1');
    expect(found?.rel).toBe('tasks/ctx.yaml');
    expect(found?.spec.version ?? 'v1').toBe('v1');

    const assets = await findAssets(proj);
    // Should include only packages with known templates
    const names = assets.map((x) => x.pkg);
    expect(names).toContain('@b/u2');
    const u2 = assets.find((a) => a.pkg === '@b/u2');
    expect(u2?.templates.codex).toBe('templates/A.hbs');
  });
});
