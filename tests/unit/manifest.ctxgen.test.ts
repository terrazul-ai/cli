import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

import { readManifest, validateManifest } from '../../src/utils/manifest';

async function setupProject(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'tz-manifest-'));
  // Write files; ensure parent dirs exist
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content, 'utf8');
  }
  return dir;
}

describe('manifest: ctx-gen additions', () => {
  it('reads [tasks] and [exports] and validates existing files', async () => {
    const proj = await setupProject({
      'agents.toml': `
[package]
name = "@u/p"

[tasks]
"ctx.generate" = "tasks/ctx.generate.yaml"

[exports]
  [exports.codex]
  template = "templates/AGENTS.md.hbs"
  [exports.claude]
  template = "templates/CLAUDE.md.hbs"
`,
      'tasks/ctx.generate.yaml': 'pipeline: []\n',
      'templates/AGENTS.md.hbs': '# AGENTS\n',
      'templates/CLAUDE.md.hbs': '# CLAUDE\n',
    });

    const m = await readManifest(proj);
    expect(m).not.toBeNull();
    expect(m?.tasks?.['ctx.generate']).toBe('tasks/ctx.generate.yaml');
    expect(m?.exports?.codex?.template).toBe('templates/AGENTS.md.hbs');
    expect(m?.exports?.claude?.template).toBe('templates/CLAUDE.md.hbs');

    const { warnings, errors } = await validateManifest(proj, m!);
    expect(errors).toHaveLength(0);
    // no warnings for known keys
    expect(warnings).toHaveLength(0);
  });

  it('flags missing files and unknown export keys/properties', async () => {
    const proj = await setupProject({
      'agents.toml': `
[package]
name = "@u/p"

[tasks]
"ctx.generate" = "tasks/ctx.generate.yaml"

[exports]
  [exports.unknownTool]
  template = "templates/IGNORED.md.hbs"
  [exports.codex]
  template = "templates/AGENTS.md.hbs"
  extra = true
`,
      // Note: we intentionally do not create referenced files
    });
    const m = await readManifest(proj);
    expect(m).not.toBeNull();
    const { warnings, errors } = await validateManifest(proj, m!);
    // Missing task file and missing codex template
    expect(errors.some((e) => e.includes('Missing task file'))).toBe(true);
    expect(errors.some((e) => e.includes('Missing template'))).toBe(true);
    // Unknown tool key and unknown property under exports.codex
    expect(warnings.some((w) => w.includes('Unknown tool key under [exports]:'))).toBe(true);
    expect(warnings.some((w) => w.includes('Unknown property under [exports.codex]:'))).toBe(true);
  });
});
