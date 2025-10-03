import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect, beforeEach } from 'vitest';

import {
  addPackageToProfile,
  readManifest,
  removePackageFromProfiles,
} from '../../../src/utils/manifest';

async function createTempDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'tz-manifest-prof-'));
}

describe('manifest profiles helpers', () => {
  let dir = '';

  beforeEach(async () => {
    dir = await createTempDir();
    await fs.writeFile(
      path.join(dir, 'agents.toml'),
      `\n[package]\nname = "@demo/app"\nversion = "0.1.0"\n`,
      'utf8',
    );
  });

  it('adds a package to a new profile and persists sorted membership', async () => {
    await addPackageToProfile(dir, 'focus', '@acme/alpha');
    await addPackageToProfile(dir, 'focus', '@acme/zulu');
    await addPackageToProfile(dir, 'focus', '@acme/bravo');

    const manifest = await readManifest(dir);
    expect(manifest?.profiles).toBeDefined();
    expect(manifest?.profiles?.focus).toEqual(['@acme/alpha', '@acme/bravo', '@acme/zulu']);
  });

  it('does not duplicate entries and leaves other profiles alone', async () => {
    await addPackageToProfile(dir, 'focus', '@acme/alpha');
    await addPackageToProfile(dir, 'focus', '@acme/alpha');
    await addPackageToProfile(dir, 'rest', '@acme/beta');

    const manifest = await readManifest(dir);
    expect(manifest?.profiles?.focus).toEqual(['@acme/alpha']);
    expect(manifest?.profiles?.rest).toEqual(['@acme/beta']);
  });

  it('removes a package from every profile and deletes empty collections', async () => {
    await addPackageToProfile(dir, 'focus', '@acme/alpha');
    await addPackageToProfile(dir, 'rest', '@acme/alpha');
    await addPackageToProfile(dir, 'rest', '@acme/beta');

    const changed = await removePackageFromProfiles(dir, '@acme/alpha');
    expect(changed).toBe(true);

    const manifest = await readManifest(dir);
    expect(manifest?.profiles?.focus).toBeUndefined();
    expect(manifest?.profiles?.rest).toEqual(['@acme/beta']);
  });

  it('no-ops when manifest missing', async () => {
    await fs.rm(path.join(dir, 'agents.toml'));
    const changed = await removePackageFromProfiles(dir, '@acme/alpha');
    expect(changed).toBe(false);
  });
});
