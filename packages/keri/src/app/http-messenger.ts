/** HTTP attempts, scoped responses and explicit CESR/query intake. */
import { parse } from "cesr-ts";
import { call, ensure, type Operation, race, scoped } from "npm:effection@^3.6.0";
import type { Kevery } from "../core/eventing.ts";
import { abortable, throwOnAbort } from "./abortable.ts";
import { chunkBytes } from "./byte-source.ts";
import { attemptPostCesr, type CesrPostResult, type EgressOptions, requestFrame } from "./cesr-egress.ts";
import type { HttpClient, HttpStreamResponse } from "./http-client.ts";
import { consumeMailboxSse } from "./mailbox-sse.ts";
import { processMessages } from "./message-source.ts";
import type { ProtocolProcessor } from "./protocol-processing.ts";
import type { RuntimeClock } from "./runtime-clock.ts";

/** Actual attempt choices; HTTP client, clock and protocol processing are constructor dependencies. */
export type HTTPMessengerOptions = EgressOptions;

/**
 * Own CESR HTTP sending and finite query-response intake, following KERIpy HTTPMessenger.
 * CESR helpers prepare finite request bodies; the composed HTTP client owns
 * Request validation, fetch, response-body lifetime and native failures. This messenger selects response draining or CESR
 * parsing, using its own Kevery over shared accepted state. Poster/query owners
 * retain their queues and retry decisions; this class adds no scheduler or history.
 */
export class HTTPMessenger {
  /** Input-owned Kevery (kvy); null for an explicitly send-only messenger. */
  readonly kvy: Kevery | null;

  /**
   * Bind actual receive/HTTP/clock capabilities without issuing a request or opening stores.
   *
   * @param protocol Borrowed shared processor, or null for send-only use; creates an input-specific Kevery when supplied.
   * @param http Borrowed HTTP implementation supplied by composition; owns native request/body I/O.
   * @param clock Borrowed timer source for bounded query response intake.
   */
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

  /**
   * Send resident signed bytes; success requires the full ordinary HTTP response body.
   *
   * @param url HTTP(S) endpoint to receive the framed POST; redirect handling is manual.
   * @param msg Complete signed CESR bytes, including any prepared introduction/query messages.
   * @param options Framing, destination, extra headers and optional cancellation; header mode is the default.
   * @returns Completed HTTP delivery or typed peer refusal; no remote protocol acceptance guarantee.
   * @throws Source/parser, transport and cleanup failures propagate.
   */
  send(url: string, msg: Uint8Array, options: HTTPMessengerOptions = {}): Operation<CesrPostResult> {
    return this.stream(url, (signal) => chunkBytes(msg, { signal }), options);
  }

  /**
   * Send one pull source with typed peer refusal; infrastructure/parser/cleanup failures propagate.
   *
   * @param url HTTP(S) endpoint to receive the framed POST; redirect handling is manual.
   * @param source Creates the CESR byte source for this invocation; it must observe the supplied abort signal.
   * @param options Framing, destination, extra headers and optional cancellation; header mode is the default.
   * @returns Completed HTTP delivery or typed peer refusal; no remote protocol acceptance guarantee.
   * @throws Source/parser, transport and cleanup failures propagate.
   */
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
   *
   * @param url HTTP(S) endpoint to receive the framed POST; redirect handling is manual.
   * @param msg Complete signed CESR bytes, including any prepared introduction/query messages.
   * @param options Framing, destination, extra headers and optional cancellation; header mode is the default.
   * @throws Source/parser, transport and cleanup failures propagate. Peer refusal also throws so the query owner can retain its work.
   */
  query(url: string, msg: Uint8Array, options: HTTPMessengerOptions = {}): Operation<void> {
    if (!this.protocol || !this.kvy) throw new Error("HTTP query replies require a protocol processor");
    const querying = this.queryFrames(url, msg, options);
    if (!options.signal) return querying;
    return race([querying, throwOnAbort(options.signal)]);
  }

  /**
   * Pull one resident query frame, process its response, then advance the input.
   * A later malformed frame cannot prevent an earlier valid request from being sent.
   *
   * @param url Peer endpoint.
   * @param msg Borrowed resident CESR bytes; the parser receives copied chunks.
   * @param options Framing and caller cancellation for each request/response scope.
   */
  private queryFrames(url: string, msg: Uint8Array, options: HTTPMessengerOptions): Operation<void> {
    // deno-lint-ignore no-this-alias -- Generator callbacks have no lexical this.
    const self = this;
    return call(function*() {
      options.signal?.throwIfAborted();
      const frames = parse(chunkBytes(msg, { signal: options.signal }));
      // Each pull below joins through abortable before this parser is returned.
      yield* ensure(() => call(() => frames.return()));
      while (true) {
        const next = yield* abortable(() => frames.next(), options.signal);
        if (next.done) return;
        yield* scoped(function*() {
          const response = yield* requestFrame(url, next.value, self.http, options);
          yield* self.processQueryResponse(response, options.signal);
        });
      }
    });
  }

  /**
   * Consume the borrowed response within its HTTP request scope.
   *
   * @param response Metadata/body valid until this operation and its parser finish.
   * @param signal Caller cancellation, including cancellation during semantic dispatch.
   */
  private *processQueryResponse(response: HttpStreamResponse, signal?: AbortSignal): Operation<void> {
    // query() verifies these immutable receive capabilities before starting work.
    const protocol = this.protocol!, kvy = this.kvy!;
    if (response.headers.get("Content-Type")?.toLowerCase().startsWith("text/event-stream")) {
      // Preserve the finite query continuation window; this is not a mailbox poll worker.
      yield* consumeMailboxSse(
        response,
        new AbortController(),
        function*(message) {
          yield* processMessages((signal) => chunkBytes(message.msg, { signal }), protocol, kvy, { signal });
        },
        this.clock,
        { idleTimeoutMs: 500, maxDurationMs: 5_000, signal },
      );
    } else {
      yield* processMessages((signal) => response.body(signal), protocol, kvy, { signal });
    }
  }
}
