/** Opaque timer handle returned by a runtime clock implementation. */
export type RuntimeTimer = unknown;

/** Runtime-owned clock seam for timeout-sensitive code and tests. */
export interface RuntimeClock {
  now(): number;
  setTimeout(callback: () => void, ms: number): RuntimeTimer;
  clearTimeout(timer: RuntimeTimer): void;
}

/** Runtime-owned HTTP client seam. */
export interface RuntimeHttpClient {
  fetch(url: string, init?: RequestInit): Promise<Response>;
}

/** Shared runtime services used by IO-heavy runtime components. */
export interface RuntimeServices {
  clock: RuntimeClock;
  http: RuntimeHttpClient;
}

/** Production clock backed by the JavaScript runtime. */
export const defaultRuntimeClock: RuntimeClock = Object.freeze({
  now: () => Date.now(),
  setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms),
  clearTimeout: (timer: RuntimeTimer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
});

/** Production HTTP client backed by global `fetch`. */
export const defaultRuntimeHttpClient: RuntimeHttpClient = Object.freeze({
  fetch: (url: string, init?: RequestInit) => fetch(url, init),
});

/** Production runtime services. */
export const defaultRuntimeServices: RuntimeServices = Object.freeze({
  clock: defaultRuntimeClock,
  http: defaultRuntimeHttpClient,
});

/** Resolve partial runtime service overrides against production defaults. */
export function resolveRuntimeServices(
  services: Partial<RuntimeServices> = {},
): RuntimeServices {
  return Object.freeze({
    clock: services.clock ?? defaultRuntimeClock,
    http: services.http ?? defaultRuntimeHttpClient,
  });
}
