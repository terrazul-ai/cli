import type { Logger } from '../utils/logger.js';
import type { LogEntry, LogLevel } from './extract/components.js';

export interface InkLogger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string | Error) => void;
  debug: (msg: string) => void;
  isVerbose: () => boolean;
  getEntries(): LogEntry[];
  subscribe(listener: (entries: LogEntry[]) => void): () => void;
}

function normalizeMessage(input: string | Error): string {
  if (input instanceof Error) return `${input.name}: ${input.message}`;
  return input;
}

let counter = 0;

function createLogEntry(level: LogLevel, message: string): LogEntry {
  counter = (counter + 1) % Number.MAX_SAFE_INTEGER;
  return { id: `${Date.now()}-${counter}`, level, message };
}

export interface CreateInkLoggerOptions {
  baseLogger?: Logger;
  historyLimit?: number;
  mirrorToBaseLogger?: boolean;
}

export function createInkLogger({
  baseLogger,
  historyLimit = 200,
  mirrorToBaseLogger = true,
}: CreateInkLoggerOptions = {}): InkLogger {
  let entries: LogEntry[] = [];
  const listeners = new Set<(entries: LogEntry[]) => void>();

  function emit(entry: LogEntry): void {
    entries = [...entries, entry].slice(-historyLimit);
    for (const listener of listeners) {
      listener(entries);
    }
  }

  const shouldMirror = Boolean(baseLogger) && mirrorToBaseLogger;

  const inkLogger: InkLogger = {
    info: (msg: string) => {
      const norm = normalizeMessage(msg);
      if (shouldMirror) baseLogger?.info(norm);
      emit(createLogEntry('info', norm));
    },
    warn: (msg: string) => {
      const norm = normalizeMessage(msg);
      if (shouldMirror) baseLogger?.warn(norm);
      emit(createLogEntry('warn', norm));
    },
    error: (msg: string | Error) => {
      const norm = normalizeMessage(msg);
      if (shouldMirror) baseLogger?.error(norm);
      emit(createLogEntry('error', norm));
    },
    debug: (msg: string) => {
      const norm = normalizeMessage(msg);
      if (shouldMirror) baseLogger?.debug(norm);
      emit(createLogEntry('debug', norm));
    },
    isVerbose: () => baseLogger?.isVerbose?.() ?? false,
    getEntries: () => entries,
    subscribe: (listener: (entries: LogEntry[]) => void) => {
      listeners.add(listener);
      listener(entries);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  return inkLogger;
}
