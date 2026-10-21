/**
 * Concrete messenger factories corresponding to KERIpy agenting.messengerFrom
 * and streamMessengerFrom. Callers resolve identity roles/relay policy first;
 * these functions choose only among the supplied transport URLs and open no I/O.
 *
 * Ordinary messages and opaque streams are different producer operations. They
 * do not select a stored framing preference or acquire workers, stores or queues.
 */
import { ValidationError } from "../../core/errors.ts";
import type { RuntimeClock } from "../runtime/runtime-clock.ts";
import type { HttpClient } from "./http-client.ts";
import { HTTPMessenger } from "./http-messenger.ts";
import { HTTPStreamMessenger } from "./http-stream-messenger.ts";
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

/**
 * Bind ordinary signed-message delivery to the first present HTTPS/HTTP/TCP URL.
 * A malformed higher-priority URL fails rather than falling through to another
 * transport. There is no network retry or endpoint discovery at this boundary.
 *
 * @param destination Remote AID carried in the HTTP CESR-DESTINATION header.
 * @param urls Already resolved endpoints, keyed by their actual scheme.
 * @param http Borrowed HTTP implementation, used only for an HTTP(S) selection.
 * @param clock Borrowed deadline clock, used only for a TCP selection.
 * @param headers Additional HTTP headers, such as Authorization; ignored by TCP.
 * @returns A transmit-only messenger; caller runs send and owns its lifetime.
 */
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

/**
 * Bind one prepared opaque payload to HTTP PUT or raw TCP delivery.
 * No parser, re-signing or fallback to ordinary POST is introduced. This follows
 * KERIpy's separate stream factory; "stream" describes the transport operation,
 * while this API borrows finite resident bytes.
 *
 * @param destination Remote AID carried in HTTP framing; not a receipt/acceptance claim.
 * @param urls Resolved endpoints, with the same fail-fast preference as messengerFrom.
 * @param payload Complete prepared wire; caller must keep it unchanged until send finishes.
 * @param http Borrowed HTTP service for a possible PUT.
 * @param clock Borrowed clock for possible TCP connection/drain deadlines.
 * @param headers Additional HTTP headers; ignored by TCP.
 * @returns An unstarted messenger with no receive loop or scheduling ownership.
 */
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
