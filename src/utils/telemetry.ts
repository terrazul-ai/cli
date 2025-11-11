export interface Telemetry {
  track: (event: string, payload?: Record<string, unknown>) => void;
}

export class NoopTelemetry implements Telemetry {
  track(): void {
    // no-op
  }
}

export class DebugTelemetry implements Telemetry {
  constructor(private readonly emit: (message: string) => void) {}

  track(event: string, payload: Record<string, unknown> = {}): void {
    const safePayload = Object.fromEntries(
      Object.entries(payload).filter(([key]) => key.toLowerCase() !== 'token'),
    );
    this.emit(`telemetry ${event} ${JSON.stringify(safePayload)}`);
  }
}

export function createTelemetry(enabled: boolean, emit: (message: string) => void): Telemetry {
  if (!enabled) return new NoopTelemetry();
  return new DebugTelemetry(emit);
}
