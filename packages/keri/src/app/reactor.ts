import {
  type CesrFrame,
  Cigar,
  discardFrame,
  Ilks,
  type ParseOptions,
  ResourceAdmissionError,
  ResourceLimitError,
  ResourcePolicy,
  type ResourceReservation,
  SerderKERI,
  Siger,
  Verfer,
} from "cesr-ts";
import { type FrameChannel, toEffectionFrames } from "cesr-ts/effection";
import { action, call, each, type Operation, resource } from "npm:effection@^3.6.0";
import type { Regery as AcdcRegery } from "../acdc/registraring.ts";
import type { AgentCue } from "../core/cues.ts";
import { Deck, DeckFullError } from "../core/deck.ts";
import { KeriDispatchEnvelope, TransIdxSigGroup, TransLastIdxSigGroup } from "../core/dispatch.ts";
import { Kevery, type MessagePolicy } from "../core/eventing.ts";
import { type KramConfig, Kramer } from "../core/kraming.ts";
import { BasicReplyRouteHandler, Revery, Router } from "../core/routing.ts";
import { CredentialStateReceiver } from "../vdr/credential-tsn.ts";
import { Tevery } from "../vdr/eventing.ts";
import { RegistryStateReceiver } from "../vdr/registry-tsn.ts";
import { chunkBytes } from "./byte-source.ts";
import { Exchanger } from "./exchanging.ts";
import type { Habery } from "./habbing.ts";
import {
  type DispatchDecision,
  dispatchEnvelope,
  envelopeFromFrame,
  type TeveryLike,
  type VerifierLike,
} from "./parsering.ts";
import { QueryReplies } from "./query-replies.ts";
import { runtimeTurn } from "./runtime-turn.ts";

/** Request-local provenance and parser bounds; each source keeps independent parser state. */
export interface IngressOptions extends ParseOptions {
  /** Treat witness/controller ingress as locally received protocol events. */
  local?: boolean;
  /** Hosted mailbox endpoint that received this source. */
  mailboxAid?: string | null;
  /** Advance escrows within the same turn before consuming its cues. */
  escrows?: boolean;
}

/** Retained copy and transferable shared credit for one queued or processing record. */
interface IngressRecord {
  bytes: Uint8Array;
  reservation?: ResourceReservation;
}

/**
 * Shared message-routing component for one `Habery`.
 *
 * KERIpy correspondence:
 * - this is the nearest local correlate to the reactor/doer bundle that owns
 *   parser ingress, `Revery`, `Kevery`, and the reply router
 *
 * Ownership model:
 * - `Reactor` owns transient ingress bytes plus the parser and dispatch seams
 * - the shared cue deck is injected so higher-level hosts can preserve the
 *   KERIpy shared-cues mental model
 * - durable event/reply state still lives in the `Habery` database, not in
 *   this component
 */
export class Reactor {
  readonly hby: Habery;
  /** Shared host credit; standalone reactors create one explicit local policy by default. */
  readonly resources: ResourcePolicy;
  readonly cues: Deck<AgentCue>;
  /** Bounded complete-record queue; callers enter only through ingest(). */
  private readonly ingress: Deck<IngressRecord>;
  readonly router: Router;
  readonly revery: Revery;
  readonly replyRoutes: BasicReplyRouteHandler;
  readonly kevery: Kevery;
  readonly exchanger: Exchanger;
  readonly local: boolean;
  /** Bounded direct-response reservations, captured before any guarded cue consumer runs. */
  readonly replies: QueryReplies;
  /** Active parser scopes; admission never creates an unbounded queue of source readers. */
  private sources = 0;
  /** Whether one dispatch/escrow/cue turn currently owns shared runtime state. */
  private busy = false;
  /** Waiting turns are bounded independently of the lifetime of their input streams. */
  private readonly waiting = new Set<() => void>();
  /** Resident queued and processing bytes retain local admission until joined cleanup. */
  private queuedBytes = 0;
  private ingressRecords = 0;
  private ingressGeneration = 0;
  /** Maximum simultaneous input sources and waiting runtime turns. */
  private readonly maxSources: number;
  /** Maximum bytes in the complete-record ingress deck. */
  private readonly maxQueuedBytes: number;
  readonly vdr: VdrRuntimeServices;
  readonly acdc: AcdcRuntimeServices;
  private readonly registryStates?: RegistryStateReceiver;
  private readonly credentialStates?: CredentialStateReceiver;

  constructor(
    hby: Habery,
    {
      cues,
      local = false,
      vdr = {},
      acdc = {},
      maxSources = 8,
      maxQueuedBytes = 8 * 1024 * 1024,
      maxPendingCues = 1024,
      messagePolicy,
      resources = hby.db.resources,
      kram,
      now,
    }: {
      cues?: Deck<AgentCue>;
      local?: boolean;
      vdr?: VdrRuntimeServices;
      acdc?: AcdcRuntimeServices;
      /** Reject additional sources and waiting turns when this admission limit is reached. */
      maxSources?: number;
      /** Bound already resident complete records awaiting processOnce(). */
      maxQueuedBytes?: number;
      /** Reject more protocol work until the host drains a full cue deck. */
      maxPendingCues?: number;
      /** Runtime-owned v2 non-event sender policy, independent of parser admission. */
      messagePolicy?: MessagePolicy;
      /** Borrow the host policy so other streams and recipients compete for the same credit. */
      resources?: ResourcePolicy;
      /** Omitted preserves disabled intake; the receiver clock is runtime-owned. */
      kram?: KramConfig;
      now?: () => number;
    } = {},
  ) {
    for (const limit of [maxSources, maxQueuedBytes, maxPendingCues]) {
      if (!Number.isSafeInteger(limit) || limit < 1) {
        throw new RangeError("Ingress limits must be positive safe integers");
      }
    }
    this.maxSources = maxSources;
    this.maxQueuedBytes = maxQueuedBytes;
    this.replies = new QueryReplies(maxSources);
    this.hby = hby;
    this.resources = resources;
    this.cues = cues ?? new Deck();
    this.cues.capacity = Math.min(this.cues.capacity, maxPendingCues);
    this.ingress = new Deck();
    this.router = new Router();
    this.revery = new Revery(hby.db, { rtr: this.router, cues: this.cues });
    this.replyRoutes = new BasicReplyRouteHandler(hby.db, this.revery);
    this.replyRoutes.registerReplyRoutes(this.router);
    const kramer = kram ? new Kramer(hby.db, { config: kram, cues: this.cues, now, resources }) : undefined;
    this.kevery = new Kevery(hby.db, { cues: this.cues, rvy: this.revery, messagePolicy, kramer });
    this.kevery.registerReplyRoutes(this.router);
    this.exchanger = new Exchanger(hby, { cues: this.cues, resources, now });
    this.local = local;
    this.vdr = vdr;
    this.acdc = acdc;
    if (vdr.tvy instanceof Tevery) {
      this.registryStates = new RegistryStateReceiver(vdr.tvy, this.revery);
      this.router.addRoute("/tsn/registry/{aid}", this.registryStates);
      this.credentialStates = new CredentialStateReceiver(vdr.tvy, this.revery);
      this.router.addRoute("/tsn/credential/{aid}", this.credentialStates);
    }
  }

  /** Whether the bounded complete-record queue still has input to process. */
  get hasIngress(): boolean {
    return !this.ingress.empty;
  }

  /** Own one admitted parser channel until the caller's scope ends, including input cancellation. */
  frames(
    source: (signal: AbortSignal) => AsyncIterable<Uint8Array>,
    options: ParseOptions = {},
  ): Operation<FrameChannel> {
    // deno-lint-ignore no-this-alias -- Generator callbacks have no lexical this.
    const self = this;
    return resource<FrameChannel>(function*(provide) {
      // Capture policy once; later caller mutations must not exceed the reserved input allowance.
      const limits = {
        ...options,
        maxChunkBytes: options.maxChunkBytes ?? 1024 ** 2,
        maxBufferedBytes: options.maxBufferedBytes ?? 8 * 1024 ** 2,
      };
      for (const limit of [limits.maxChunkBytes, limits.maxBufferedBytes]) {
        if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError("Invalid ingress input limit");
      }
      if (limits.maxChunkBytes > limits.maxBufferedBytes) throw new RangeError("Chunk limit exceeds buffer limit");
      // One producer allocation may coexist with the retained cursor queue while next() completes.
      const inputBytes = limits.maxChunkBytes + limits.maxBufferedBytes;
      if (!Number.isSafeInteger(inputBytes)) throw new RangeError("Ingress input reservation exceeds safe range");
      // The admission lease predates the parser resource, so parser cleanup completes before release.
      yield* resource<void>(function*(hold) {
        if (self.sources >= self.maxSources) {
          throw new ResourceAdmissionError("Too many active ingress sources", "busy");
        }
        const credit = self.resources.reserve({ streams: 1, bytes: inputBytes });
        if (credit.kind === "refuse") {
          throw new ResourceAdmissionError(
            `Ingress ${credit.resource} admission refused: ${credit.reason}`,
            credit.reason,
          );
        }
        self.sources++;
        try {
          yield* hold();
        } finally {
          self.sources--;
          credit.reservation.release();
        }
      });
      const channel = yield* toEffectionFrames(source, {
        ...limits,
        resources: self.resources,
        // Acquire storage lazily: ordinary frames do not open the payload archive.
        payloadSink: options.payloadSink
          ?? (async (maxBytes, signal) => (await self.hby.db.openPayloads(signal)).files.stage(maxBytes, signal)),
      });
      yield* provide(channel);
    });
  }

  /** Finish dispatch before returning input credit for the next complete frame. */
  *process(
    source: (signal: AbortSignal) => AsyncIterable<Uint8Array>,
    options: IngressOptions = {},
    consume?: (envelope?: KeriDispatchEnvelope, decision?: DispatchDecision) => Operation<void>,
  ): Operation<void> {
    // deno-lint-ignore no-this-alias -- Generator callbacks have no lexical this.
    const self = this;
    yield* call(function*() {
      const channel = yield* self.frames(source, options);
      for (const frame of yield* each(channel.frames)) {
        yield* self.settle(frame, options, consume);
        yield* each.next();
      }
    });
  }

  /**
   * Own one dispatch, optional escrow pass, and cue-consumption turn.
   * The callback runs under the same guard and must not call another guarded Reactor method.
   * Parser sources remain independent; only shared protocol state and its cue deck are serialized.
   */
  settle(
    frame?: CesrFrame,
    { local = this.local, mailboxAid, escrows = false }: IngressOptions = {},
    consume?: (envelope?: KeriDispatchEnvelope, decision?: DispatchDecision) => Operation<void>,
  ): Operation<KeriDispatchEnvelope | undefined> {
    // deno-lint-ignore no-this-alias -- Generator callbacks have no lexical this.
    const self = this;
    return call(function*() {
      if (frame) {
        // Register ownership before dispatch: reverse resource teardown joins its work before deleting input.
        yield* resource<void>(function*(provide) {
          try {
            yield* provide();
          } finally {
            yield* call(() => discardFrame(frame));
          }
        });
      }
      return yield* self.turn(function*() {
        let envelope: KeriDispatchEnvelope | undefined;
        let decision: DispatchDecision = undefined;
        const finish = function*(ready: KeriDispatchEnvelope | undefined, current: DispatchDecision) {
          if (escrows) yield* self.advanceEscrows();
          self.replies.capture(self.cues);
          if (consume) yield* consume(ready, current);
        };
        let consumed = false;
        if (frame) self.cues.checkSpace();
        if (frame) {
          envelope = envelopeFromFrame(frame, local);
          decision = yield* dispatchEnvelope(
            envelope,
            self.revery,
            self.kevery,
            self.exchanger,
            self.vdr,
            mailboxAid,
            function*(ready, current) {
              consumed = true;
              yield* finish(ready, current);
            },
          );
        }
        if (!consumed) yield* finish(envelope, decision);
        // Only the original borrowed input escapes; hydrated ready owners stay inside finish().
        return envelope;
      });
    });
  }

  /** Acquire a bounded runtime turn; cancellation removes waiters and always releases acquired ownership. */
  private turn<T>(work: () => Operation<T>): Operation<T> {
    // deno-lint-ignore no-this-alias -- Generator callbacks have no lexical this.
    const self = this;
    return call(function*() {
      yield* resource<void>(function*(provide) {
        let acquired = false;
        try {
          if (self.busy) {
            if (self.waiting.size >= self.maxSources) throw new ResourceLimitError("Too many waiting ingress turns");
            yield* action<void>((resolve) => {
              const grant = () => {
                acquired = true;
                resolve();
              };
              self.waiting.add(grant);
              return () => {
                self.waiting.delete(grant);
              };
            });
          } else {
            self.busy = true;
            acquired = true;
          }
          yield* provide();
        } finally {
          if (acquired) {
            const next = self.waiting.values().next().value;
            if (next) {
              self.waiting.delete(next);
              next();
            } else {
              self.busy = false;
            }
          }
        }
      });
      // This later child is joined before the earlier admission resource releases its permit.
      return yield* call(work);
    });
  }

  /**
   * Queue one complete CESR/KERI record for later parsing.
   *
   * This is the transient ingress seam used by both local synthetic messages
   * and remotely fetched OOBI artifacts.
   */
  ingest(bytes: Uint8Array): void {
    if (bytes.byteLength > this.maxQueuedBytes) {
      throw new ResourceAdmissionError("Queued ingress exceeds byte limit", "limit");
    }
    if (this.ingressRecords >= this.maxSources || bytes.byteLength > this.maxQueuedBytes - this.queuedBytes) {
      throw new ResourceAdmissionError("Complete-record ingress queue is full", "busy");
    }
    const credit = bytes.byteLength ? this.resources.reserve({ bytes: bytes.byteLength }) : undefined;
    if (credit?.kind === "refuse") {
      throw new ResourceAdmissionError(
        `Queued ingress ${credit.resource} admission refused: ${credit.reason}`,
        credit.reason,
      );
    }
    // Copy only the admitted extent so a tiny view cannot retain a much larger producer buffer.
    try {
      this.ingress.push({ bytes: bytes.slice(), reservation: credit?.reservation });
    } catch (error) {
      credit?.reservation.release();
      throw error;
    }
    this.queuedBytes += bytes.byteLength;
    this.ingressRecords++;
  }

  /** Clear queued owners and invalidate late retries; active processing releases after joined cleanup. */
  clearIngress(): void {
    this.ingressGeneration++;
    for (let record = this.ingress.pull(); record; record = this.ingress.pull()) this.releaseIngress(record);
  }

  /** Return both shared credit and local capacity when this record's owner finishes. */
  private releaseIngress(record: IngressRecord): void {
    this.queuedBytes -= record.bytes.byteLength;
    this.ingressRecords--;
    record.reservation?.release();
  }

  /** Consume one complete record through the same progressive source and dispatch path as network input. */
  *processBytes(bytes: Uint8Array, options: IngressOptions = {}): Operation<void> {
    // Honor tighter caller chunk limits while keeping copies bounded for already resident input.
    const maxChunkBytes = Math.min(64 * 1024, options.maxChunkBytes ?? 64 * 1024);
    yield* this.process((signal) => chunkBytes(bytes, { signal, maxChunkBytes }), options);
  }

  /**
   * Drain one bounded message-processing pass.
   *
   * This mirrors the KERIpy pattern where a doer owns the long-lived loop but
   * delegates the actual work to a plain drain helper.
   */
  *processOnce(): Operation<void> {
    while (!this.ingress.empty) {
      const record = this.ingress.pull()!;
      const generation = this.ingressGeneration;
      if (yield* this.processIngress(record, generation)) return;
    }
  }

  /** Install the owner before work so cancellation joins child cleanup before returning credit. */
  private processIngress(record: IngressRecord, generation: number): Operation<boolean> {
    // deno-lint-ignore no-this-alias -- Generator callbacks have no lexical this.
    const self = this;
    return call(function*() {
      let retained = false;
      yield* resource<void>(function*(provide) {
        try {
          yield* provide();
        } finally {
          if (!retained) self.releaseIngress(record);
        }
      });
      try {
        yield* call(() => self.processBytes(record.bytes));
      } catch (error) {
        // Keep the record for retry after cue delivery; already accepted frames replay as duplicates.
        if (error instanceof DeckFullError || (error instanceof ResourceAdmissionError && error.reason === "busy")) {
          if (generation === self.ingressGeneration) {
            self.ingress.prepend(record);
            retained = true;
          }
          return true;
        }
        throw error;
      }
      return false;
    });
  }

  /**
   * Run one bounded escrow-processing pass.
   *
   * Current scope:
   * - KEL escrows through `Kevery.processEscrows()`
   * - reply escrows through `Revery.processEscrowReply()`
   */
  *processEscrowsOnce(): Operation<void> {
    yield* this.settle(undefined, { escrows: true });
  }

  /** Advance component escrows while the caller already owns the runtime turn. */
  private *advanceEscrows(): Operation<void> {
    try {
      this.kevery.kramer?.prune();
      this.kevery.processEscrows();
      this.revery.processEscrowReply();
      this.vdr.tvy?.processEscrows?.();
      this.registryStates?.processEscrows();
      this.credentialStates?.processEscrows();
      this.vdr.vry?.processEscrows?.();
      this.acdc.rgy?.processEscrows();
      yield* this.exchanger.processEscrows();
    } catch (error) {
      // A full cue deck pauses retry work; source escrow rows remain until application succeeds.
      if (!(error instanceof DeckFullError)) throw error;
    }
  }

  /**
   * Continuous message doer for command hosts that keep the runtime alive.
   *
   * This is the Effection equivalent of a KERIpy `msgDo`: drain ingress, yield
   * to the scheduler, and repeat indefinitely.
   */
  *msgDo(): Operation<never> {
    while (true) {
      yield* this.processOnce();
      yield* runtimeTurn();
    }
  }

  /**
   * Continuous escrow doer for the long-lived runtime host.
   *
   * KERIpy correspondence:
   * - mirrors the dedicated `escrowDo` loop rather than folding escrow
   *   processing into parser ingress
   */
  *escrowDo(): Operation<never> {
    while (true) {
      yield* this.processEscrowsOnce();
      yield* runtimeTurn();
    }
  }
}

/** Registry DB owner seam; Phase 3 supplies the concrete `Reger`. */
export type RegerRuntimeService = object;

/** TEL state processor seam; Phase 5 supplies the concrete `Tevery`. */
export type TeveryRuntimeService = TeveryLike;

/** Credential verifier seam; Phase 4/10 supplies the concrete verifier. */
export type VerifierRuntimeService = VerifierLike;

/** Registry operation seam; Phase 6 supplies the concrete `Regery`. */
export type RegeryRuntimeService = object;

/** VDR services accepted by `Reactor` and the shared `AgentRuntime`. */
export interface VdrRuntimeServices {
  reger?: RegerRuntimeService | null;
  tvy?: TeveryRuntimeService | null;
  vry?: VerifierRuntimeService | null;
  rgy?: RegeryRuntimeService | null;
}

/** Borrowed v2 registry manager; automatic foreign rip/bup parser intake remains separate. */
export interface AcdcRuntimeServices {
  rgy?: AcdcRegery | null;
}
