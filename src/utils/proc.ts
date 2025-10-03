import { spawn } from 'node:child_process';

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  input?: string;
  shell?: boolean;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

// Cross-platform process runner with simple API. Keeps behavior minimal for testability.
export function runCommand(
  command: string,
  args: string[] = [],
  opts: RunOptions = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    // Merge provided env with current process env so partial overrides don't
    // clobber essential variables like PATH/HOME. Callers can still unset by
    // explicitly setting a key to undefined or an empty string.
    const mergedEnv: NodeJS.ProcessEnv | undefined = opts.env
      ? { ...process.env, ...opts.env }
      : process.env;

    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: mergedEnv,
      shell: opts.shell ?? false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d: Buffer | string) => {
      stdout += typeof d === 'string' ? d : d.toString();
    });
    child.stderr.on('data', (d: Buffer | string) => {
      stderr += typeof d === 'string' ? d : d.toString();
    });

    let timeout: NodeJS.Timeout | undefined;
    if (opts.timeoutMs && opts.timeoutMs > 0) {
      timeout = setTimeout(() => {
        // Kill the process on timeout; use SIGKILL on *nix, default on Windows
        try {
          child.kill(process.platform === 'win32' ? undefined : 'SIGKILL');
        } catch {
          // ignore
        }
      }, opts.timeoutMs);
    }

    child.once('error', (err) => {
      if (timeout) clearTimeout(timeout);
      reject(err);
    });

    child.on('close', (code) => {
      if (timeout) clearTimeout(timeout);
      resolve({ stdout, stderr, exitCode: code });
    });

    if (opts.input) {
      child.stdin.write(opts.input);
      child.stdin.end();
    }
  });
}
