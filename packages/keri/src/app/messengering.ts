/** Concrete transport construction from already resolved endpoints, following KERIpy. */
import { ValidationError } from "../core/errors.ts";
import type { HttpClient } from "./http-client.ts";
import { HTTPMessenger } from "./http-messenger.ts";
import { HTTPStreamMessenger } from "./http-stream-messenger.ts";
import type { RuntimeClock } from "./runtime-clock.ts";
import { TCPMessenger } from "./tcp-messenger.ts";
import { TCPStreamMessenger } from "./tcp-stream-messenger.ts";

/** Resolved transport URLs; identity/role discovery belongs to the caller. */
export interface MessengerUrls {
  https?: string;
  http?: string;
  tcp?: string;
}

/** Choose HTTPS, HTTP, then TCP and reject a mismatched advertised scheme before I/O. */
function endpointFrom(urls: MessengerUrls): URL {
  for (const scheme of ["https", "http", "tcp"] as const) {
    const value = urls[scheme];
    if (value === undefined) continue;
    const endpoint = new URL(value);
    if (endpoint.protocol !== `${scheme}:` || endpoint.username || endpoint.password) {
      throw new ValidationError(`Invalid ${scheme} messenger endpoint: ${value}`);
    }
    if (scheme === "tcp" && (!endpoint.port || Number(endpoint.port) < 1 || Number(endpoint.port) > 65535)) {
      throw new ValidationError(`TCP messenger endpoint requires a valid port: ${value}`);
    }
    return endpoint;
  }
  throw new ValidationError("No supported messenger endpoint is available.");
}

/** Construct ordinary signed-message delivery without network, storage or receive dependencies. */
export function messengerFrom(
  destination: string,
  urls: MessengerUrls,
  http: HttpClient,
  clock: RuntimeClock,
  headers?: HeadersInit,
): HTTPMessenger | TCPMessenger {
  const endpoint = endpointFrom(urls);
  if (endpoint.protocol === "tcp:") return new TCPMessenger(endpoint.href, clock);
  return new HTTPMessenger(endpoint.href, http, { destination, headers });
}

/** Construct one opaque PUT/raw-TCP delivery; producers own preparation and sealing. */
export function streamMessengerFrom(
  destination: string,
  urls: MessengerUrls,
  payload: Uint8Array,
  http: HttpClient,
  clock: RuntimeClock,
  headers?: HeadersInit,
): HTTPStreamMessenger | TCPStreamMessenger {
  const endpoint = endpointFrom(urls);
  if (endpoint.protocol === "tcp:") return new TCPStreamMessenger(endpoint.href, clock, payload);
  return new HTTPStreamMessenger(endpoint.href, http, payload, { destination, headers });
}
