#!/usr/bin/env tsx
/**
 * Install the SEA-built tz binary to a user-local bin directory.
 *
 * Defaults:
 *  - Builds with `pnpm run test:sea` if dist/tz-sea(.exe) is missing
 *  - Installs to ~/.local/bin on POSIX, %USERPROFILE%\bin on Windows
 *  - Installs as "tz-sea" (to avoid clobbering an existing global tz)
 *
 * Flags:
 *  --as <name>      Set installed binary name (default: tz-sea)
 *  --dest <path>    Override destination directory
 *  --no-build       Skip building if dist binary is missing
 *  --force          Overwrite existing installed binary
 *  --dry-run        Print actions without writing
 */

import { promises as fs, constants as fsConst } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

function parseArgs(argv: string[]) {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [key, maybeVal] = a.split('=');
      const k = key.replace(/^--/, '');
      if (maybeVal === undefined) {
        const next = argv[i + 1];
        if (next && !next.startsWith('-')) {
          out[k] = next;
          i++;
        } else {
          out[k] = true;
        }
      } else {
        out[k] = maybeVal;
      }
    }
  }
  return out as {
    as?: string;
    dest?: string;
    force?: boolean;
    dryRun?: boolean;
    build?: boolean | string; // supports --no-build
  };
}

async function exists(p: string) {
  try {
    await fs.access(p, fsConst.F_OK);
    return true;
  } catch {
    return false;
  }
}

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

async function main() {
  const argv = parseArgs(process.argv.slice(2));
  const isWindows = process.platform === 'win32';
  const repoRoot = process.cwd();
  const distDir = path.join(repoRoot, 'dist');
  const distBin = path.join(distDir, isWindows ? 'tz-sea.exe' : 'tz-sea');
  const binName = (argv.as as string) || 'tz-sea';
  const skipBuild = argv.build === false; // true if --no-build is passed
  const force = Boolean(argv.force);
  const dryRun = Boolean(argv.dryRun);
  const defaultDest = isWindows
    ? path.join(process.env.USERPROFILE || os.homedir(), 'bin')
    : path.join(os.homedir(), '.local', 'bin');
  const destDir = (argv.dest as string) || defaultDest;
  const destPath = path.join(destDir, isWindows ? `${binName}.exe` : binName);

  console.log(`SEA install: target name: ${binName}`);
  console.log(`SEA install: destination directory: ${destDir}`);

  const hasDist = await exists(distBin);
  if (hasDist) {
    console.log('✔ Found existing SEA binary in dist/');
  } else {
    if (skipBuild) {
      throw new Error(`SEA binary not found at ${distBin} and --no-build specified.`);
    }
    if (dryRun) {
      console.log(`[dry-run] Would build SEA binary via: pnpm run test:sea`);
    } else {
      console.log('SEA install: building SEA binary (pnpm run test:sea)...');
      await sh('pnpm', ['run', '-s', 'test:sea']);
    }
  }

  // Ensure distBin exists now
  if (await exists(distBin)) {
    // ok
  } else {
    throw new Error(`SEA binary still not found at ${distBin}.`);
  }

  if (dryRun) {
    console.log(`[dry-run] Would mkdir -p ${destDir}`);
  } else {
    await fs.mkdir(destDir, { recursive: true });
  }

  const already = await exists(destPath);
  if (already && !force) {
    throw new Error(
      `Destination ${destPath} already exists. Re-run with --force to overwrite or use --as to change name.`,
    );
  }

  if (dryRun) {
    console.log(`[dry-run] Would copy ${distBin} -> ${destPath}`);
  } else {
    await fs.copyFile(distBin, destPath);
    if (!isWindows) {
      try {
        await fs.chmod(destPath, 0o755);
      } catch (error) {
        void error;
      }
    }
  }

  console.log('✔ SEA binary installed');

  // Check PATH
  const envPath = process.env.PATH || '';
  const pathSep = isWindows ? ';' : ':';
  const inPath = envPath.split(pathSep).some((p) => path.resolve(p) === path.resolve(destDir));
  if (!inPath) {
    if (isWindows) {
      console.warn(
        `⚠ ${destDir} is not in your PATH. Add it or move the binary to a directory in PATH.`,
      );
      console.log(
        `Example (PowerShell): [Environment]::SetEnvironmentVariable('Path', "$env:USERPROFILE\\bin;$env:Path", 'User')`,
      );
    } else {
      console.warn(
        `⚠ ${destDir} is not in your PATH. Add it to PATH in your shell rc (e.g., ~/.zshrc):`,
      );
      console.log(`   export PATH="${destDir}:$PATH"`);
    }
  }

  console.log(`Run: ${isWindows ? path.basename(destPath) : binName} --help`);
}

main().catch((error) => {
  console.error('\nSEA install failed:', error?.message || error);
  process.exit(1);
});
