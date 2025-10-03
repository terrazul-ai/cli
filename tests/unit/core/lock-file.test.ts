import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  LockfileManager,
  type LockfileData,
  type LockfilePackage,
} from '../../../src/core/lock-file';

describe('core/lock-file', () => {
  let tmpDir = '';

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tz-lockfile-'));
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('writes deterministic order and reads back', async () => {
    const contentA = Buffer.from('A');
    const contentZ = Buffer.from('Z');
    const pkgA: LockfilePackage = {
      version: '1.0.0',
      resolved: 'http://example.com/@a/pkg-1.0.0.tgz',
      integrity: LockfileManager.createIntegrityHash(contentA),
      dependencies: { '@z/dep': '^2.0.0' },
    };
    const pkgZ: LockfilePackage = {
      version: '2.0.0',
      resolved: 'http://example.com/@z/pkg-2.0.0.tgz',
      integrity: LockfileManager.createIntegrityHash(contentZ),
    };

    const data: LockfileData = {
      version: 1,
      packages: {
        '@z/pkg': pkgZ,
        '@a/pkg': pkgA,
      },
      metadata: { generatedAt: new Date().toISOString(), cliVersion: '0.0.0' },
    };

    LockfileManager.write(data, tmpDir);
    const raw = await fs.readFile(path.join(tmpDir, 'agents-lock.toml'), 'utf8');
    // Ensure alphabetical order: @a/pkg appears before @z/pkg
    const iA = raw.indexOf('"@a/pkg"');
    const iZ = raw.indexOf('"@z/pkg"');
    expect(iA).toBeGreaterThanOrEqual(0);
    expect(iZ).toBeGreaterThanOrEqual(0);
    expect(iA).toBeLessThan(iZ);

    const parsed = LockfileManager.read(tmpDir);
    expect(parsed).not.toBeNull();
    expect(parsed!.version).toBe(1);
    expect(parsed!.packages['@a/pkg']).toBeDefined();
    expect(parsed!.packages['@z/pkg']).toBeDefined();
    // Metadata normalized to camelCase
    expect(parsed!.metadata.generatedAt).toBeTypeOf('string');
    expect(parsed!.metadata.cliVersion).toBeTypeOf('string');
  });

  it('integrity helpers convert and verify', () => {
    const buf = Buffer.from('hello world');
    const integrity = LockfileManager.createIntegrityHash(buf);
    expect(integrity.startsWith('sha256-')).toBe(true);
    expect(LockfileManager.verifyIntegrity(buf, integrity)).toBe(true);

    const hex = LockfileManager.integrityToHex(integrity);
    expect(hex).not.toBeNull();
    const roundTrip = LockfileManager.hexToIntegrity(hex!);
    expect(roundTrip).toBe(integrity);
  });

  it('merge and needsUpdate behave as expected', () => {
    const initial: LockfileData = {
      version: 1,
      packages: {},
      metadata: { generatedAt: new Date().toISOString(), cliVersion: '0.0.0' },
    };
    const update: Record<string, LockfilePackage> = {
      '@x/pkg': {
        version: '1.0.0',
        resolved: 'http://example.com/x.tgz',
        integrity: LockfileManager.createIntegrityHash(Buffer.from('x')),
      },
    };

    const merged = LockfileManager.merge(initial, update);
    expect(merged.packages['@x/pkg']).toBeDefined();
    expect(LockfileManager.needsUpdate(merged, ['@x/pkg'])).toBe(false);
    expect(LockfileManager.needsUpdate(merged, ['@x/pkg', '@y/other'])).toBe(true);
  });
});
