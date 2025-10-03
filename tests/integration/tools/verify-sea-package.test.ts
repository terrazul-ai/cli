import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { stageReleasePackage, verifyStagedPackage } from '../../../tools/verify-sea-package';

const KNOWN_TARGETS = [
  { platform: 'darwin', arch: 'arm64', target: 'darwin-arm64', binaryName: 'tz-darwin-arm64' },
  { platform: 'darwin', arch: 'x64', target: 'darwin-x64', binaryName: 'tz-darwin-x64' },
  { platform: 'linux', arch: 'x64', target: 'linux-x64', binaryName: 'tz-linux-x64' },
  { platform: 'linux', arch: 'arm64', target: 'linux-arm64', binaryName: 'tz-linux-arm64' },
  { platform: 'win32', arch: 'x64', target: 'win32-x64', binaryName: 'tz-win32-x64.exe' },
  { platform: 'win32', arch: 'arm64', target: 'win32-arm64', binaryName: 'tz-win32-arm64.exe' },
];

function createExecutable(tmpDir: string, name: string, content: string) {
  const filePath = path.join(tmpDir, name);
  fs.writeFileSync(filePath, content, { mode: 0o755 });
  return filePath;
}

function createGhStub(tmpDir: string) {
  const lines = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'output_dir=""',
    'while [[ $# -gt 0 ]]; do',
    '  case "$1" in',
    '    --dir)',
    '      shift',
    '      output_dir="$1"',
    '      ;;',
    '  esac',
    '  if [[ $# -gt 0 ]]; then',
    '    shift',
    '  else',
    '    break',
    '  fi',
    'done',
    'if [[ -z "$output_dir" ]]; then',
    '  echo "gh stub missing --dir" >&2',
    '  exit 1',
    'fi',
  ];

  for (const { target, binaryName } of KNOWN_TARGETS) {
    const baseDir = `$output_dir/art-${target}/dist/${target}`;
    lines.push(`mkdir -p "${baseDir}"`);
    if (binaryName.endsWith('.exe')) {
      lines.push(`printf 'stub' > "${baseDir}/${binaryName}"`);
    } else {
      lines.push(
        `cat <<'SCRIPT' > "${baseDir}/${binaryName}"`,
        '#!/usr/bin/env bash',
        'if [[ "$1" == "--help" ]]; then',
        '  echo "stub"',
        '  exit 0',
        'fi',
        'echo "stub run"',
        'exit 0',
        'SCRIPT',
      );
    }
    lines.push(
      `cp "${baseDir}/${binaryName}" "${baseDir}/${binaryName}.zst"`,
      `cp "${baseDir}/${binaryName}" "${baseDir}/${binaryName}.tar.gz"`,
      `cp "${baseDir}/${binaryName}" "${baseDir}/${binaryName}.zip"`,
    );
  }

  lines.push('');

  return createExecutable(tmpDir, 'gh', `${lines.join('\n')}\n`);
}

function createZstdStub(tmpDir: string) {
  const script = `#!/usr/bin/env bash
set -euo pipefail
output=""
input=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o)
      shift
      output="$1"
      ;;
    --*)
      ;;
    *)
      input="$1"
      ;;
  esac
  if [[ $# -gt 0 ]]; then
    shift
  else
    break
  fi
done
if [[ -z "$input" ]]; then
  echo "zstd stub missing input" >&2
  exit 1
fi
if [[ -z "$output" ]]; then
  output="\${input%.zst}"
fi
cp "$input" "$output"
if [[ "$output" != *.exe ]]; then
  chmod +x "$output" 2>/dev/null || true
fi
`;
  return createExecutable(tmpDir, 'zstd', script);
}

describe('verify-sea-package tool', () => {
  it('stages the package and validates launcher metadata and artifacts', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-sea-'));
    const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-sea-stubs-'));
    const ghPath = createGhStub(stubDir);
    createZstdStub(stubDir);

    const manifestPath = path.join(process.cwd(), 'dist', 'manifest.json');
    const originalManifest = fs.existsSync(manifestPath)
      ? fs.readFileSync(manifestPath, 'utf8')
      : null;
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          cliVersion: '3.0.0',
          cdn: { baseUrl: 'https://example.com/releases/cli-v3.0.0' },
          targets: {
            'linux-x64': {
              url: 'https://example.com/releases/cli-v3.0.0/tz-linux-x64.zst',
              size: 123,
              sha256: '1'.repeat(64),
            },
          },
        },
        null,
        2,
      ),
    );

    try {
      const { packageDir } = await stageReleasePackage({
        releaseVersion: '3.0.0',
        stagingRoot: tmpRoot,
        runId: 'local-run',
        workflowUrl: 'https://example.com/run/local',
        repo: 'terrazul-ai/terrazul',
        ghPath,
        env: {
          PATH: `${stubDir}:${process.env.PATH ?? ''}`,
        },
      });

      await expect(
        verifyStagedPackage({
          packageDir,
          nodeBinary: process.execPath,
          requireLaunch: false,
        }),
      ).resolves.toBeUndefined();
    } finally {
      if (originalManifest) {
        fs.writeFileSync(manifestPath, originalManifest, 'utf8');
      } else {
        fs.rmSync(manifestPath, { force: true });
      }
    }
  });

  it('fails when manifest is missing', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-sea-missing-'));
    const packageDir = path.join(tmpRoot, 'package');
    fs.mkdirSync(path.join(packageDir, 'bin'), { recursive: true });
    fs.mkdirSync(path.join(packageDir, 'dist'), { recursive: true });
    fs.writeFileSync(
      path.join(packageDir, 'package.json'),
      JSON.stringify({
        bin: { tz: 'bin/app.mjs' },
        engines: { node: '>=20.0.0' },
        files: ['bin', 'dist'],
      }),
    );

    await expect(verifyStagedPackage({ packageDir, nodeBinary: process.execPath })).rejects.toThrow(
      /dist\/manifest\.json/,
    );
  });
});
