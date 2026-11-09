/**
 * Host seam for TCP egress.
 *
 * Browsers have no TCP, so `HttpClient` carries an optional dialer supplied by
 * hosts that do. Code that reaches a `tcp:` endpoint asks for it here and fails
 * clearly when this host cannot dial.
 */

import { ValidationError } from "../../core/errors.ts";
import type { ProtocolProcessor } from "../protocol/protocol-processing.ts";
import type { RuntimeClock } from "../runtime/runtime-clock.ts";
import type { TCPMessenger } from "./tcp-messenger.ts";
import type { TCPStreamMessenger } from "./tcp-stream-messenger.ts";

/** Creates TCP messengers for a host that has sockets. */
export interface TcpDialer {
  messenger(url: string, clock: RuntimeClock, protocol?: ProtocolProcessor | null): TCPMessenger;
  streamMessenger(url: string, clock: RuntimeClock, payload: Uint8Array): TCPStreamMessenger;
}

/** Return the host's dialer, or fail for a `tcp:` endpoint this host cannot reach. */
export function requireTcpDialer(http: { readonly tcp?: TcpDialer }): TcpDialer {
  if (!http.tcp) throw new ValidationError("TCP endpoints are unavailable on this host.");
  return http.tcp;
}
