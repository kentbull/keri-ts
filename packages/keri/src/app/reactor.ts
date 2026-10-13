import { type CesrParser, Cigar, createParser, Ilks, parseBytes, SerderKERI, Siger, Verfer } from "cesr-ts";
import { call, type Operation } from "npm:effection@^3.6.0";
import type { AgentCue } from "../core/cues.ts";
import { Deck } from "../core/deck.ts";
import { KeriDispatchEnvelope, TransIdxSigGroup, TransLastIdxSigGroup } from "../core/dispatch.ts";
import { Kevery } from "../core/eventing.ts";
import { BasicReplyRouteHandler, Revery, Router } from "../core/routing.ts";
import { Exchanger } from "./exchanging.ts";
import type { Habery } from "./habbing.ts";
import { dispatchEnvelope, envelopesFromFrames, type TeveryLike, type VerifierLike } from "./parsering.ts";
import { runtimeTurn } from "./runtime-turn.ts";

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
  readonly ingress: Deck<Uint8Array>;
  readonly router: Router;
  readonly revery: Revery;
  readonly replyRoutes: BasicReplyRouteHandler;
  readonly kevery: Kevery;
  readonly exchanger: Exchanger;
  readonly parser: CesrParser;
  readonly local: boolean;
  readonly vdr: VdrRuntimeServices;

  constructor(
    hby: Habery,
    {
      cues,
      local = false,
      vdr = {},
    }: {
      cues?: Deck<AgentCue>;
      local?: boolean;
      vdr?: VdrRuntimeServices;
    } = {},
  ) {
    this.hby = hby;
    this.cues = cues ?? new Deck();
    this.ingress = new Deck();
    this.router = new Router();
    this.revery = new Revery(hby.db, { rtr: this.router, cues: this.cues });
    this.replyRoutes = new BasicReplyRouteHandler(hby.db, this.revery);
    this.replyRoutes.registerReplyRoutes(this.router);
    this.kevery = new Kevery(hby.db, { cues: this.cues, rvy: this.revery });
    this.kevery.registerReplyRoutes(this.router);
    this.exchanger = new Exchanger(hby, { cues: this.cues });
    this.parser = createParser({
      framed: false,
    });
    this.local = local;
    this.vdr = vdr;
  }

  /**
   * Queue one complete CESR/KERI record for later parsing.
   *
   * This is the transient ingress seam used by both local synthetic messages
   * and remotely fetched OOBI artifacts.
   */
  ingest(bytes: Uint8Array): void {
    this.ingress.push(bytes);
  }

  /**
   * Feed a raw stream chunk and dispatch only frames with proven boundaries.
   *
   * This keeps the parser lifecycle owned by `Reactor` while letting higher
   * level hosts choose whether one ingress source should be treated as local or
   * remote without creating a second parser/router stack.
   */
  *processChunk(
    chunk: Uint8Array,
    { local = this.local, mailboxAid }: { local?: boolean; mailboxAid?: string | null } = {},
  ): Operation<void> {
    yield* this.dispatchParsedFrames(this.parser.feed(chunk), local, mailboxAid);
  }

  /**
   * Parse and dispatch one complete CESR/KERI record.
   *
   * HTTP bodies, mailbox SSE entries, and local messages have an explicit end.
   * A fresh parser plus flush completes their open attachment sets without
   * waiting for another record or affecting the shared streaming parser.
   */
  *processCompleteChunk(
    chunk: Uint8Array,
    { local = this.local, mailboxAid }: { local?: boolean; mailboxAid?: string | null } = {},
  ): Operation<void> {
    yield* this.dispatchParsedFrames(parseBytes(chunk), local, mailboxAid);
  }

  /** Complete each dispatch before advancing a parsed batch. */
  private *dispatchParsedFrames(
    frames: ReturnType<CesrParser["feed"]>,
    local: boolean,
    mailboxAid?: string | null,
  ): Operation<void> {
    for (
      const envelope of envelopesFromFrames(
        frames,
        local,
      )
    ) {
      const decision = yield* dispatchEnvelope(
        envelope,
        this.revery,
        this.kevery,
        this.exchanger,
        { tvy: this.vdr.tvy, vry: this.vdr.vry },
        mailboxAid,
      );
      if (decision?.kind === "unverified") {
        continue;
      }
    }
  }

  /**
   * Drain one bounded message-processing pass.
   *
   * This mirrors the KERIpy pattern where a doer owns the long-lived loop but
   * delegates the actual work to a plain drain helper.
   */
  *processOnce(): Operation<void> {
    while (!this.ingress.empty) {
      const chunk = this.ingress.pull();
      if (!chunk) {
        continue;
      }
      yield* this.processCompleteChunk(chunk);
    }
  }

  /**
   * Run one bounded escrow-processing pass.
   *
   * Current scope:
   * - KEL escrows through `Kevery.processEscrows()`
   * - reply escrows through `Revery.processEscrowReply()`
   */
  *processEscrowsOnce(): Operation<void> {
    this.kevery.processEscrows();
    this.revery.processEscrowReply();
    this.vdr.tvy?.processEscrows?.();
    this.vdr.vry?.processEscrows?.();
    yield* call(() => this.exchanger.processEscrows());
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
