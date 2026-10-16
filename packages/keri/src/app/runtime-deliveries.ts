import { concatBytes } from "cesr-ts";
import { call, type Operation, resource } from "npm:effection@^3.6.0";
import type { CueEmission } from "../core/cues.ts";
import { Deck } from "../core/deck.ts";
import { ValidationError } from "../core/errors.ts";
import { Roles } from "../core/roles.ts";
import { Schemes } from "../core/schemes.ts";
import type { AgentRuntime } from "./agent-runtime.ts";
import { chunkBytes, streamBytes } from "./byte-source.ts";
import { postCesr } from "./cesr-egress.ts";
import type { CueAdmission, CueSink } from "./cue-runtime.ts";
import { introduce } from "./forwarding.ts";
import type { Hab, Habery } from "./habbing.ts";
import { consumeMailboxSse } from "./mailbox-sse.ts";
import { flattenRoleUrls } from "./mailboxing.ts";
import { converseCesrTcp } from "./tcp-conversation.ts";

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

/** Deliver signed query records; responder cues and replay cursors belong to Respondant. */
export class RuntimeDeliveries {
  /** Pending concrete deliveries; each active transport manages its actual I/O. */
  private readonly pending = new Deck<QueryDelivery>();
  /** Command-local and background drains cannot deliver the same head concurrently. */
  private draining = false;
  /** Active delivery cancellation and its joined completion belong to runtime shutdown. */
  private active?: AbortController;
  /** Shutdown waits for response resource teardown, not merely parser return. */
  private joined?: Promise<void>;
  /** Closed queues reject all later admissions. */
  private closed = false;

  /** Append a prepared query record; signing and endpoint selection belong to the producer. */
  enqueue(delivery: QueryDelivery): void {
    if (this.closed) throw new Error("Runtime deliveries are closed");
    this.pending.push(delivery);
  }

  /** Include queued transport in runtime convergence checks. */
  get hasPending(): boolean {
    return this.draining || !this.pending.empty;
  }

  /** Join active query transport before clearing its pending records. */
  *close(): Operation<void> {
    this.closed = true;
    this.active?.abort();
    if (this.joined) yield* call(() => this.joined!);
    this.pending.clear();
  }

  /** Drain the captured query extent and join each response scope before removing its record. */
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
        yield* call(() => postQueryMessage(runtime, entry, active));
        active.signal.throwIfAborted();
        self.pending.pull();
        retiredOwners++;
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
      clock: runtime.services.clock,
      signal: controller.signal,
      replies: { reactor: runtime.reactor, local: true },
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
    const intro = introduce(signer, destination);
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
        source.pull();
      }
      return admission;
    },
    admitQuery(cue, prepare): CueAdmission {
      const delivery = prepareDelivery(prepare());
      if (!delivery) return "ineligible";
      runtime.deliveries.enqueue(delivery);
      return "transferred";
    },
    *send(emission: CueEmission): Operation<void> {
      if (emission.kind !== "wire" || emission.cue.kin !== "query") return;
      const delivery = prepareDelivery(emission);
      if (delivery) runtime.deliveries.enqueue(delivery);
    },
  };
  return sink;
}
