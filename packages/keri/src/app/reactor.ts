import { type CesrFrame, parse } from "cesr-ts";
import { action, call, ensure, on, type Operation, race, resource } from "npm:effection@^3.6.0";
import type { Regery as AcdcRegery } from "../acdc/registraring.ts";
import type { AgentCue } from "../core/cues.ts";
import { Deck } from "../core/deck.ts";
import { Kevery, type MessagePolicy } from "../core/eventing.ts";
import { type KramConfig, Kramer } from "../core/kraming.ts";
import { BasicReplyRouteHandler, Revery, type Router } from "../core/routing.ts";
import { Tevery } from "../vdr/eventing.ts";
import { rethrowCleanupFailure } from "./abortable.ts";
import { chunkBytes } from "./byte-source.ts";
import { Exchanger } from "./exchanging.ts";
import type { Habery } from "./habbing.ts";
import {
  dispatchEnvelope,
  type DispatchResult,
  envelopeFromFrame,
  queryEnvelopeFromDispatch,
} from "./parsering.ts";
import { QueryReplies } from "./query-replies.ts";
import { runtimeTurn } from "./runtime-turn.ts";
import type { Verifier } from "./verifying.ts";

/** Protocol processing choices, independent of an input operation's lifetime. */
export interface DispatchOptions {
  /** Treat witness/controller ingress as locally received protocol events. */
  local?: boolean;
  /** Hosted mailbox endpoint that received this source. */
  mailboxAid?: string | null;
  /** Advance escrows before publishing this dispatch's protocol cues. */
  escrows?: boolean;
}

/** Exact dispatch evidence plus mailbox authorization observed before releasing protocol state. */
export interface ReactorDispatchResult extends DispatchResult {
  mailboxQueryAuthorized: boolean;
}

/** Input cancellation belongs to the consuming operation, never protocol dispatch. */
export interface IngressOptions extends DispatchOptions {
  signal?: AbortSignal;
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
 * - protocol processors write a separate Deck; Reactor captures request replies
 *   before publishing ordinary cues to the application flow
 * - durable event/reply state still lives in the `Habery` database, not in
 *   this component
 */
export class Reactor {
  readonly hby: Habery;
  readonly cues: Deck<AgentCue>;
  /** Protocol output stays private until dispatch/escrow processing finishes. */
  private readonly protocolCues: Deck<AgentCue>;
  /** Ordinary complete-record queue; callers enter through ingest(). */
  private readonly ingress: Deck<Uint8Array>;
  readonly router: Router;
  readonly revery: Revery;
  readonly replyRoutes: BasicReplyRouteHandler;
  readonly kevery: Kevery;
  readonly exchanger: Exchanger;
  readonly local: boolean;
  /** Direct request correlation, captured before protocol cues reach application consumers. */
  readonly replies: QueryReplies;
  /** Async protocol handlers and escrow passes share one sequential processor. */
  private busy = false;
  /** Waiting operations retain their position until granted or cancelled. */
  private readonly waiting = new Set<() => void>();
  readonly tevery?: Tevery;
  readonly verifier?: Verifier;
  readonly registry?: AcdcRegery;
  constructor(
    hby: Habery,
    {
      cues,
      protocolCues,
      revery,
      local = false,
      tevery,
      verifier,
      registry,
      messagePolicy,
      kram,
      now,
    }: {
      cues?: Deck<AgentCue>;
      /** The actual TEL/verifier producer flow when composed outside Reactor. */
      protocolCues?: Deck<AgentCue>;
      /** Shared reply processor constructed with the TEL processor at composition. */
      revery?: Revery;
      local?: boolean;
      tevery?: Tevery;
      verifier?: Verifier;
      registry?: AcdcRegery;
      /** Runtime-owned v2 non-event sender policy, independent of parser admission. */
      messagePolicy?: MessagePolicy;
      /** Omitted preserves disabled intake; the receiver clock is runtime-owned. */
      kram?: KramConfig;
      now?: () => number;
    } = {},
  ) {
    this.hby = hby;
    this.cues = cues ?? new Deck();
    this.replies = new QueryReplies(this.cues);
    this.protocolCues = protocolCues ?? revery?.cues ?? new Deck();
    if (this.protocolCues === this.cues) throw new TypeError("Protocol and application cue flows must be distinct");
    this.ingress = new Deck();
    this.revery = revery ?? new Revery(hby.db, { cues: this.protocolCues });
    this.router = this.revery.rtr;
    this.replyRoutes = new BasicReplyRouteHandler(this.revery);
    this.replyRoutes.registerReplyRoutes(this.router);
    const kramer = kram ? new Kramer(hby.db, { config: kram, cues: this.protocolCues, now }) : undefined;
    this.kevery = new Kevery(hby.db, { cues: this.protocolCues, rvy: this.revery, messagePolicy, kramer });
    this.kevery.registerReplyRoutes(this.router);
    this.exchanger = new Exchanger(hby, { cues: this.protocolCues, now });
    this.local = local;
    this.tevery = tevery;
    this.verifier = verifier;
    this.registry = registry;
    tevery?.registerReplyRoutes(this.router);
  }

  /** Whether the complete-record queue still has input to process. */
  get hasIngress(): boolean {
    return !this.ingress.empty;
  }
  /** Own this input and finish dispatch before reading its next complete frame. */
  *process(
    source: (signal: AbortSignal) => AsyncIterable<Uint8Array>,
    options: IngressOptions = {},
  ): Operation<void> {
    // deno-lint-ignore no-this-alias -- Generator callbacks have no lexical this.
    const self = this;
    const input = call(function*() {
      const controller = new AbortController();
      const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
      try {
        signal.throwIfAborted();
        const frames = parse(source(signal));
        let pending: ReturnType<typeof frames.next> | undefined;
        // This earlier resource joins I/O after dispatch/read children have stopped.
        yield* ensure(function*() {
          try {
            if (pending) {
              try {
                yield* call(() => pending!);
              } catch (error) {
                rethrowCleanupFailure(error, signal);
              }
            }
          } finally {
            yield* call(() => frames.return());
          }
        });
        while (true) {
          signal.throwIfAborted();
          pending = frames.next();
          let result: Awaited<typeof pending>;
          try {
            result = yield* call(() => pending!);
          } catch (error) {
            pending = undefined; // Already reported; the parser has joined its source cleanup.
            throw error;
          }
          pending = undefined;
          signal.throwIfAborted();
          if (result.done) return;
          yield* self.dispatch(result.value, options);
        }
      } finally {
        controller.abort();
      }
    });
    if (options.signal) {
      const signal = options.signal;
      yield* race([
        input,
        call(function*(): Operation<never> {
          const abort = yield* on(signal, "abort");
          signal.throwIfAborted();
          yield* abort.next();
          throw signal.reason;
        }),
      ]);
    } else yield* input;
  }
  /** Process one frame and publish its committed protocol cues before returning decision data. */
  dispatch(
    frame: CesrFrame,
    { local = this.local, mailboxAid, escrows = false }: DispatchOptions = {},
  ): Operation<ReactorDispatchResult> {
    // deno-lint-ignore no-this-alias -- Generator callbacks have no lexical this.
    const self = this;
    return call(function*() {
      yield* self.acquireProtocol();
      return yield* call(function*() {
        try {
          const result = yield* dispatchEnvelope(
            envelopeFromFrame(frame, local),
            self.revery,
            self.kevery,
            self.exchanger,
            self.tevery,
            self.verifier,
            mailboxAid,
          );
          if (escrows) yield* self.advanceEscrows();
          return {
            ...result,
            mailboxQueryAuthorized: result.envelope.serder.route === "mbx"
              && self.kevery.isMailboxQueryAuthorized(queryEnvelopeFromDispatch(result.envelope)),
          };
        } finally {
          self.publishCues();
        }
      });
    });
  }

  /** Capture direct replies before handing ordinary protocol records to the application consumer. */
  private publishCues(): void {
    this.replies.capture(this.protocolCues);
    while (!this.protocolCues.empty) this.cues.push(this.protocolCues.pull()!);
  }

  /** Serialize only protocol processing; cancellation removes waiters and joins active handlers before release. */
  private *acquireProtocol(): Operation<void> {
    // deno-lint-ignore no-this-alias -- Generator callbacks have no lexical this.
    const self = this;
    yield* resource<void>(function*(provide) {
      let acquired = false;
      try {
        if (self.busy) {
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
  }

  /**
   * Queue one complete CESR/KERI record for later parsing.
   *
   * This is the transient ingress seam used by both local synthetic messages
   * and remotely fetched OOBI artifacts.
   */
  ingest(bytes: Uint8Array): void {
    // Preserve the queued record independently of subsequent producer mutation.
    this.ingress.push(bytes.slice());
  }

  /** Discard ordinary queued records; active input operations own their own lifetime. */
  clearIngress(): void {
    this.ingress.clear();
  }

  /** Consume one complete record through the same buffered parser source and dispatch path as network input. */
  *processBytes(bytes: Uint8Array, options: IngressOptions = {}): Operation<void> {
    // Copy already resident input in fixed-size chunks for the parser source.
    yield* this.process((signal) => chunkBytes(bytes, { signal }), options);
  }
  /**
   * Drain one bounded message-processing pass.
   *
   * This mirrors the KERIpy pattern where a doer owns the long-lived loop but
   * delegates the actual work to a plain drain helper.
   */
  *processOnce(): Operation<void> {
    while (!this.ingress.empty) yield* this.processBytes(this.ingress.pull()!);
  }

  /**
   * Run one bounded escrow-processing pass.
   *
   * Current scope:
   * - KEL escrows through `Kevery.processEscrows()`
   * - reply escrows through `Revery.processEscrowReply()`
   */
  *processEscrowsOnce(): Operation<void> {
    // deno-lint-ignore no-this-alias -- Generator callbacks have no lexical this.
    const self = this;
    yield* call(function*() {
      yield* self.acquireProtocol();
      yield* call(function*() {
        try {
          yield* self.advanceEscrows();
        } finally {
          self.publishCues();
        }
      });
    });
  }

  /** Advance component escrows while this protocol operation owns serialization. */
  private *advanceEscrows(): Operation<void> {
    this.kevery.kramer?.prune();
    this.kevery.processEscrows();
    this.revery.processEscrowReply();
    this.tevery?.processEscrows();
    this.verifier?.processEscrows();
    this.registry?.processEscrows();
    yield* this.exchanger.processEscrows();
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
