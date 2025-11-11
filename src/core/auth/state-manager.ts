export interface LoginState {
  state: string;
  expiresAt: Date;
}

export interface LoginStateManagerOptions {
  timeoutMs?: number;
  now?: () => Date;
  onTimeout?: () => void;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

function toDate(input: Date | string | number): Date {
  if (input instanceof Date) {
    return new Date(input.getTime());
  }
  if (typeof input === 'number') {
    return new Date(input);
  }
  if (typeof input === 'string') {
    const parsed = new Date(input);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return new Date(Date.now() + DEFAULT_TIMEOUT_MS);
}

/**
 * Manages CLI login state values with deterministic timeout behaviour.
 */
export class LoginStateManager {
  private readonly timeoutMs: number;
  private readonly now: () => Date;
  private readonly onTimeout?: () => void;
  private timeoutHandle: NodeJS.Timeout | null = null;
  private current?: LoginState;

  constructor(opts: LoginStateManagerOptions = {}) {
    this.timeoutMs =
      typeof opts.timeoutMs === 'number' && opts.timeoutMs > 0
        ? opts.timeoutMs
        : DEFAULT_TIMEOUT_MS;
    this.now = opts.now ?? (() => new Date());
    this.onTimeout = opts.onTimeout;
  }

  establish(state: { state: string; expiresAt: Date | string | number }): void {
    this.clear();
    const expiresAt = toDate(state.expiresAt);
    this.current = { state: state.state, expiresAt };
    this.scheduleTimeout();
  }

  snapshot(): LoginState | undefined {
    if (!this.current) return undefined;
    return {
      state: this.current.state,
      expiresAt: new Date(this.current.expiresAt.getTime()),
    };
  }

  validate(expected: string | null | undefined): boolean {
    if (!this.current) return false;
    if (!expected || expected !== this.current.state) return false;
    if (this.isExpired()) return false;
    return true;
  }

  clear(): void {
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
    this.current = undefined;
  }

  private scheduleTimeout(): void {
    if (!this.current) return;
    const now = this.now().getTime();
    const expiresAt = this.current.expiresAt.getTime();
    const millisUntilExpiry = Math.max(expiresAt - now, 0);
    const timeoutDelay = Math.min(this.timeoutMs, millisUntilExpiry);
    if (timeoutDelay <= 0) {
      this.handleTimeout();
      return;
    }
    this.timeoutHandle = setTimeout(() => this.handleTimeout(), timeoutDelay);
    this.timeoutHandle.unref?.();
  }

  private isExpired(): boolean {
    if (!this.current) return true;
    return this.current.expiresAt.getTime() <= this.now().getTime();
  }

  private handleTimeout(): void {
    this.clear();
    this.onTimeout?.();
  }
}
