#!/usr/bin/env tsx
/**
 * Special SEA build test (opt-in; not part of pnpm test)
 *
 * Verifies that:
 *  1) We can build the CLI bundle (dist/tz.mjs)
 *  2) We can generate a SEA preparation blob via sea.config.json
 *  3) Optionally (default), we can inject the blob into a Node binary and run --help
 *
 * Usage:
 *   pnpm run test:sea             # full check (blob + inject + run)
 *   pnpm run test:sea -- --blob   # blob-only mode (no injection)
 */

import { spawn } from 'node:child_process';
import { promises as fs, constants as fsConstants } from 'node:fs';
import path from 'node:path';

function sh(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; stdio?: any } = {},
) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', ...opts });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

async function exists(p: string) {
  try {
    await fs.access(p, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const repoRoot = process.cwd();
  const distDir = path.join(repoRoot, 'dist');
  const bundlePath = path.join(distDir, 'tz.mjs');
  const seaConfigPath = path.join(repoRoot, 'sea.config.json');
  const blobPath = path.join(distDir, 'sea-prep.blob');
  const isWindows = process.platform === 'win32';
  const isMac = process.platform === 'darwin';
  const outBin = path.join(distDir, isWindows ? 'tz-sea.exe' : 'tz-sea');
  const blobOnly = process.argv.includes('--blob') || process.env.TZ_SEA_BLOB_ONLY === '1';

  console.log('SEA test: building CLI bundle...');
  await sh(process.execPath, ['build.config.mjs']);

  if (!(await exists(bundlePath))) {
    throw new Error('Bundle not found at dist/tz.mjs');
  }
  console.log('✔ dist/tz.mjs exists');

  if (!(await exists(seaConfigPath))) {
    // Fallback to a minimal sea.config.json if missing
    const seaConfig = {
      main: 'dist/sea-entry.cjs',
      output: 'dist/sea-prep.blob',
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: true,
      assets: {
        'tz.mjs': 'dist/tz.mjs',
        'yoga.wasm': 'dist/yoga.wasm',
      },
    } as const;
    await fs.writeFile(seaConfigPath, JSON.stringify(seaConfig, null, 2));
  }

  // Clean any previous blob/binary
  try {
    await fs.rm(blobPath, { force: true });
  } catch (error) {
    void error;
  }
  try {
    await fs.rm(outBin, { force: true });
  } catch (error) {
    void error;
  }

  console.log('SEA test: generating preparation blob...');
  await sh(process.execPath, [
    '--experimental-sea-config',
    path.relative(process.cwd(), seaConfigPath),
  ]);

  if (!(await exists(blobPath))) {
    throw new Error('SEA blob not found at dist/sea-prep.blob');
  }
  const blobStat = await fs.stat(blobPath);
  if (blobStat.size <= 0) throw new Error('SEA blob is empty');
  console.log(`✔ SEA blob generated (${blobStat.size} bytes)`);

  if (blobOnly) {
    console.log('Blob-only mode: skipping injection and run.');
    return;
  }

  // Prepare binary by copying the current Node executable
  console.log('SEA test: preparing Node binary copy...');
  await fs.copyFile(process.execPath, outBin);

  // On macOS, remove code signature to allow injection
  if (isMac) {
    try {
      await sh('codesign', ['--remove-signature', outBin]);
      console.log('✔ Removed existing code signature');
    } catch (error) {
      console.warn(
        '⚠ Could not remove signature (codesign not available or failed). Continuing...',
        error?.message || error,
      );
    }
  }

  console.log('SEA test: injecting blob with postject...');
  const postjectBin = path.join(
    repoRoot,
    'node_modules',
    '.bin',
    isWindows ? 'postject.cmd' : 'postject',
  );
  async function getPostjectSpec(root: string) {
    try {
      const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
      const ver = pkg?.devDependencies?.postject || pkg?.dependencies?.postject;
      if (typeof ver === 'string' && ver.length > 0) return `postject@${ver}`;
    } catch {
      // ignore and fall back
    }
    return 'postject@^1.0.0';
  }
  const baseArgs = [
    outBin,
    'NODE_SEA_BLOB',
    blobPath,
    '--sentinel-fuse',
    'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ];
  const args = isMac ? [...baseArgs, '--macho-segment-name', 'NODE_SEA'] : baseArgs;

  if (await exists(postjectBin)) {
    await sh(postjectBin, args, { env: process.env });
  } else {
    console.warn('postject not found locally. Falling back to pnpm dlx postject...');
    const spec = await getPostjectSpec(repoRoot);
    await sh('pnpm', ['dlx', spec, ...args], { env: process.env });
  }

  // Make sure it is executable on POSIX
  if (!isWindows) {
    try {
      await fs.chmod(outBin, 0o755);
    } catch (error) {
      void error;
    }
  }

  // Re-sign on macOS so the binary can run
  if (isMac) {
    try {
      await sh('codesign', ['--sign', '-', outBin]);
      console.log('✔ Ad-hoc signed SEA binary');
    } catch (error) {
      console.warn(
        '⚠ Could not codesign SEA binary. It may still run depending on system policy.',
        error?.message || error,
      );
    }
  }

  console.log('SEA test: running built SEA binary with --help...');
  await sh(outBin, ['--help']);
  console.log('✔ SEA binary executed successfully');

  console.log('All SEA checks passed.');
}

main().catch((error) => {
  console.error('\nSEA test failed:', error?.message || error);
  process.exit(1);
});
