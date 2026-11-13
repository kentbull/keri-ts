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
import { type HttpClient, isRequestableHttpUrl } from "./http-client.ts";
import { HTTPMessenger } from "./http-messenger.ts";
import { HTTPStreamMessenger } from "./http-stream-messenger.ts";
import { requireTcpDialer } from "./tcp-dialer.ts";
import type { TCPMessenger } from "./tcp-messenger.ts";
import type { TCPStreamMessenger } from "./tcp-stream-messenger.ts";

/** Resolved transport URLs; identity/role discovery belongs to the caller. */
export interface MessengerUrls {
  https?: string;
  http?: string;
  tcp?: string;
}

/** The messenger factories' choice from resolved URLs: the first present HTTPS, HTTP or TCP URL, usable or not. */
type EndpointSelection =
  | {
    /** The first present URL can be messaged. */
    readonly kind: "usable";
    /** The URL exactly as advertised. */
    readonly value: string;
    /** Its parsed form, which the factories hand to the concrete messenger. */
    readonly endpoint: URL;
  }
  | {
    /** No URL is present, or the first present one is refused before any I/O. */
    readonly kind: "refused";
    /** Why, for the factories' ValidationError. */
    readonly reason: string;
  };

/**
 * Choose HTTPS, HTTP, then TCP, refusing before I/O what no messenger can use: an unparseable URL, a scheme other than
 * the advertised one, an HTTP(S) URL the HTTP client refuses ({@link isRequestableHttpUrl}: embedded credentials), or
 * a TCP URL without a valid port. A refused higher-priority URL does not fall through to another transport.
 *
 * @param urls Resolved endpoints, keyed by their advertised scheme.
 * @returns The selection, never a throw.
 */
function selectEndpoint(urls: MessengerUrls): EndpointSelection {
  for (const scheme of ["https", "http", "tcp"] as const) {
    const value = urls[scheme];
    if (value === undefined) continue;
    let endpoint: URL;
    try {
      endpoint = new URL(value);
    } catch {
      return { kind: "refused", reason: `Invalid ${scheme} messenger endpoint: ${value}` };
    }
    const usable = scheme === "tcp" ? !endpoint.username && !endpoint.password : isRequestableHttpUrl(value);
    if (endpoint.protocol !== `${scheme}:` || !usable) {
      return { kind: "refused", reason: `Invalid ${scheme} messenger endpoint: ${value}` };
    }
    if (scheme === "tcp" && (!endpoint.port || Number(endpoint.port) < 1 || Number(endpoint.port) > 65535)) {
      return { kind: "refused", reason: `TCP messenger endpoint requires a valid port: ${value}` };
    }
    return { kind: "usable", value, endpoint };
  }
  return { kind: "refused", reason: "No supported messenger endpoint is available." };
}

/** Select the factories' endpoint, refusing an unusable one as a caller error. */
function endpointFrom(urls: MessengerUrls): URL {
  const selection = selectEndpoint(urls);
  if (selection.kind === "refused") throw new ValidationError(selection.reason);
  return selection.endpoint;
}

/**
 * The URL the messenger factories would use for these endpoints, or null when they would refuse it. A caller holding
 * a location another party advertised reads a refused one as no location, so it fails one delivery as unroutable
 * instead of throwing out of the factory.
 *
 * @param urls Resolved endpoints, keyed by their advertised scheme.
 * @returns The selected URL exactly as advertised, or null.
 */
export function messengerUrl(urls: MessengerUrls): string | null {
  const selection = selectEndpoint(urls);
  return selection.kind === "usable" ? selection.value : null;
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
  if (endpoint.protocol === "tcp:") return requireTcpDialer(http).messenger(endpoint.href, clock);
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
  if (endpoint.protocol === "tcp:") return requireTcpDialer(http).streamMessenger(endpoint.href, clock, payload);
  return new HTTPStreamMessenger(endpoint.href, http, payload, { destination, headers });
}
