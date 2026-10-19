import { FetchHttpClient, type HttpClient } from "./http-client.ts";

import { type RuntimeClock, systemClock } from "./runtime-clock.ts";

/** Temporary aggregate used only by callers awaiting the explicit composition migration. */
export interface RuntimeServices {
  clock: RuntimeClock;
  http: HttpClient;
}

/** Production HTTP client backed by global `fetch`. */
export const defaultRuntimeHttpClient: HttpClient = Object.freeze(new FetchHttpClient());

/** Production runtime services. */
export const defaultRuntimeServices: RuntimeServices = Object.freeze({
  clock: systemClock,
  http: defaultRuntimeHttpClient,
});

/** Resolve partial runtime service overrides against production defaults. */
export function resolveRuntimeServices(
  services: Partial<RuntimeServices> = {},
): RuntimeServices {
  return Object.freeze({
    clock: services.clock ?? systemClock,
    http: services.http ?? defaultRuntimeHttpClient,
  });
}
