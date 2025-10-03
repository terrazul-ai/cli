import chalk from 'chalk';

export interface Logger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string | Error) => void;
  debug: (msg: string) => void;
  isVerbose: () => boolean;
}

export interface LoggerOptions {
  verbose?: boolean;
}

export function createLogger(opts: LoggerOptions = {}): Logger {
  const verbose = Boolean(opts.verbose);
  return {
    info: (msg: string) => {
      // Using console.log for info to ease testing via spies
      // Keep output simple and colored subtly
      console.log(chalk.cyan('info'), msg);
    },
    warn: (msg: string) => {
      console.warn(chalk.yellow('warn'), msg);
    },
    error: (msg: string | Error) => {
      const text = msg instanceof Error ? `${msg.name}: ${msg.message}` : msg;
      console.error(chalk.red('error'), text);
    },
    debug: (msg: string) => {
      if (verbose) {
        console.log(chalk.gray('debug'), msg);
      }
    },
    isVerbose: () => verbose,
  } as const;
}
