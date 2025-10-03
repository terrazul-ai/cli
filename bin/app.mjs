#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const KNOWN_TARGETS = [
  { platform: 'darwin', arch: 'arm64', target: 'darwin-arm64', binaryName: 'tz-darwin-arm64' },
  { platform: 'darwin', arch: 'x64', target: 'darwin-x64', binaryName: 'tz-darwin-x64' },
  { platform: 'linux', arch: 'x64', target: 'linux-x64', binaryName: 'tz-linux-x64' },
  { platform: 'linux', arch: 'arm64', target: 'linux-arm64', binaryName: 'tz-linux-arm64' },
  { platform: 'win32', arch: 'x64', target: 'win32-x64', binaryName: 'tz-win32-x64.exe' },
  { platform: 'win32', arch: 'arm64', target: 'win32-arm64', binaryName: 'tz-win32-arm64.exe' },
];

const packageJsonPath = new URL('../package.json', import.meta.url);
const packageMetadata = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const CLI_VERSION = packageMetadata.version;

let seaFetcherLoader;

function isModuleNotFound(error) {
  if (!error || typeof error !== 'object') return false;
  if ('code' in error && error.code === 'ERR_MODULE_NOT_FOUND') return true;
  if (error instanceof Error && /Cannot find module/.test(error.message)) return true;
  return false;
}

async function loadEnsureSeaBinary() {
  if (!seaFetcherLoader) {
    seaFetcherLoader = (async () => {
      const candidates = [
        { specifier: '../dist/runtime/sea-fetcher.mjs', requireExists: true },
        { specifier: '../src/runtime/sea-fetcher.ts', requireExists: false },
      ];
      for (const candidate of candidates) {
        const absoluteUrl = new URL(candidate.specifier, import.meta.url);
        const absolutePath = fileURLToPath(absoluteUrl);
        if (candidate.requireExists && !fs.existsSync(absolutePath)) {
          continue;
        }
        try {
          const module = await import(absoluteUrl.href);
          if (module?.ensureSeaBinary) {
            return module.ensureSeaBinary;
          }
        } catch (error) {
          if (!isModuleNotFound(error)) {
            throw error;
          }
        }
      }
      throw new Error('Unable to locate SEA fetcher implementation');
    })();
  }

  return seaFetcherLoader;
}

export function resolveBinaryTarget(platform, arch) {
  const match = KNOWN_TARGETS.find(
    (candidate) => candidate.platform === platform && candidate.arch === arch,
  );

  if (!match) {
    const supported = KNOWN_TARGETS.map((candidate) => `${candidate.platform}/${candidate.arch}`)
      .sort()
      .join(', ');
    throw new Error(
      `Unsupported platform/arch combination: ${platform}/${arch}. Supported combinations: ${supported}`,
    );
  }

  return { target: match.target, binaryName: match.binaryName };
}

export function resolveBinaryPath(binDir, platform, arch) {
  const { binaryName } = resolveBinaryTarget(platform, arch);
  return path.join(binDir, binaryName);
}

function augmentPath(currentPath, addition, platform) {
  const delimiter = platform === 'win32' ? ';' : ':';
  if (!addition) return currentPath || '';
  if (!currentPath || currentPath.length === 0) return addition;
  const segments = currentPath.split(delimiter);
  if (!segments.includes(addition)) {
    segments.unshift(addition);
  }
  return segments.join(delimiter);
}

export async function launch() {
  const ensureSeaBinary = await loadEnsureSeaBinary();
  let binaryPath;
  try {
    binaryPath = await ensureSeaBinary({
      cliVersion: CLI_VERSION,
      platform: process.platform,
      arch: process.arch,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Failed to prepare SEA binary:', message);
    throw error;
  }

  const binaryDir = path.dirname(binaryPath);
  const env = {
    ...process.env,
    PATH: augmentPath(process.env.PATH || '', binaryDir, process.platform),
  };

  const child = spawn(binaryPath, process.argv.slice(2), {
    stdio: 'inherit',
    env,
    windowsHide: false,
  });

  const forwardSignals = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'];
  forwardSignals.forEach((signal) => {
    process.on(signal, () => {
      if (!child.killed) {
        try {
          child.kill(signal);
        } catch (error) {
          if (signal !== 'SIGBREAK') {
            console.warn(`Failed to forward ${signal} to SEA child`, error);
          }
        }
      }
    });
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });

  child.on('error', (error) => {
    console.error('Failed to start SEA binary:', error);
    process.exit(1);
  });

  return child;
}

const shouldAutostart = (() => {
  const entryPath = process.argv?.[1];
  if (!entryPath) return false;
  try {
    // Resolve symlinks to get the real path before comparing
    const realEntryPath = fs.realpathSync(entryPath);
    return import.meta.url === pathToFileURL(realEntryPath).href;
  } catch (error) {
    console.warn('Unable to determine launcher auto-start status:', error);
    return false;
  }
})();

if (shouldAutostart) {
  launch().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Terrazul CLI launcher failed:', message);
    process.exit(1);
  });
}
