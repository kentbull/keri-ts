/** HTTP attempt ownership, complete-response accounting and explicit CESR/query response intake. */
import type { Operation } from "npm:effection@^3.6.0";
import type { Kevery } from "../core/eventing.ts";
import { chunkBytes, streamBytes } from "./byte-source.ts";
import { attemptPostCesr, type CesrPostResult, type EgressOptions, postCesr } from "./cesr-egress.ts";
import { consumeMailboxSse } from "./mailbox-sse.ts";
import { processMessages } from "./message-source.ts";
import type { ProtocolProcessor } from "./protocol-processing.ts";
import type { RuntimeClock, RuntimeHttpClient, RuntimeServices } from "./runtime-services.ts";

/** Actual attempt choices; HTTP client, clock and protocol processing are constructor dependencies. */
export type HTTPMessengerOptions = Omit<EgressOptions, "services">;

/**
 * Own CESR HTTP sending and finite query-response intake, following KERIpy HTTPMessenger.
 * Lower HTTP helpers own framing, upload/fetch/body lifetimes and native failure
 * classification. This messenger selects plain response draining or owned CESR
 * parsing, using its own Kevery over shared accepted state. Poster/query owners
 * retain their queues and retry decisions; this class adds no scheduler or history.
 */
export class HTTPMessenger {
  /** Input-owned Kevery (kvy); null for an explicitly send-only messenger. */
  readonly kvy: Kevery | null;
  /** Resolved byte-I/O dependencies passed to lower HTTP owners; contains no component lookup. */
  private readonly services: RuntimeServices;

  /** Bind actual receive/HTTP/clock capabilities without issuing a request or opening stores. */
  constructor(
    /** Shared protocol processing; null permits ordinary send-only delivery. */
    private readonly protocol: ProtocolProcessor | null,
    /** Borrowed HTTP implementation used for actual request execution. */
    http: RuntimeHttpClient,
    /** Borrowed clock used for request/query receive deadlines. */
    clock: RuntimeClock,
  ) {
    this.kvy = protocol?.makeKevery() ?? null;
    this.services = { http, clock };
  }

  /** Send resident signed bytes; success requires the full ordinary HTTP response body. */
  send(url: string, msg: Uint8Array, options: HTTPMessengerOptions = {}): Operation<CesrPostResult> {
    return this.stream(url, (signal) => chunkBytes(msg, { signal }), options);
  }

  /** Send one pull source with typed peer refusal; infrastructure/parser/cleanup failures propagate. */
  stream(
    url: string,
    source: (signal: AbortSignal) => AsyncIterable<Uint8Array>,
    options: HTTPMessengerOptions = {},
  ): Operation<CesrPostResult> {
    return attemptPostCesr(url, source, { ...options, services: this.services });
  }

  /**
   * Send a query and process its CESR response, including the existing bounded SSE query case.
   * This request owns the response and parser through completion/cancellation. A
   * refused query throws so its coordinator retains the source packet. Ordinary
   * mailbox polling remains with its separate long-lived request owner.
   */
  *query(url: string, msg: Uint8Array, options: HTTPMessengerOptions = {}): Operation<void> {
    const protocol = this.protocol, kvy = this.kvy, services = this.services;
    if (!protocol || !kvy) throw new Error("HTTP query replies require a protocol processor");
    yield* postCesr(url, (signal) => chunkBytes(msg, { signal }), { ...options, services }, function*(response) {
      if (response.headers.get("Content-Type")?.toLowerCase().startsWith("text/event-stream")) {
        // Preserve the finite query continuation window; this is not a mailbox poll worker.
        yield* consumeMailboxSse(response, new AbortController(), function*(message) {
          yield* processMessages((signal) => chunkBytes(message.msg, { signal }), protocol, kvy, {
            signal: options.signal,
          });
        }, { idleTimeoutMs: 500, maxDurationMs: 5_000, services, signal: options.signal });
      } else {
        // Complete response parsing and reader cleanup before the underlying HTTP owner closes.
        yield* processMessages((signal) => streamBytes(response.body, { signal }), protocol, kvy, {
          signal: options.signal,
        });
      }
    });
  }
}
