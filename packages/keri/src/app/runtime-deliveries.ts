import {
  concatBytes,
  ResourceAdmissionError,
  ResourceLimitError,
  ResourcePolicy,
  type ResourceReservation,
} from "cesr-ts";
import { call, type Operation, resource } from "npm:effection@^3.6.0";
import { admitCueBytes } from "../core/cue-admission.ts";
import type { CueQueueInput } from "../core/cue-publishing.ts";
import { cueReader } from "../core/cue-publishing.ts";
import type { CueEmission, QueryCue } from "../core/cues.ts";
import type { AgentCue } from "../core/cues.ts";
import { Deck } from "../core/deck.ts";
import { DeckFullError } from "../core/deck.ts";
import { ValidationError } from "../core/errors.ts";
import { Roles } from "../core/roles.ts";
import { Schemes } from "../core/schemes.ts";
import type { AgentRuntime } from "./agent-runtime.ts";
import { chunkBytes, streamBytes } from "./byte-source.ts";
import { postCesr } from "./cesr-egress.ts";
import { cueDeliveryBudget } from "./cue-budget.ts";
import { CueDelivery, type CueTargetPreparation, type OwnedCueTarget } from "./cue-delivery.ts";
import { admitCueEmission, type CuePreparationResult, type PreparedCueEmission } from "./cue-preparation.ts";
import { admitCueRoute } from "./cue-route.ts";
import type { CueAdmission, CueSink } from "./cue-runtime.ts";
import { DirectReplyDelivery } from "./direct-reply-delivery.ts";
import { attemptPreparedCesrTarget, introduce, type RawCesrRoute } from "./forwarding.ts";
import type { Hab, Habery } from "./habbing.ts";
import { consumeMailboxSse } from "./mailbox-sse.ts";
import { flattenRoleUrls } from "./mailboxing.ts";
import type { QueryReply } from "./query-replies.ts";
import { converseCesrTcp } from "./tcp-conversation.ts";

/** One local query queue attempt; only its own item/byte capacity refusal becomes a value. */
type QueryDeliveryAdmission =
  | { kind: "queued" }
  | { kind: "ineligible" }
  | { kind: "refuse"; error: ResourceAdmissionError | DeckFullError };

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
    return urls[Schemes.https] ?? urls[Schemes.http] ?? urls[Schemes.tcp] ?? null;
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

const { wireBytes: requestBytes, routeBytes, preparationBytes } = cueDeliveryBudget;

/** One shared item slot owns either query bytes, a lazy cue cursor or an exact failed packet. */
type AdmittedDelivery =
  | { kind: "query"; delivery: QueryDelivery; release(): void }
  | { kind: "cue"; delivery: CueDelivery | DirectReplyDelivery; release(): void }
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

  /** Admit before synchronous wire preparation; an ineligible result never acknowledges queueing. */
  enqueue(
    prepare: () => QueryDelivery | undefined,
    cue?: QueryCue,
    sourceRetainedBytes = 0,
  ): QueryDeliveryAdmission {
    if (this.closed) throw new Error("Runtime deliveries are closed");
    if (this.pending.capacity < 1) throw new ResourceLimitError("Batch exceeds deck capacity");
    if (this.pending.length === this.pending.capacity) {
      return { kind: "refuse", error: new DeckFullError("Deck capacity exceeded") };
    }
    if (!Number.isSafeInteger(sourceRetainedBytes) || sourceRetainedBytes < 0) {
      throw new RangeError("Invalid query source retention");
    }
    const floor = requestBytes + routeBytes + preparationBytes + sourceRetainedBytes;
    if (floor > this.resources.limits.bytes) {
      return {
        kind: "refuse",
        error: new ResourceAdmissionError("Query preparation exceeds shared byte capacity", "limit"),
      };
    }
    const input = cue
      ? admitCueBytes(this.resources, [cue], undefined, { additionalBytes: floor, maxBytes: requestBytes })
      : undefined;
    if (input?.kind === "refuse") return input;
    let retained: ResourceReservation | undefined, preparation: ResourceReservation | undefined;
    let queued = false;
    try {
      const credit = this.resources.reserve({ bytes: requestBytes + routeBytes });
      if (credit.kind === "refuse") {
        return { kind: "refuse", error: new ResourceAdmissionError("Query bytes are busy", credit.reason) };
      }
      retained = credit.reservation;
      const temporary = this.resources.reserve({ bytes: preparationBytes });
      if (temporary.kind === "refuse") {
        return { kind: "refuse", error: new ResourceAdmissionError("Query preparation is busy", temporary.reason) };
      }
      preparation = temporary.reservation;
      const delivery = prepare();
      if (!delivery) return { kind: "ineligible" };
      if (this.closed) throw new Error("Runtime deliveries are closed");
      if (delivery.body.buffer.byteLength > requestBytes) {
        throw new ResourceLimitError("Query request exceeds byte limit");
      }
      if (128 + 2 * (delivery.url.length + delivery.destination.length) > routeBytes) {
        throw new ResourceLimitError("Query route metadata exceeds byte limit");
      }
      const owner = retained;
      this.pending.push({ kind: "query", delivery, release: () => owner.release() });
      queued = true;
      return { kind: "queued" };
    } finally {
      input?.reservation.release();
      preparation?.release();
      if (!queued) retained?.release();
    }
  }

  /** Guarded item preflight precedes interpretation; route resolution borrows admitted output synchronously. */
  enqueueCue(
    hab: Hab,
    cues: CueQueueInput,
    route: (emission: CueEmission) => RawCesrRoute,
    sender = hab,
  ): CuePreparationResult {
    if (this.closed) throw new Error("Runtime deliveries are closed");
    if (this.pending.capacity < 1) throw new ResourceLimitError("Batch exceeds deck capacity");
    if (this.pending.length === this.pending.capacity) {
      return { kind: "refuse", error: new DeckFullError("Deck capacity exceeded") };
    }
    let unrouted: PreparedCueEmission | undefined;
    const transferred = admitCueEmission(hab, cues, this.resources, (owner) => {
      if (!owner.emission || owner.emission.kind !== "wire") throw new RangeError("Cue delivery requires wire");
      const admission = admitCueRoute(this.resources, owner, () => route(owner.emission!));
      if (admission.kind === "refuse") return admission;
      const captured = admission.route;
      if (!captured.route.targets.length) {
        // Responder routing is best-effort when no endpoint exists; retire only after source publication.
        unrouted = owner;
        captured.release();
        return undefined;
      }
      let queued = false;
      try {
        const delivery = new CueDelivery(owner, sender, captured);
        this.pending.push({ kind: "cue", delivery, release: () => delivery.release() });
        queued = true;
        return undefined;
      } finally {
        if (!queued) captured.release();
      }
    });
    unrouted?.release();
    return transferred;
  }

  /** Guarded witness transfer; the callback borrow and queued targets share one prepared wire lifetime. */
  prepareWitnessCue(
    runtime: AgentRuntime,
    hab: Hab,
    resolve: (emission: CueEmission) => RawCesrRoute | null,
    onAdmissionRefusal?: (error: ResourceAdmissionError | DeckFullError) => void,
  ): PreparedCueEmission | undefined {
    if (runtime.resources !== this.resources) throw new RangeError("Wrong witness resource policy");
    if (this.closed) throw new Error("Runtime deliveries are closed");
    try {
      this.pending.checkSpace();
    } catch (error) {
      if (error instanceof DeckFullError) onAdmissionRefusal?.(error);
      throw error;
    }
    let borrow: PreparedCueEmission | undefined;
    DirectReplyDelivery.prepareCue(runtime, hab, runtime.cues, resolve, (delivery, prepared) => {
      const emission = prepared.emission;
      if (emission?.kind === "transport" && emission.cue.kin === "stream") {
        runtime.mailboxDirector.retainQueryCue(emission.cue, onAdmissionRefusal);
      } else if (emission?.cue.kin === "query" && emission.kind !== "wire") {
        runtime.querying.enqueueCue(emission.cue);
      }
      if (delivery.hasTargets) this.pending.push({ kind: "cue", delivery, release: () => delivery.release() });
      else delivery.release();
      borrow = prepared;
    }, onAdmissionRefusal);
    return borrow;
  }

  /** Atomically publish one bounded direct-reply batch and its HTTP stream; no network runs here. */
  openReply(
    runtime: AgentRuntime,
    hab: Hab,
    reply: QueryReply,
    onAdmissionRefusal?: (error: ResourceAdmissionError) => void,
  ): ReadableStream<Uint8Array> | null {
    if (runtime.resources !== this.resources) throw new RangeError("Wrong reply resource policy");
    if (this.closed) throw new Error("Runtime deliveries are closed");
    if (this.pending.length === this.pending.capacity) {
      const refusal = new ResourceAdmissionError("Direct reply delivery slots are busy", "busy");
      onAdmissionRefusal?.(refusal);
      throw refusal;
    }
    this.pending.checkSpace();
    return DirectReplyDelivery.prepare(runtime, hab, reply, (delivery, open) => {
      this.pending.checkSpace();
      const stream = open();
      if (delivery.hasTargets) this.pending.push({ kind: "cue", delivery, release: () => delivery.release() });
      else delivery.release();
      return stream;
    }, onAdmissionRefusal);
  }

  /** Atomically retain an earlier query reply without opening a request-local response stream. */
  enqueueReply(
    runtime: AgentRuntime,
    hab: Hab,
    reply: QueryReply,
    onAdmissionRefusal?: (error: ResourceAdmissionError) => void,
  ): boolean {
    if (runtime.resources !== this.resources) throw new RangeError("Wrong reply resource policy");
    if (this.closed) throw new Error("Runtime deliveries are closed");
    if (this.pending.length === this.pending.capacity) {
      const refusal = new ResourceAdmissionError("Queued reply delivery slots are busy", "busy");
      onAdmissionRefusal?.(refusal);
      throw refusal;
    }
    this.pending.checkSpace();
    return DirectReplyDelivery.prepareQueued(runtime, hab, reply, (delivery) => {
      this.pending.checkSpace();
      if (delivery.hasTargets) this.pending.push({ kind: "cue", delivery, release: () => delivery.release() });
      else delivery.release();
    }, onAdmissionRefusal);
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

  /** A bounded pass advances each owner once; cue preparation is guarded, all network waits are outside. */
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
            // Preparation stays in the existing state turn; transport and joined cleanup stay outside it.
            const preparation: { result: CueTargetPreparation } = { result: { kind: "pending" } };
            yield* runtime.reactor.settle(undefined, {}, function*() {
              preparation.result = entry.delivery.prepareTarget(runtime.poster, self.resources);
            });
            const next = preparation.result;
            done = next.kind === "done";
            if (next.kind === "target") {
              const outcome = yield* call(() =>
                attemptPreparedCesrTarget(next.owner.target, runtime.services, active.signal, runtime)
              );
              if (outcome === "complete") {
                active.signal.throwIfAborted();
                entry.delivery.retireTarget("sent");
              } else if (outcome === "refused" && self.retainFailed(next.owner)) {
                entry.delivery.retireTarget("retained");
              }
            }
          } else {
            done = (yield* call(() =>
              attemptPreparedCesrTarget(entry.delivery.target, runtime.services, active.signal, runtime)
            )) === "complete";
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
  if (new URL(delivery.url).protocol === "tcp:") {
    yield* converseCesrTcp(delivery.url, delivery.body, {
      services: runtime.services,
      signal: controller.signal,
      replies: { services: runtime.services, intake: runtime.intake, reactor: runtime.reactor, local: true },
    });
    return;
  }
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
 * Create the cue sink that sends outbound `qry` messages through HTTP or TCP.
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
  if (runtime.hby !== hby) throw new RangeError("Query transport requires its owning Habery");
  const prepareDelivery = (emission: CueEmission | null): QueryDelivery | undefined => {
    if (emission === null) return;
    if (!emission || emission.kind !== "wire" && emission.kind !== "notify" && emission.kind !== "transport") {
      throw new TypeError("Query preparation must return a synchronous emission or null");
    }
    if (emission.kind !== "wire" || emission.cue.kin !== "query") return;
    const destination = emission.cue.src, queriedPre = emission.cue.pre;
    if (!destination || !queriedPre) return;
    const signer = emission.cue.signer === undefined ? hab : hby.habs.get(emission.cue.signer);
    if (!signer) return;
    const url = resolveQueryDestinationUrl(signer, queriedPre, destination, {
      explicitWitness: emission.cue.wits?.includes(destination) ?? false,
    });
    if (!url) throw new ValidationError(`No endpoint URL found for query destination ${destination}.`);
    if (128 + 2 * (url.length + destination.length) > routeBytes) {
      throw new ResourceLimitError("Query route metadata exceeds byte limit");
    }
    const messages = emission.messages[Symbol.iterator]();
    let message: Uint8Array | undefined, failed = false, failure: unknown;
    try {
      message = messages.next().value;
    } catch (error) {
      failed = true;
      failure = error;
    }
    try {
      messages.return?.();
    } catch (error) {
      if (failed && error !== failure) throw new AggregateError([failure, error], "Query source cleanup failed");
      throw error;
    }
    if (failed) throw failure;
    if (!message) return;
    if (message.buffer.byteLength > requestBytes) throw new ResourceLimitError("Query request exceeds byte limit");
    const intro = introduce(signer, destination, requestBytes - message.length);
    if (intro.length + message.length > requestBytes) throw new ResourceLimitError("Query request exceeds byte limit");
    return { url, body: concatBytes(intro, message), bodyMode: hby.cesrBodyMode, destination };
  };
  const sink: CueSink = {
    admitCue(source, interpreter) {
      if (source !== runtime.cues) throw new RangeError("Query sink requires its composed source queue");
      const cue = source.peekHead();
      if (cue?.kin !== "query" || !interpreter) return "ineligible";
      const admission = sink.admitQuery!(cue, () => {
        const emission = interpreter.interpretCue(cue);
        return emission?.kind === "wire" ? emission : null;
      });
      if (admission === "transferred") {
        if (source.peekHead() !== cue) throw new Error("Query source changed during admission");
        cueReader(source).takeOwned()!.release();
      }
      return admission;
    },
    admitQuery(cue, prepare): CueAdmission {
      const reader = cueReader(runtime.cues);
      const source = reader.resourcePolicy && reader.peekHead() === cue ? reader : undefined;
      if (source && source.resourcePolicy !== runtime.resources) throw new RangeError("Wrong query source policy");
      const result = runtime.deliveries.enqueue(
        () => prepareDelivery(prepare()),
        cue,
        source?.headRetentionBytes(),
      );
      if (result.kind === "refuse") {
        if (result.error instanceof DeckFullError || result.error.reason === "busy") return "busy";
        throw result.error;
      }
      return result.kind === "queued" ? "transferred" : "ineligible";
    },
    *send(emission: CueEmission): Operation<void> {
      if (emission.kind !== "wire" || emission.cue.kin !== "query") return;
      const result = runtime.deliveries.enqueue(() => prepareDelivery(emission));
      if (result.kind === "refuse") throw result.error;
    },
  };
  return sink;
}
