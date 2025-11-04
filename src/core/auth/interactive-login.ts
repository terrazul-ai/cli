import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import os from 'node:os';
import readline from 'node:readline';

import { LoginStateManager } from './state-manager.js';
import { validatePAT } from '../../utils/auth.js';
import { launchBrowser, type BrowserLaunchResult } from '../../utils/browser.js';

import type { AuthService, CLICompletionResponse } from './service.js';
import type { Logger } from '../../utils/logger.js';
import type { Telemetry } from '../../utils/telemetry.js';
import type { AddressInfo } from 'node:net';

const HOST = '127.0.0.1';
const SUCCESS_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Terrazul CLI Login</title>
    <style>
      body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0f172a; color: #e0f2fe; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
      .card { background: rgba(15, 23, 42, 0.9); border-radius: 16px; padding: 32px 40px; box-shadow: 0 25px 50px -12px rgba(15, 23, 42, 0.9); text-align: center; max-width: 420px; }
      h1 { margin: 0 0 12px; font-size: 1.75rem; }
      p { font-size: 1rem; line-height: 1.5; }
      .success { color: #34d399; font-weight: 600; font-size: 1.125rem; }
    </style>
    <script>
      window.addEventListener('load', () => {
        try {
          const url = new URL(window.location.href);
          url.search = '';
          window.history.replaceState({}, document.title, url.toString());
        } catch { /* ignore */ }
      });
    </script>
  </head>
  <body>
    <div class="card">
      <div class="success">Authentication successful!</div>
      <p>You can return to the Terrazul CLI — this tab is no longer needed.</p>
    </div>
  </body>
</html>`;

const ERROR_HTML = (message: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Terrazul CLI Login</title>
    <style>
      body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #111827; color: #fee2e2; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
      .card { background: rgba(17, 24, 39, 0.9); border-radius: 16px; padding: 32px 40px; box-shadow: 0 20px 45px -12px rgba(15, 23, 42, 0.8); text-align: center; max-width: 480px; }
      h1 { margin: 0 0 12px; font-size: 1.75rem; }
      p { font-size: 1rem; line-height: 1.5; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Authentication Error</h1>
      <p>${message}</p>
    </div>
  </body>
</html>`;

export class LoginFlowError extends Error {
  exitCode: number;
  constructor(message: string, exitCode: number) {
    super(message);
    this.name = 'LoginFlowError';
    this.exitCode = exitCode;
  }
}

export interface LoginFlowResult extends CLICompletionResponse {
  state: string;
  via: 'callback' | 'manual';
}

export interface InteractiveLoginOptions {
  logger: Logger;
  authService: AuthService;
  stateManager?: LoginStateManager;
  hostname?: string;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  telemetry?: Telemetry;
}

interface CallbackResolution {
  resolve: (value: LoginFlowResult) => void;
  reject: (reason: Error) => void;
}

function parsePort(info: AddressInfo | string | null): number {
  if (!info || typeof info === 'string') return Number.NaN;
  return info.port;
}

function respond(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(body);
}

function createSignalHandler(
  cleanup: () => void,
  reject: (err: Error) => void,
  logger: Logger,
): () => void {
  return () => {
    logger.warn('Authentication cancelled.');
    cleanup();
    reject(new LoginFlowError('Authentication cancelled by signal', 130));
  };
}

function registerSignalHandlers(
  cleanup: () => void,
  reject: (err: Error) => void,
  logger: Logger,
): Array<[NodeJS.Signals, () => void]> {
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  const handlers: Array<[NodeJS.Signals, () => void]> = [];
  for (const sig of signals) {
    const handler = createSignalHandler(cleanup, reject, logger);
    handlers.push([sig, handler]);
    process.on(sig, handler);
  }
  return handlers;
}

function setupManualPrompt(params: {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  logger: Logger;
  finalize: (token: string, via: 'manual') => Promise<LoginFlowResult>;
  onSuccess: (result: LoginFlowResult) => void;
  onError: (error: Error) => void;
  telemetry?: Telemetry;
}): () => void {
  const { input, output, logger, finalize, onSuccess, onError, telemetry } = params;
  if (!input) return () => {};
  const isTTY = (input as NodeJS.ReadStream)?.isTTY ?? false;
  const rl = readline.createInterface({
    input,
    output: output ?? process.stdout,
    terminal: isTTY,
  });

  let active = true;
  const safeClose = () => {
    if (!active) return;
    active = false;
    rl.close();
  };

  const ask = () => {
    rl.question('Or paste your token here: ', async (answer) => {
      const token = answer.trim();
      if (!validatePAT(token)) {
        logger.warn('[login] Invalid token format. Expected value starting with tz_.');
        telemetry?.track('login_manual_invalid');
        ask();
        return;
      }
      try {
        const result = await finalize(token, 'manual');
        safeClose();
        onSuccess(result);
      } catch (error) {
        const message =
          error instanceof Error && error.message ? error.message : 'Token validation failed.';
        logger.warn(`[login] ${message} Please try again.`);
        telemetry?.track('login_manual_failure');
        if (active) ask();
      }
    });
  };

  rl.on('SIGINT', () => {
    safeClose();
    onError(new LoginFlowError('Authentication cancelled by signal', 130));
  });

  ask();
  telemetry?.track('login_manual_prompt');
  return () => {
    safeClose();
  };
}

export async function runInteractiveLogin(opts: InteractiveLoginOptions): Promise<LoginFlowResult> {
  opts.telemetry?.track('login_launch', {
    hostname: opts.hostname ?? os.hostname(),
  });
  let server: Server | undefined;
  let port = 0;
  const callbacks: CallbackResolution = {
    resolve: () => void 0,
    reject: () => void 0,
  };

  let settled = false;
  const resultPromise = new Promise<LoginFlowResult>((resolve, reject) => {
    callbacks.resolve = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    callbacks.reject = (reason) => {
      if (settled) return;
      settled = true;
      reject(reason);
    };
  });

  const stateManager =
    opts.stateManager ??
    new LoginStateManager({
      onTimeout: () => {
        callbacks.reject(new LoginFlowError('Authentication timed out after 5 minutes.', 1));
      },
    });

  let manualCleanup: (() => void) | undefined;

  try {
    server = createServer();
    await new Promise<void>((resolve, reject) => {
      server!.once('error', (err) => reject(err));
      server!.listen(0, HOST, () => resolve());
    }).catch(() => {
      throw new LoginFlowError(
        'Failed to start local server. Please ensure localhost networking is available.',
        2,
      );
    });

    const address = server.address();
    port = parsePort(address);
    if (!Number.isFinite(port) || port <= 0) {
      throw new LoginFlowError('Failed to determine callback port. Please retry login.', 2);
    }

    const callbackUrl = `http://${HOST}:${port}`;
    const hostname = opts.hostname ?? os.hostname();
    const initiate = await opts.authService.initiateCliLogin({ callbackUrl, hostname });
    const stateValue = initiate.state;

    stateManager.establish({ state: stateValue, expiresAt: new Date(initiate.expiresAt) });

    const finalize = async (
      token: string,
      via: 'callback' | 'manual',
    ): Promise<LoginFlowResult> => {
      const completion = await opts.authService.completeCliLogin({
        state: stateValue,
        token,
      });
      stateManager.clear();
      const result: LoginFlowResult = {
        ...completion,
        state: stateValue,
        via,
      };
      const eventName = via === 'manual' ? 'login_manual_success' : 'login_callback_success';
      opts.telemetry?.track(eventName, { via });
      return result;
    };

    server.on('request', async (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'GET') {
        respond(res, 405, ERROR_HTML('Unsupported method.'));
        return;
      }
      const url = new URL(req.url ?? '/', `http://${HOST}:${port}`);
      const state = url.searchParams.get('state');
      if (!stateManager.validate(state)) {
        opts.logger.warn('[login] Received authentication callback with invalid state.');
        respond(
          res,
          400,
          ERROR_HTML('Invalid or expired login session. Please try again from the CLI.'),
        );
        return;
      }
      const token = url.searchParams.get('token');
      if (!token) {
        respond(res, 400, ERROR_HTML('Missing token in callback payload.'));
        return;
      }
      try {
        const result = await finalize(token, 'callback');
        respond(res, 200, SUCCESS_HTML);
        callbacks.resolve(result);
      } catch (error) {
        const message =
          error instanceof Error && error.message
            ? error.message
            : 'Failed to verify token. Please try again.';
        respond(res, 400, ERROR_HTML(message));
        opts.telemetry?.track('login_callback_failure', { reason: message });
        callbacks.reject(error instanceof LoginFlowError ? error : new LoginFlowError(message, 1));
      }
    });

    const loginUrl = new URL(initiate.browserUrl);
    loginUrl.searchParams.set('state', stateValue);
    loginUrl.searchParams.set('port', String(port));

    console.log('Starting interactive login flow...');
    console.log(`If no browser opens, visit: ${loginUrl.toString()}`);
    opts.logger.debug(`[login] Listening on ${callbackUrl}`);
    opts.logger.debug('[login] Waiting for authentication to complete...');

    manualCleanup = setupManualPrompt({
      input: opts.input ?? process.stdin,
      output: opts.output ?? process.stdout,
      logger: opts.logger,
      finalize: (token) => finalize(token, 'manual'),
      onSuccess: (result) => callbacks.resolve(result),
      onError: (error) => callbacks.reject(error),
      telemetry: opts.telemetry,
    });

    const browserResult: BrowserLaunchResult = await launchBrowser(loginUrl.toString(), {
      logger: opts.logger,
    });
    if (!browserResult.success && !browserResult.suppressed) {
      opts.logger.warn(
        '[login] Unable to launch browser automatically. Please open the URL above manually.',
      );
    }

    const cleanup = () => {
      manualCleanup?.();
      server?.close();
    };

    const signalHandlers = registerSignalHandlers(cleanup, callbacks.reject, opts.logger);

    return await resultPromise.finally(() => {
      cleanup();
      for (const [sig, handler] of signalHandlers) {
        process.off(sig, handler);
      }
    });
  } catch (error) {
    manualCleanup?.();
    if (error instanceof LoginFlowError) {
      throw error;
    }
    const message =
      error instanceof Error && error.message ? error.message : 'Unexpected error during login.';
    throw new LoginFlowError(message, 1);
  }
}
