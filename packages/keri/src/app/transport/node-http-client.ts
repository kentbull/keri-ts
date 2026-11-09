/** HTTP client plus TCP egress, for hosts with sockets. */

import { FetchHttpClient } from "./http-client.ts";
import type { TcpDialer } from "./tcp-dialer.ts";
import { TCPMessenger } from "./tcp-messenger.ts";
import { TCPStreamMessenger } from "./tcp-stream-messenger.ts";

/** Dials TCP endpoints through `node:net`. */
export const nodeTcpDialer: TcpDialer = {
  messenger: (url, clock, protocol = null) => new TCPMessenger(url, clock, protocol),
  streamMessenger: (url, clock, payload) => new TCPStreamMessenger(url, clock, payload),
};

/** A `FetchHttpClient` that can also reach `tcp:` endpoints. */
export class NodeHttpClient extends FetchHttpClient {
  readonly tcp = nodeTcpDialer;
}
