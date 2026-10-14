import {
  concatBytes,
  discardFrame,
  ResourceAdmissionError,
  ResourceLimitError,
  ResourcePolicy,
  type ResourceReservation,
} from "cesr-ts";
import { toEffectionFrames } from "cesr-ts/effection";
import { call, each, type Operation, resource } from "npm:effection@^3.6.0";
import type { CueEmission } from "../core/cues.ts";
import { Deck } from "../core/deck.ts";
import { ValidationError } from "../core/errors.ts";
import { Roles } from "../core/roles.ts";
import { Schemes } from "../core/schemes.ts";
import type { AgentRuntime } from "./agent-runtime.ts";
import { chunkBytes, streamBytes } from "./byte-source.ts";
import { requestFrame } from "./cesr-egress.ts";
import type { CueSink } from "./cue-runtime.ts";
import { introduce } from "./forwarding.ts";
import type { Hab, Habery } from "./habbing.ts";
import { consumeMailboxSse } from "./mailbox-sse.ts";
import { flattenRoleUrls } from "./mailboxing.ts";

/**
 * Resolve the actual transport URL for one query destination AID.
 *
 * Transport policy:
 * - explicit witness-targeted queries resolve directly from the witness AID's
 *   `locs.` replies because KERIpy witness inquiries do not depend on the
 *   queried controller advertising witness end roles
 * - prefer direct controller/agent/witness URLs when the chosen destination
 *   matches an advertised end role
 * - in mailbox-only topologies, allow queries addressed to the controller AID
 *   to ride the first mailbox endpoint URL
 */
function resolveQueryDestinationUrl(
  hab: Hab,
  queriedPre: string,
  destination: string,
  {
    explicitWitness = false,
  }: {
    explicitWitness?: boolean;
  } = {},
): string | null {
  if (explicitWitness) {
    const urls = hab.fetchUrls(destination);
    return urls[Schemes.https] ?? urls[Schemes.http] ?? null;
  }

  const ends = hab.endsFor(queriedPre);
  for (const role of [Roles.controller, Roles.agent, Roles.witness]) {
    const endpoint = flattenRoleUrls(ends[role]).find((entry) => entry.eid === destination);
    if (endpoint) {
      return endpoint.url;
    }
  }

  if (destination === queriedPre) {
    return flattenRoleUrls(ends[Roles.mailbox])[0]?.url ?? null;
  }

  return null;
}

/** A bounded signed request waiting for the runtime guard to release. */
interface QueryDelivery {
  url: string;
  body: Uint8Array;
  bodyMode: "header" | "body";
  destination: string;
}

const requestBytes = 8 * 1024 * 1024;
// Query wire, retained introduction events and their joined introduction may coexist during preparation.
const preparationBytes = 3 * requestBytes;

/** A retained request keeps its byte reservation through retries and joined transport cleanup. */
interface AdmittedQuery {
  delivery: QueryDelivery;
  reservation: ResourceReservation;
}

/** Own finite query requests; network responses are consumed only outside a guarded cue turn. */
export class QueryDeliveries {
  /** At most eight 8 MiB requests, including the active head. */
  private readonly pending = new Deck<AdmittedQuery>(undefined, 8);
  /** Shutdown must not release an active request until its transport resources have joined. */
  private delivering?: AdmittedQuery;
  /** Command-local and background drains cannot deliver the same head concurrently. */
  private draining = false;
  /** Active delivery cancellation and its joined completion belong to runtime shutdown. */
  private active?: AbortController;
  /** Shutdown waits for response resource teardown, not merely parser return. */
  private joined?: Promise<void>;
  /** Closed queues reject all later admissions. */
  private closed = false;

  /** Borrow the same ledger as runtime parsing, crypto and HTTP reply ownership. */
  constructor(private readonly resources = new ResourcePolicy()) {}

  /** Admit before synchronous wire preparation; undefined means no request was produced. */
  enqueue(prepare: () => QueryDelivery | undefined): void {
    if (this.closed) throw new Error("Query deliveries are closed");
    this.pending.checkSpace();
    if (requestBytes + preparationBytes > this.resources.limits.bytes) {
      throw new ResourceAdmissionError("Query preparation exceeds shared byte capacity", "limit");
    }
    const retained = this.resources.reserve({ bytes: requestBytes });
    if (retained.kind === "refuse") throw new ResourceAdmissionError("Query bytes are busy", retained.reason);
    let preparation: ResourceReservation | undefined;
    let queued = false;
    try {
      const credit = this.resources.reserve({ bytes: preparationBytes });
      if (credit.kind === "refuse") throw new ResourceAdmissionError("Query preparation is busy", credit.reason);
      preparation = credit.reservation;
      const delivery = prepare();
      if (!delivery) return;
      if (this.closed) throw new Error("Query deliveries are closed");
      if (delivery.body.buffer.byteLength > requestBytes) {
        throw new ResourceLimitError("Query request exceeds byte limit");
      }
      this.pending.push({ delivery, reservation: retained.reservation });
      queued = true;
    } finally {
      preparation?.release();
      if (!queued) retained.reservation.release();
    }
  }

  /** Include queued transport in runtime convergence checks. */
  get hasPending(): boolean {
    return this.draining || !this.pending.empty;
  }

  /** Release unsent request bytes at runtime shutdown. */
  *close(): Operation<void> {
    this.closed = true;
    for (const entry of this.pending) if (entry !== this.delivering) entry.reservation.release();
    this.pending.clear();
    this.active?.abort();
    if (this.joined) yield* call(() => this.joined!);
  }

  /** Send a finite snapshot outside Reactor.settle, then progressively settle each response. */
  process(runtime: AgentRuntime): Operation<void> {
    // deno-lint-ignore no-this-alias -- Generator callbacks have no lexical this.
    const self = this;
    return call(function*() {
      if (self.draining || self.closed) return;
      self.draining = true;
      const active = self.active = new AbortController();
      const done = Promise.withResolvers<void>();
      self.joined = done.promise;
      // Register completion before response resources so close() joins their teardown as well.
      yield* resource<void>(function*(provide) {
        try {
          yield* provide();
        } finally {
          if (self.closed) self.delivering?.reservation.release();
          self.delivering = undefined;
          self.draining = false;
          self.active = undefined;
          self.joined = undefined;
          done.resolve();
        }
      });
      const count = self.pending.length;
      for (let index = 0; index < count && !self.closed; index++) {
        const entry = self.pending.peekHead();
        if (!entry) break;
        active.signal.throwIfAborted();
        self.delivering = entry;
        yield* call(() => postQueryMessage(runtime, entry.delivery, active));
        // Shutdown may clear the queue while successful response cleanup is still yielding.
        active.signal.throwIfAborted();
        self.pending.pull();
        self.delivering = undefined;
        entry.reservation.release();
      }
    });
  }
}

/** One delivery scope owns upload frames and all response readers through completion or cancellation. */
function* postQueryMessage(
  runtime: AgentRuntime,
  delivery: QueryDelivery,
  controller: AbortController,
): Operation<void> {
  const channel = yield* toEffectionFrames((signal) => chunkBytes(delivery.body, { signal }), {
    signal: controller.signal,
  });
  for (const frame of yield* each(channel.frames)) {
    yield* call(function*() {
      yield* resource<void>(function*(provide) {
        try {
          yield* provide();
        } finally {
          yield* call(() => discardFrame(frame));
        }
      });
      const response = yield* requestFrame(delivery.url, frame, {
        bodyMode: delivery.bodyMode,
        destination: delivery.destination,
        services: runtime.services,
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new ValidationError(`Query delivery to ${delivery.url} failed with HTTP ${response.status}.`);
      }
      if (response.headers.get("Content-Type")?.toLowerCase().startsWith("text/event-stream")) {
        yield* consumeMailboxSse(response, new AbortController(), function*(message) {
          yield* runtime.reactor.process((signal) => chunkBytes(message.msg, { signal }), {
            signal: controller.signal,
          });
        }, { idleTimeoutMs: 500, maxDurationMs: 5_000, services: runtime.services, signal: controller.signal });
      } else {
        yield* runtime.reactor.process((signal) => streamBytes(response.body, { signal }), {
          signal: controller.signal,
        });
      }
    });
    yield* each.next();
  }
}

/**
 * Create the cue sink that actually posts outbound `qry` messages.
 *
 * Ownership split:
 * - `QueryCoordinator` decides *that* a query should be emitted and who it
 *   should target
 * - this sink decides *how* to deliver the already-chosen wire message
 */
export function queryTransportSink(
  runtime: AgentRuntime,
  hby: Habery,
  hab: Hab,
): CueSink {
  return {
    *send(emission: CueEmission): Operation<void> {
      if (emission.kind !== "wire" || emission.cue.kin !== "query") {
        return;
      }
      const destination = emission.cue.src;
      const queriedPre = emission.cue.pre;
      if (!destination || !queriedPre) return;

      const url = resolveQueryDestinationUrl(hab, queriedPre, destination, {
        explicitWitness: emission.cue.wits?.includes(destination) ?? false,
      });
      if (!url) {
        throw new ValidationError(
          `No endpoint URL found for query destination ${destination}.`,
        );
      }
      runtime.queryDeliveries.enqueue(() => {
        const messages = emission.messages[Symbol.iterator]();
        let message: Uint8Array | undefined;
        try {
          message = messages.next().value;
        } finally {
          // A query consumes one message; release its source before transport suspension.
          messages.return?.();
        }
        if (!message) return;
        if (message.buffer.byteLength > requestBytes) throw new ResourceLimitError("Query request exceeds byte limit");
        const intro = introduce(hab, destination, requestBytes - message.length);
        if (intro.length + message.length > requestBytes) {
          throw new ResourceLimitError("Query request exceeds byte limit");
        }
        return { url, body: concatBytes(intro, message), bodyMode: hby.cesrBodyMode, destination };
      });
    },
  };
}
