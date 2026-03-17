/** Supported logger severity names in ascending verbosity order. */
export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
/** Union of supported logger severity names. */
export type LogLevel = (typeof LOG_LEVELS)[number];

/** Minimal logger interface used across DB/app/runtime seams. */
export interface Logger {
  debug(message: string, ...meta: unknown[]): void;
  info(message: string, ...meta: unknown[]): void;
  warn(message: string, ...meta: unknown[]): void;
  error(message: string, ...meta: unknown[]): void;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

let currentLogLevel: LogLevel = "warn";

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[currentLogLevel];
}

/** Set the process-local minimum log level for the built-in console logger. */
export function setLogLevel(level: LogLevel): void {
  currentLogLevel = level;
}

/** Read the current process-local minimum log level. */
export function getLogLevel(): LogLevel {
  return currentLogLevel;
}

/** Default logger that forwards to `console.*` with level gating. */
export const consoleLogger: Logger = {
  debug: (message: string, ...meta: unknown[]) => {
    if (shouldLog("debug")) {
      console.debug(message, ...meta);
    }
  },
  info: (message: string, ...meta: unknown[]) => {
    if (shouldLog("info")) {
      console.log(message, ...meta);
    }
  },
  warn: (message: string, ...meta: unknown[]) => {
    if (shouldLog("warn")) {
      console.warn(message, ...meta);
    }
  },
  error: (message: string, ...meta: unknown[]) => {
    if (shouldLog("error")) {
      console.error(message, ...meta);
    }
  },
};

/** Logger implementation that discards all messages. */
export const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
