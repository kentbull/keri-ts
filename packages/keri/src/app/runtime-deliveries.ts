import {
  concatBytes,
  ResourceAdmissionError,
  ResourceLimitError,
  ResourcePolicy,
  type ResourceReservation,
} from "cesr-ts";
import { call, type Operation, resource } from "npm:effection@^3.6.0";
import type { CueEmission } from "../core/cues.ts";
import type { AgentCue } from "../core/cues.ts";
import { Deck } from "../core/deck.ts";
import { DeckFullError } from "../core/deck.ts";
import { ValidationError } from "../core/errors.ts";
import { Roles } from "../core/roles.ts";
import { Schemes } from "../core/schemes.ts";
import type { AgentRuntime } from "./agent-runtime.ts";
import { chunkBytes, streamBytes } from "./byte-source.ts";
import { postCesr } from "./cesr-egress.ts";
import { CesrHttpRefusal } from "./cesr-egress.ts";
import { CueDelivery, type OwnedCueTarget } from "./cue-delivery.ts";
import { prepareCueEmission } from "./cue-preparation.ts";
import { prepareCueRoute } from "./cue-route.ts";
import type { CueSink } from "./cue-runtime.ts";
import { introduce, type RawCesrRoute, sendPreparedCesrTarget } from "./forwarding.ts";
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

/** One shared item slot owns either query bytes, a lazy cue cursor or an exact failed packet. */
type AdmittedDelivery =
  | { kind: "query"; delivery: QueryDelivery; release(): void }
  | { kind: "cue"; delivery: CueDelivery; release(): void }
  | { kind: "target"; delivery: OwnedCueTarget; release(): void };

/** Own query/cue delivery on one finite queue; network work executes outside guarded preparation. */
export class RuntimeDeliveries {
  /** Eight owner items including the active head; each kind retains its own admitted bytes. */
  private readonly pending = new Deck<AdmittedDelivery>(undefined, 8);
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
      this.pending.push({ kind: "query", delivery, release: () => retained.reservation.release() });
      queued = true;
    } finally {
      preparation?.release();
      if (!queued) retained.reservation.release();
    }
  }

  /** Guarded item preflight precedes interpretation; route resolution borrows admitted output synchronously. */
  enqueueCue(hab: Hab, cues: Deck<AgentCue>, route: (emission: CueEmission) => RawCesrRoute): boolean {
    if (this.closed) throw new Error("Runtime deliveries are closed");
    this.pending.checkSpace();
    return prepareCueEmission(hab, cues, this.resources, (owner) => {
      if (!owner.emission || owner.emission.kind !== "wire") throw new RangeError("Cue delivery requires wire");
      const captured = prepareCueRoute(this.resources, owner, () => route(owner.emission!));
      let queued = false;
      try {
        const delivery = new CueDelivery(owner, hab, captured);
        this.pending.push({ kind: "cue", delivery, release: () => delivery.release() });
        queued = true;
        return undefined;
      } finally {
        if (!queued) captured.release();
      }
    });
  }

  /** A failed independent packet retains the same lease; no target advances if the queue cannot accept it. */
  private retainFailed(target: OwnedCueTarget): boolean {
    if (this.closed) return false;
    try {
      this.pending.checkSpace();
    } catch (error) {
      if (error instanceof DeckFullError) return false;
      throw error;
    }
    this.pending.push({ kind: "target", delivery: target, release: () => target.release() });
    return true;
  }

  /** Include queued transport in runtime convergence checks. */
  get hasPending(): boolean {
    return this.draining || !this.pending.empty;
  }

  /** Join active transport before releasing retained cue, query and failed-packet owners. */
  *close(): Operation<void> {
    this.closed = true;
    this.active?.abort();
    if (this.joined) yield* call(() => this.joined!);
    const errors: unknown[] = [];
    const count = this.pending.length;
    for (let index = 0; index < count; index++) {
      const entry = this.pending.pull()!;
      try {
        entry.release();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length) throw new AggregateError(errors, "Runtime delivery cleanup failed");
  }

  /** A bounded pass advances each owner once; cue preparation is guarded, all HTTP waits are outside. */
  process(runtime: AgentRuntime): Operation<{ retiredOwners: number; pending: boolean }> {
    // deno-lint-ignore no-this-alias -- Generator callbacks have no lexical this.
    const self = this;
    return call(function*() {
      if (self.draining || self.closed) return { retiredOwners: 0, pending: self.hasPending };
      self.draining = true;
      const active = self.active = new AbortController();
      let complete!: () => void;
      self.joined = new Promise<void>((resolve) => complete = resolve);
      // Register completion before response resources so close() joins their teardown as well.
      yield* resource<void>(function*(provide) {
        try {
          yield* provide();
        } finally {
          self.draining = false;
          self.active = undefined;
          self.joined = undefined;
          complete();
        }
      });
      const count = self.pending.length;
      let retiredOwners = 0;
      for (let index = 0; index < count && !self.closed; index++) {
        const entry = self.pending.peekHead();
        if (!entry) break;
        active.signal.throwIfAborted();
        let done = true;
        if (entry.kind === "query") yield* call(() => postQueryMessage(runtime, entry.delivery, active));
        else {
          if (runtime.resources !== self.resources) {
            throw new RangeError("Cue delivery requires runtime's exact policy");
          }
          if (entry.kind === "cue") {
            done = (yield* call(() =>
              entry.delivery.step(runtime, active.signal, (target) => self.retainFailed(target))
            )) === "done";
          } else {
            let refusal: CesrHttpRefusal | undefined;
            try {
              yield* call(() =>
                sendPreparedCesrTarget(
                  entry.delivery.target,
                  runtime.services,
                  active.signal,
                  (error) => refusal = error,
                )
              );
            } catch (error) {
              if (error !== refusal && !(error instanceof ResourceAdmissionError && error.reason === "busy")) {
                throw error;
              }
              done = false;
            }
          }
        }
        // A cancelled/closed owner cannot acknowledge after successful HTTP cleanup.
        active.signal.throwIfAborted();
        if (done) {
          try {
            entry.release();
          } finally {
            self.pending.pull();
          }
          retiredOwners++;
        } else {
          self.pending.pull();
          self.pending.push(entry);
        }
      }
      return { retiredOwners, pending: !self.pending.empty };
    });
  }
}

/** One delivery scope owns upload frames and all response readers through completion or cancellation. */
function* postQueryMessage(
  runtime: AgentRuntime,
  delivery: QueryDelivery,
  controller: AbortController,
): Operation<void> {
  yield* postCesr(
    delivery.url,
    (signal) => chunkBytes(delivery.body, { signal }),
    {
      bodyMode: delivery.bodyMode,
      destination: delivery.destination,
      services: runtime.services,
      signal: controller.signal,
    },
    function*(response) {
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
    },
  );
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
      runtime.deliveries.enqueue(() => {
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
