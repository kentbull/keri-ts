export interface Logger {
  debug(message: string, ...meta: unknown[]): void;
  info(message: string, ...meta: unknown[]): void;
  warn(message: string, ...meta: unknown[]): void;
  error(message: string, ...meta: unknown[]): void;
}

export const consoleLogger: Logger = {
  debug: (message: string, ...meta: unknown[]) => {
    console.debug(message, ...meta);
  },
  info: (message: string, ...meta: unknown[]) => {
    console.log(message, ...meta);
  },
  warn: (message: string, ...meta: unknown[]) => {
    console.warn(message, ...meta);
  },
  error: (message: string, ...meta: unknown[]) => {
    console.error(message, ...meta);
  },
};

export const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
