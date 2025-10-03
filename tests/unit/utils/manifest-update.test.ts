import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { removeDependenciesFromManifest } from '../../../src/utils/manifest';

async function createTempDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'tz-manifest-'));
}

describe('removeDependenciesFromManifest', () => {
  it('removes entries and preserves other sections', async () => {
    const dir = await createTempDir();
    const manifest = `
[package]
name = "@demo/app"
version = "0.1.0"

[dependencies]
"@acme/foo" = "^1.0.0"
"@acme/bar" = "~2.0.0"

[compatibility]
claude-code = ">=0.2.0"
`;
    await fs.writeFile(path.join(dir, 'agents.toml'), manifest, 'utf8');

    const changed = await removeDependenciesFromManifest(dir, ['@acme/foo']);
    expect(changed).toBe(true);

    const after = await fs.readFile(path.join(dir, 'agents.toml'), 'utf8');
    expect(after).not.toContain('@acme/foo');
    expect(after).toContain('@acme/bar');
    expect(after).toContain('[compatibility]');
  });

  it('drops dependencies table when last entry removed', async () => {
    const dir = await createTempDir();
    const manifest = `
[package]
name = "@demo/app"
version = "0.1.0"

[dependencies]
"@acme/foo" = "^1.0.0"
`;
    await fs.writeFile(path.join(dir, 'agents.toml'), manifest, 'utf8');

    const changed = await removeDependenciesFromManifest(dir, ['@acme/foo']);
    expect(changed).toBe(true);

    const after = await fs.readFile(path.join(dir, 'agents.toml'), 'utf8');
    expect(after).not.toContain('[dependencies]');
  });

  it('no-ops when file missing or dependencies absent', async () => {
    const dir = await createTempDir();
    const manifestPath = path.join(dir, 'agents.toml');
    await fs.writeFile(manifestPath, '[package]\nname = "@demo/app"\n', 'utf8');

    const changed = await removeDependenciesFromManifest(dir, ['@acme/missing']);
    expect(changed).toBe(false);

    const after = await fs.readFile(manifestPath, 'utf8');
    expect(after).toContain('@demo/app');
  });
});
