import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createSpawnEnv, resolveCommand } from '../../../.github/scripts/build_sea.mjs';

const pnpmHomeWin = String.raw`C:\pnpm`;
const system32 = String.raw`C:\Windows\System32`;

function expectWindowsPath(value: string, expectedSegments: string[]) {
  expect(value.split(';')).toEqual(expectedSegments);
}

describe('createSpawnEnv', () => {
  it('prepends PNPM_HOME to PATH on win32 when missing', () => {
    const env = createSpawnEnv({
      platform: 'win32',
      baseEnv: {
        PNPM_HOME: pnpmHomeWin,
        Path: system32,
      },
    });

    const pathValue = env.Path;
    if (typeof pathValue !== 'string') {
      throw new TypeError('Expected Path to be defined');
    }
    expectWindowsPath(pathValue, [pnpmHomeWin, system32]);
    expect(env.PATH).toBe(pathValue);
  });

  it('prepends PNPM_HOME to PATH on posix when missing', () => {
    const env = createSpawnEnv({
      platform: 'linux',
      baseEnv: {
        PNPM_HOME: '/opt/pnpm',
        PATH: '/usr/bin',
      },
    });

    expect(env.PATH).toBe('/opt/pnpm:/usr/bin');
  });

  it('does not duplicate PNPM_HOME if already present', () => {
    const env = createSpawnEnv({
      platform: 'win32',
      baseEnv: {
        PNPM_HOME: pnpmHomeWin,
        Path: `${pnpmHomeWin};${system32}`,
      },
    });

    const pathValue = env.Path;
    if (typeof pathValue !== 'string') {
      throw new TypeError('Expected Path to be defined');
    }
    expectWindowsPath(pathValue, [pnpmHomeWin, system32]);
  });
});

describe('resolveCommand', () => {
  it('uses pnpm.cmd from PNPM_HOME on win32', () => {
    const env = { PNPM_HOME: pnpmHomeWin };
    expect(resolveCommand('pnpm', env, 'win32')).toBe(path.join(pnpmHomeWin, 'pnpm.cmd'));
  });

  it('falls back to pnpm.cmd when PNPM_HOME missing on win32', () => {
    const original = process.env.PNPM_HOME;
    delete process.env.PNPM_HOME;
    try {
      expect(resolveCommand('pnpm', {}, 'win32')).toBe('pnpm.cmd');
    } finally {
      if (original) {
        process.env.PNPM_HOME = original;
      } else {
        delete process.env.PNPM_HOME;
      }
    }
  });

  it('leaves non-pnpm commands untouched', () => {
    expect(resolveCommand('node', {}, 'linux')).toBe('node');
  });
});
