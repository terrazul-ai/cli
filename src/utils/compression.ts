import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const ZSTD_MODULE = '@napi-rs/zstd';

function isModuleNotFound(error: unknown): error is NodeJS.ErrnoException {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const err = error as NodeJS.ErrnoException;

  // Check error code (CommonJS: MODULE_NOT_FOUND, ESM: ERR_MODULE_NOT_FOUND)
  if ('code' in err && (err.code === 'MODULE_NOT_FOUND' || err.code === 'ERR_MODULE_NOT_FOUND')) {
    return true;
  }

  // Fallback: check error message for "Cannot find" pattern
  if (err instanceof Error && /cannot find (module|package)/i.test(err.message)) {
    return true;
  }

  return false;
}

async function tryDecompressWithModule(source: string, destination: string): Promise<boolean> {
  try {
    const zstd = (await import(ZSTD_MODULE)) as { decompress: (input: Buffer) => Buffer };
    const input = await fs.readFile(source);
    const output = zstd.decompress(input);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, output);
    return true;
  } catch (error) {
    if (isModuleNotFound(error)) {
      return false;
    }
    throw error;
  }
}

async function decompressWithCli(source: string, destination: string) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const child = spawn('zstd', ['-d', source, '-o', destination, '--force'], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        const detail = stderr.trim();
        const message = detail.length > 0 ? detail : `zstd exited with code ${code}`;
        reject(new Error(message));
      }
    });
  });
}

export async function decompressZst(source: string, destination: string): Promise<void> {
  if (process.env.TERRAZUL_SEA_SKIP_DECOMPRESS === '1') {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(source, destination);
    return;
  }

  if (await tryDecompressWithModule(source, destination)) {
    return;
  }

  try {
    await decompressWithCli(source, destination);
  } catch (error) {
    throw new Error(
      `Failed to decompress ${source} with ${ZSTD_MODULE} or zstd CLI: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
