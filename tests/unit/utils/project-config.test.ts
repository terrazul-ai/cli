import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, beforeEach } from 'vitest';

import { ErrorCode, TerrazulError } from '../../../src/core/errors.js';
import { loadProjectConfig } from '../../../src/utils/config.js';

async function makeTempProject(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'tz-project-config-'));
}

describe('loadProjectConfig', () => {
  let dir = '';

  beforeEach(async () => {
    dir = await makeTempProject();
  });

  it('returns manifest data with dependencies', async () => {
    const manifest = `
[package]
name = "demo"
version = "0.0.1"

[dependencies]
"@scope/pkg" = "^1.0.0"
"@scope/extra" = "~2.1.0"
`;
    await fs.writeFile(path.join(dir, 'agents.toml'), manifest, 'utf8');

    const result = await loadProjectConfig(dir);
    expect(result.manifest.package?.name).toBe('demo');
    expect(result.dependencies).toEqual({
      '@scope/pkg': '^1.0.0',
      '@scope/extra': '~2.1.0',
    });
  });

  it('throws when manifest missing', async () => {
    await expect(loadProjectConfig(dir)).rejects.toMatchObject({
      code: ErrorCode.CONFIG_NOT_FOUND,
    });
  });

  it('throws descriptive error when manifest invalid', async () => {
    const bad = `
[package]
name = "demo"

[dependencies]
foo = 123
`;
    await fs.writeFile(path.join(dir, 'agents.toml'), bad, 'utf8');

    await expect(loadProjectConfig(dir)).rejects.toBeInstanceOf(TerrazulError);
    await expect(loadProjectConfig(dir)).rejects.toMatchObject({
      code: ErrorCode.CONFIG_INVALID,
    });
  });
});
