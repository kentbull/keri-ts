import { type Operation } from "npm:effection@^3.6.0";
import { type CesrParser, Cigar, createParser, Ilks, SerderKERI, Siger, Verfer } from "../../../cesr/mod.ts";
import type { AgentCue } from "../core/cues.ts";
import { Deck } from "../core/deck.ts";
import { KeriDispatchEnvelope, TransIdxSigGroup, TransLastIdxSigGroup } from "../core/dispatch.ts";
import { UnverifiedReplyError } from "../core/errors.ts";
import { Kevery } from "../core/eventing.ts";
import { BasicReplyRouteHandler, Revery, Router } from "../core/routing.ts";
import { Exchanger } from "./exchanging.ts";
import type { Habery } from "./habbing.ts";
import { dispatchEnvelope, envelopesFromFrames } from "./parsering.ts";
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

  constructor(
    hby: Habery,
    { cues, local = false }: { cues?: Deck<AgentCue>; local?: boolean } = {},
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
      attachmentDispatchMode: "compat",
    });
    this.local = local;
  }

  /**
   * Queue one CESR/KERI message byte sequence for later parsing.
   *
   * This is the transient ingress seam used by both local synthetic messages
   * and remotely fetched OOBI artifacts.
   */
  ingest(bytes: Uint8Array): void {
    this.ingress.push(bytes);
  }

  /**
   * Drain one bounded message-processing pass.
   *
   * This mirrors the KERIpy pattern where a doer owns the long-lived loop but
   * delegates the actual work to a plain drain helper.
   */
  processOnce(): void {
    while (!this.ingress.empty) {
      const chunk = this.ingress.pull();
      if (!chunk) {
        continue;
      }
      for (
        const envelope of envelopesFromFrames(
          this.parser.feed(chunk),
          this.local,
        )
      ) {
        try {
          dispatchEnvelope(
            envelope,
            this.revery,
            this.kevery,
            this.exchanger,
          );
        } catch (error) {
          if (!(error instanceof UnverifiedReplyError)) {
            throw error;
          }
        }
      }
    }
  }

  /**
   * Run one bounded escrow-processing pass.
   *
   * Current scope:
   * - KEL escrows through `Kevery.processEscrows()`
   * - reply escrows through `Revery.processEscrowReply()`
   */
  processEscrowsOnce(): void {
    this.kevery.processEscrows();
    this.revery.processEscrowReply();
    this.exchanger.processEscrows();
  }

  /**
   * Continuous message doer for command hosts that keep the runtime alive.
   *
   * This is the Effection equivalent of a KERIpy `msgDo`: drain ingress, yield
   * to the scheduler, and repeat indefinitely.
   */
  *msgDo(): Operation<never> {
    while (true) {
      this.processOnce();
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
      this.processEscrowsOnce();
      yield* runtimeTurn();
    }
  }
}
