import { spawn } from 'node:child_process';

import type { Logger } from './logger.js';

export interface BrowserLauncher {
  command: string;
  args: string[];
}

export interface BrowserLaunchResult {
  success: boolean;
  command: string;
  args: string[];
  suppressed?: boolean;
  error?: Error;
}

function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

export function resolveBrowserLauncher(platform = process.platform): BrowserLauncher {
  if (platform === 'darwin') {
    return { command: 'open', args: [] };
  }
  if (platform === 'win32') {
    return { command: 'cmd.exe', args: ['/c', 'start', ''] };
  }
  return { command: 'xdg-open', args: [] };
}

export function launchBrowser(
  url: string,
  opts: { logger: Logger; launcher?: BrowserLauncher },
): Promise<BrowserLaunchResult> {
  const launcher = opts.launcher ?? resolveBrowserLauncher();
  const args = [...launcher.args, url];

  if (isTruthy(process.env.TZ_LOGIN_DISABLE_BROWSER)) {
    opts.logger.info('Browser launch skipped (TZ_LOGIN_DISABLE_BROWSER set).');
    return Promise.resolve({ success: false, command: launcher.command, args, suppressed: true });
  }

  return new Promise<BrowserLaunchResult>((resolve) => {
    try {
      const child = spawn(launcher.command, args, {
        detached: true,
        stdio: 'ignore',
      });

      let resolved = false;

      // Handle spawn errors (e.g., command not found, permission denied)
      child.on('error', (error) => {
        if (resolved) return; // Already resolved successfully
        resolved = true;
        const message = error.message || 'Unknown error';
        opts.logger.warn(
          `Failed to open browser automatically. Please open ${url} manually. (${message})`,
        );
        resolve({
          success: false,
          command: launcher.command,
          args,
          error,
        });
      });

      // Give a small window for immediate spawn errors before considering it successful
      // This helps catch errors like ENOENT (command not found) quickly
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          child.unref?.();
          opts.logger.debug('\n\nOpening browser for authentication...');
          resolve({ success: true, command: launcher.command, args });
        }
      }, 100);
    } catch (error) {
      // Synchronous errors during spawn setup
      const message =
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : 'Unknown error';
      opts.logger.warn(
        `Failed to open browser automatically. Please open ${url} manually. (${message})`,
      );
      resolve({
        success: false,
        command: launcher.command,
        args,
        error: error instanceof Error ? error : undefined,
      });
    }
  });
}
