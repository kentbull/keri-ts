import { type CesrFrame, Cigar, Ilks, parse, SerderKERI, Siger, Verfer } from "cesr-ts";
import { action, call, ensure, on, type Operation, race, resource } from "npm:effection@^3.6.0";
import type { Regery as AcdcRegery } from "../acdc/registraring.ts";
import type { AgentCue } from "../core/cues.ts";
import { Deck } from "../core/deck.ts";
import { KeriDispatchEnvelope, TransIdxSigGroup, TransLastIdxSigGroup } from "../core/dispatch.ts";
import { Kevery, type MessagePolicy } from "../core/eventing.ts";
import { type KramConfig, Kramer } from "../core/kraming.ts";
import { BasicReplyRouteHandler, Revery, Router } from "../core/routing.ts";
import { CredentialStateReceiver } from "../vdr/credential-tsn.ts";
import { Tevery } from "../vdr/eventing.ts";
import { RegistryStateReceiver } from "../vdr/registry-tsn.ts";
import { rethrowCleanupFailure } from "./abortable.ts";
import { chunkBytes } from "./byte-source.ts";
import { Exchanger } from "./exchanging.ts";
import type { Habery } from "./habbing.ts";
import {
  type DispatchDecision,
  dispatchEnvelope,
  envelopeFromFrame,
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
  /** Advance escrows within the same turn before consuming its cues. */
  escrows?: boolean;
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
 * - the shared cue deck is injected so higher-level hosts can preserve the
 *   KERIpy shared-cues mental model
 * - durable event/reply state still lives in the `Habery` database, not in
 *   this component
 */
export class Reactor {
  readonly hby: Habery;
  readonly cues: Deck<AgentCue>;
  /** Ordinary complete-record queue; callers enter through ingest(). */
  private readonly ingress: Deck<Uint8Array>;
  readonly router: Router;
  readonly revery: Revery;
  readonly replyRoutes: BasicReplyRouteHandler;
  readonly kevery: Kevery;
  readonly exchanger: Exchanger;
  readonly local: boolean;
  /** Bounded direct-response reservations, captured before any guarded cue consumer runs. */
  readonly replies: QueryReplies;
  /** Whether one dispatch/escrow/cue turn currently owns shared runtime state. */
  private busy = false;
  /** Waiting operations retain their position until granted or cancelled. */
  private readonly waiting = new Set<() => void>();
  readonly tevery?: Tevery;
  readonly verifier?: Verifier;
  readonly registry?: AcdcRegery;
  private readonly registryStates?: RegistryStateReceiver;
  private readonly credentialStates?: CredentialStateReceiver;
  constructor(
    hby: Habery,
    {
      cues,
      local = false,
      tevery,
      verifier,
      registry,
      messagePolicy,
      kram,
      now,
    }: {
      cues?: Deck<AgentCue>;
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
    this.replies = new QueryReplies();
    this.hby = hby;
    this.cues = cues ?? new Deck();
    this.ingress = new Deck();
    this.router = new Router();
    this.revery = new Revery(hby.db, { rtr: this.router, cues: this.cues });
    this.replyRoutes = new BasicReplyRouteHandler(this.revery);
    this.replyRoutes.registerReplyRoutes(this.router);
    const kramer = kram ? new Kramer(hby.db, { config: kram, cues: this.cues, now }) : undefined;
    this.kevery = new Kevery(hby.db, { cues: this.cues, rvy: this.revery, messagePolicy, kramer });
    this.kevery.registerReplyRoutes(this.router);
    this.exchanger = new Exchanger(hby, { cues: this.cues, now });
    this.local = local;
    this.tevery = tevery;
    this.verifier = verifier;
    this.registry = registry;
    if (tevery) {
      this.registryStates = new RegistryStateReceiver(tevery, this.revery);
      this.router.addRoute("/tsn/registry/{aid}", this.registryStates);
      this.credentialStates = new CredentialStateReceiver(tevery, this.revery);
      this.router.addRoute("/tsn/credential/{aid}", this.credentialStates);
    }
  }

  /** Whether the complete-record queue still has input to process. */
  get hasIngress(): boolean {
    return !this.ingress.empty;
  }
  /** Own this input and finish dispatch before reading its next complete frame. */
  *process(
    source: (signal: AbortSignal) => AsyncIterable<Uint8Array>,
    options: IngressOptions = {},
    consume?: (envelope?: KeriDispatchEnvelope, decision?: DispatchDecision) => Operation<void>,
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
          yield* self.settle(result.value, options, consume);
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
  /**
   * Own one dispatch, optional escrow pass, and cue-consumption turn.
   * The callback runs under the same guard and must not call another guarded Reactor method.
   * Parser sources remain independent; only shared protocol state and its cue deck are serialized.
   */
  settle(
    frame?: CesrFrame,
    { local = this.local, mailboxAid, escrows = false }: DispatchOptions = {},
    consume?: (envelope?: KeriDispatchEnvelope, decision?: DispatchDecision) => Operation<void>,
  ): Operation<KeriDispatchEnvelope | undefined> {
    // deno-lint-ignore no-this-alias -- Generator callbacks have no lexical this.
    const self = this;
    return call(function*() {
      return yield* self.turn(function*() {
        let envelope: KeriDispatchEnvelope | undefined;
        let decision: DispatchDecision = undefined;
        const finish = function*(ready: KeriDispatchEnvelope | undefined, current: DispatchDecision) {
          if (escrows) yield* self.advanceEscrows();
          self.replies.capture(self.cues);
          if (consume) yield* consume(ready, current);
        };
        let consumed = false;
        if (frame) {
          envelope = envelopeFromFrame(frame, local);
          decision = yield* dispatchEnvelope(
            envelope,
            self.revery,
            self.kevery,
            self.exchanger,
            self.tevery,
            self.verifier,
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
  /** Acquire a runtime state turn; cancellation removes waiters and always releases acquired ownership. */
  private turn<T>(work: () => Operation<T>): Operation<T> {
    // deno-lint-ignore no-this-alias -- Generator callbacks have no lexical this.
    const self = this;
    return call(function*() {
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
      // This later child joins before the earlier state-turn owner grants the next waiter.
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
    yield* this.settle(undefined, { escrows: true });
  }

  /** Advance component escrows while the caller already owns the runtime turn. */
  private *advanceEscrows(): Operation<void> {
    this.kevery.kramer?.prune();
    this.kevery.processEscrows();
    this.revery.processEscrowReply();
    this.tevery?.processEscrows();
    this.registryStates?.processEscrows();
    this.credentialStates?.processEscrows();
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
