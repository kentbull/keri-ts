/** Shared protocol mutations and publication, independent of byte-input and network lifetimes. */
import type { CesrFrame } from "cesr-ts";
import { action, call, type Operation, resource } from "npm:effection@^3.6.0";
import type { Regery as AcdcRegery } from "../acdc/registraring.ts";
import type { AgentCue } from "../core/cues.ts";
import { Deck } from "../core/deck.ts";
import { Kevery } from "../core/eventing.ts";
import { BasicReplyRouteHandler, Revery } from "../core/routing.ts";
import type { Tevery } from "../vdr/eventing.ts";
import { Exchanger } from "./exchanging.ts";
import type { Habery } from "./habbing.ts";
import { dispatchEnvelope, type DispatchResult, envelopeFromFrame, queryEnvelopeFromDispatch } from "./parsering.ts";
import { QueryReplies } from "./query-replies.ts";
import { runtimeTurn } from "./runtime-turn.ts";
import type { Verifier } from "./verifying.ts";

/** Protocol choices for a frame; input owners separately own cancellation and parsing. */
export interface DispatchOptions {
  /** Whether the frame arrived through local witness/controller intake. */
  local?: boolean;
  /** Hosted mailbox endpoint provenance, independent of the signed sender. */
  mailboxAid?: string | null;
  /** Advance durable escrows before capturing and publishing resulting cues. */
  escrows?: boolean;
}

/** Exact processed evidence and mailbox authorization observed within the protocol turn. */
export interface ProtocolDispatchResult extends DispatchResult {
  /** Current request authorization, never inferred solely from a matching reply SAID. */
  mailboxQueryAuthorized: boolean;
}

/**
 * Serialize shared protocol state changes and publish their committed cues.
 *
 * KERIpy supplies parsers with concrete Kevery/Revery/Exchanger owners. This owner
 * preserves that split while accounting for TypeScript handlers that suspend:
 * one protocol turn spans dispatch, optional escrow recovery and cue publication.
 * It owns no input queue, parser, socket, transport worker or arbitrary callbacks.
 * Stores and configured semantic handlers are borrowed from composition.
 */
export class ProtocolProcessor {
  /** A protocol turn remains held until its active handler and cleanup have joined. */
  private busy = false;
  /** FIFO waiters; cancellation removes a waiter before it can enter the turn. */
  private readonly waiting = new Set<() => void>();

  /** Bind long-lived semantic owners and register their reply routes exactly once. */
  constructor(
    /** Long-lived KEL processor (kvy), used for semantic reply routes and escrow recovery. */
    readonly kvy: Kevery,
    /** Shared reply verifier (rvy), including BADA and registered semantic routes. */
    readonly rvy: Revery,
    /** Shared exchange processor (exc), with the host's configured application handlers. */
    readonly exc: Exchanger,
    /** Legacy transaction-event processor (tvy), explicitly absent without VDR support. */
    readonly tvy: Tevery | null,
    /** Credential verifier (vry), sharing the composed registry store. */
    readonly vry: Verifier | null,
    /** V2 registry owner whose durable escrows advance with the protocol turn. */
    readonly registry: AcdcRegery | null,
    /** Private output from semantic handlers, captured before application publication. */
    private readonly protocolCues: Deck<AgentCue>,
    /** Ordinary application cues; the composed cue router is the consumer. */
    readonly cues: Deck<AgentCue>,
    /** Shared live request correlations; each requesting connection owns its slots. */
    readonly replies: QueryReplies,
  ) {
    if (
      protocolCues === cues || kvy.cues !== protocolCues || rvy.cues !== protocolCues
      || exc.cues !== protocolCues || kvy.db !== rvy.db || exc.hby.db !== kvy.db || kvy.rvy !== rvy
    ) {
      throw new TypeError("Protocol processors require one store and a distinct shared protocol cue flow");
    }
    new BasicReplyRouteHandler(rvy).registerReplyRoutes(rvy.rtr);
    kvy.registerReplyRoutes(rvy.rtr);
    tvy?.registerReplyRoutes(rvy.rtr);
  }

  /** Construct an input-owned Kevery with identical store, policy and cue bindings; register no routes. */
  makeKevery(): Kevery {
    return new Kevery(this.kvy.db, {
      cues: this.protocolCues,
      rvy: this.rvy,
      local: this.kvy.local,
      lax: this.kvy.lax,
      kramer: this.kvy.kramer,
      messagePolicy: { allowList: this.kvy.allowList, denyList: this.kvy.denyList },
    });
  }

  /** Process one frame and publish its committed protocol cues before returning decision data. */
  dispatch(
    frame: CesrFrame,
    { local = this.kvy.local, mailboxAid, escrows = false }: DispatchOptions = {},
    kvy: Kevery = this.kvy,
  ): Operation<ProtocolDispatchResult> {
    // A short-lived input processor must publish into this owner's private cue flow.
    if (kvy.db !== this.kvy.db || kvy.cues !== this.protocolCues || kvy.rvy !== this.rvy) {
      throw new TypeError("Kevery belongs to another protocol processing domain");
    }
    // deno-lint-ignore no-this-alias -- Generator callbacks have no lexical this.
    const self = this;
    return call(function*() {
      yield* self.acquireProtocol();
      return yield* call(function*() {
        try {
          const result = yield* dispatchEnvelope(
            envelopeFromFrame(frame, local),
            self.rvy,
            kvy,
            self.exc,
            self.tvy ?? undefined,
            self.vry ?? undefined,
            mailboxAid,
            self.kvy, // One authoritative v2 sender policy and KRAM intake across all inputs.
          );
          if (escrows) yield* self.advanceEscrows();
          return {
            ...result,
            mailboxQueryAuthorized: result.envelope.serder.route === "mbx"
              && kvy.isMailboxQueryAuthorized(queryEnvelopeFromDispatch(result.envelope)),
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
    this.kvy.kramer?.prune();
    this.kvy.processEscrows();
    this.rvy.processEscrowReply();
    this.tvy?.processEscrows();
    this.vry?.processEscrows();
    this.registry?.processEscrows();
    yield* this.exc.processEscrows();
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

/** Compose minimal KEL/reply/exchange intake over an existing Habery; acquire no stores or workers. */
export function createProtocolProcessor(hby: Habery): ProtocolProcessor {
  const cues = new Deck<AgentCue>(), protocolCues = new Deck<AgentCue>();
  const rvy = new Revery(hby.db, { cues: protocolCues });
  const kvy = new Kevery(hby.db, { cues: protocolCues, rvy });
  const exc = new Exchanger(hby, { cues: protocolCues });
  return new ProtocolProcessor(kvy, rvy, exc, null, null, null, protocolCues, cues, new QueryReplies(cues));
}
