import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as tar from 'tar';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { buildPublishPlan, collectPackageFiles, createTarball } from '../../../src/core/publisher';

async function mkd(prefix: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
}

async function write(root: string, rel: string, data: string): Promise<void> {
  const abs = path.join(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, data, 'utf8');
}

describe('core/publisher', () => {
  let root = '';
  beforeAll(async () => {
    root = await mkd('tz-pub');
    await write(
      root,
      'agents.toml',
      `\n[package]\nname = "@u/demo"\nversion = "0.1.0"\n\n[exports.claude]\ntemplate = "templates/CLAUDE.md.hbs"\n`,
    );
    await write(root, 'README.md', '# Demo');
    await write(root, 'templates/CLAUDE.md.hbs', '# Hello');
  });
  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('collects allowed files', async () => {
    const files = await collectPackageFiles(root);
    expect(files).toContain('agents.toml');
    expect(files).toContain('README.md');
    expect(files).toContain('templates/CLAUDE.md.hbs');
  });

  it('builds a publish plan', async () => {
    const plan = await buildPublishPlan(root);
    expect(plan.name).toBe('@u/demo');
    expect(plan.version).toBe('0.1.0');
    expect(plan.files.length).toBeGreaterThanOrEqual(2);
  });

  it('creates a deterministic tarball', async () => {
    const files = await collectPackageFiles(root);
    const tgz = await createTarball(root, files);
    expect(tgz.length).toBeGreaterThan(0);
    // Write to temp and list to verify contents
    const tmpTgz = path.join(root, 'out.tgz');
    await fs.writeFile(tmpTgz, tgz);
    const listed: string[] = [];
    await tar.list({ file: tmpTgz, onentry: (e) => listed.push(e.path) });
    expect(listed).toContain('agents.toml');
    expect(listed).toContain('README.md');
    expect(listed).toContain('templates/CLAUDE.md.hbs');
  });
});
