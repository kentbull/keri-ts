/** HTTP attempt ownership, complete-response accounting and explicit CESR/query response intake. */
import type { Operation } from "npm:effection@^3.6.0";
import type { Kevery } from "../core/eventing.ts";
import { chunkBytes } from "./byte-source.ts";
import { attemptPostCesr, type CesrPostResult, type EgressOptions, postCesr } from "./cesr-egress.ts";
import type { HttpClient } from "./http-client.ts";
import { consumeMailboxSse } from "./mailbox-sse.ts";
import { processMessages } from "./message-source.ts";
import type { ProtocolProcessor } from "./protocol-processing.ts";
import type { RuntimeClock } from "./runtime-clock.ts";

/** Actual attempt choices; HTTP client, clock and protocol processing are constructor dependencies. */
export type HTTPMessengerOptions = EgressOptions;

/**
 * Own CESR HTTP sending and finite query-response intake, following KERIpy HTTPMessenger.
 * CESR helpers own wire framing; the composed HTTP client owns upload/fetch/body
 * lifetimes and native failures. This messenger selects response draining or CESR
 * parsing, using its own Kevery over shared accepted state. Poster/query owners
 * retain their queues and retry decisions; this class adds no scheduler or history.
 */
export class HTTPMessenger {
  /** Input-owned Kevery (kvy); null for an explicitly send-only messenger. */
  readonly kvy: Kevery | null;

  /** Bind actual receive/HTTP/clock capabilities without issuing a request or opening stores. */
  constructor(
    /** Shared protocol processing; null permits ordinary send-only delivery. */
    private readonly protocol: ProtocolProcessor | null,
    /** Borrowed HTTP implementation used for actual request execution. */
    private readonly http: HttpClient,
    /** Borrowed clock used for request/query receive deadlines. */
    private readonly clock: RuntimeClock,
  ) {
    this.kvy = protocol?.makeKevery() ?? null;
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
    return attemptPostCesr(url, source, this.http, options);
  }

  /**
   * Send a query and process its CESR response, including the existing bounded SSE query case.
   * This request owns the response and parser through completion/cancellation. A
   * refused query throws so its coordinator retains the source packet. Ordinary
   * mailbox polling remains with its separate long-lived request owner.
   */
  *query(url: string, msg: Uint8Array, options: HTTPMessengerOptions = {}): Operation<void> {
    const protocol = this.protocol, kvy = this.kvy, clock = this.clock;
    if (!protocol || !kvy) throw new Error("HTTP query replies require a protocol processor");
    yield* postCesr(url, (signal) => chunkBytes(msg, { signal }), this.http, options, function*(response) {
      if (response.headers.get("Content-Type")?.toLowerCase().startsWith("text/event-stream")) {
        // Preserve the finite query continuation window; this is not a mailbox poll worker.
        yield* consumeMailboxSse(response, new AbortController(), function*(message) {
          yield* processMessages((signal) => chunkBytes(message.msg, { signal }), protocol, kvy, {
            signal: options.signal,
          });
        }, { idleTimeoutMs: 500, maxDurationMs: 5_000, clock, signal: options.signal });
      } else {
        // Complete response parsing and reader cleanup before the underlying HTTP owner closes.
        yield* processMessages((signal) => response.body(signal), protocol, kvy, {
          signal: options.signal,
        });
      }
    });
  }
}
