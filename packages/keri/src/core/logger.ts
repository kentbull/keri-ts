export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

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

export function setLogLevel(level: LogLevel): void {
  currentLogLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLogLevel;
}

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

export const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
