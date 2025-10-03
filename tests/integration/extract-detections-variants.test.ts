import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

import { ensureBuilt } from '../helpers/cli';

function run(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve({ stdout, stderr });
    });
  });
}

async function mkdtemp(prefix: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
}

describe('tz extract detection variants', () => {
  it('detects from .claude as --from and still uses project root', async () => {
    const cli = await ensureBuilt();
    const proj = await mkdtemp('tz-extract-proj');
    const out = await mkdtemp('tz-extract-out');

    await fs.writeFile(path.join(proj, 'AGENTS.md'), '# Codex', 'utf8');
    await fs.mkdir(path.join(proj, '.claude'), { recursive: true });
    await fs.writeFile(path.join(proj, '.claude', 'CLAUDE.md'), '# Claude', 'utf8');

    await run('node', [
      cli,
      'extract',
      '--from',
      path.join(proj, '.claude'),
      '--out',
      out,
      '--name',
      '@you/ctx',
      '--pkg-version',
      '1.0.0',
    ]);
    const manifest = await fs.readFile(path.join(out, 'agents.toml'), 'utf8');
    expect(manifest).toMatch(/AGENTS.md.hbs/);
    expect(manifest).toMatch(/CLAUDE.md.hbs/);
  });

  it('detects Codex AGENTS.md under .codex/', async () => {
    const cli = await ensureBuilt();
    const proj = await mkdtemp('tz-extract-proj');
    const out = await mkdtemp('tz-extract-out');

    await fs.mkdir(path.join(proj, '.codex'), { recursive: true });
    await fs.writeFile(path.join(proj, '.codex', 'AGENTS.md'), '# Codex under .codex', 'utf8');

    await run('node', [
      cli,
      'extract',
      '--from',
      proj,
      '--out',
      out,
      '--name',
      '@you/ctx',
      '--pkg-version',
      '1.0.0',
    ]);
    const agents = await fs.readFile(path.join(out, 'templates', 'AGENTS.md.hbs'), 'utf8');
    expect(agents).toMatch(/Codex under \.codex/);
  });

  it('concatenates .cursor/rules directory deterministically', async () => {
    const cli = await ensureBuilt();
    const proj = await mkdtemp('tz-extract-proj');
    const out = await mkdtemp('tz-extract-out');

    await fs.mkdir(path.join(proj, '.cursor', 'rules'), { recursive: true });
    // Unsorted names
    await fs.writeFile(path.join(proj, '.cursor', 'rules', 'b.txt'), 'B', 'utf8');
    await fs.writeFile(path.join(proj, '.cursor', 'rules', 'a.txt'), 'A', 'utf8');
    await fs.writeFile(path.join(proj, '.cursor', 'rules', 'c.txt'), 'C', 'utf8');

    await run('node', [
      cli,
      'extract',
      '--from',
      proj,
      '--out',
      out,
      '--name',
      '@you/ctx',
      '--pkg-version',
      '1.0.0',
    ]);
    const rules = await fs.readFile(path.join(out, 'templates', 'cursor.rules.hbs'), 'utf8');
    // Should be A\nB\nC (sorted lexicographically)
    const lines = rules.trim().split(/\n+/);
    expect(lines).toEqual(['A', 'B', 'C']);
  });
});
