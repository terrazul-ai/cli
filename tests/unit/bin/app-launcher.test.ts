import path from 'node:path';

import { describe, expect, it } from 'vitest';

async function loadLauncher() {
  return import('../../../bin/app.mjs');
}

describe('SEA launcher binary resolution', () => {
  it('maps darwin arm64 to the expected target name', async () => {
    const { resolveBinaryTarget } = await loadLauncher();
    expect(resolveBinaryTarget('darwin', 'arm64')).toEqual({
      target: 'darwin-arm64',
      binaryName: 'tz-darwin-arm64',
    });
  });

  it('maps linux x64 to the expected binary name', async () => {
    const { resolveBinaryTarget } = await loadLauncher();
    expect(resolveBinaryTarget('linux', 'x64')).toEqual({
      target: 'linux-x64',
      binaryName: 'tz-linux-x64',
    });
  });

  it('uses .exe extension on windows binaries', async () => {
    const { resolveBinaryTarget } = await loadLauncher();
    expect(resolveBinaryTarget('win32', 'x64')).toEqual({
      target: 'win32-x64',
      binaryName: 'tz-win32-x64.exe',
    });
  });

  it('throws for unsupported combinations', async () => {
    const { resolveBinaryTarget } = await loadLauncher();
    expect(() => resolveBinaryTarget('aix', 'ppc')).toThrowError(/Unsupported platform/);
  });

  it('resolves an absolute path for a supported binary', async () => {
    const { resolveBinaryPath } = await loadLauncher();
    const binRoot = '/tmp/launcher-test';
    expect(resolveBinaryPath(binRoot, 'linux', 'arm64')).toEqual(
      path.join(binRoot, 'tz-linux-arm64'),
    );
  });
});
