/** Shared protocol mutations and publication, independent of byte-input and network lifetimes. */
import type { CesrFrame } from "cesr-ts";
import { call, type Operation } from "npm:effection@^3.6.0";
import type { RegistryObserver } from "../../acdc/observing.ts";
import type { AgentCue } from "../../core/cues.ts";
import { Deck } from "../../core/deck.ts";
import { ValidationError } from "../../core/errors.ts";
import { Kevery } from "../../core/kel/eventing.ts";
import { consoleLogger } from "../../core/logger.ts";
import { BasicReplyRouteHandler, Revery } from "../../core/routing.ts";
import type { Tevery } from "../../vdr/eventing.ts";
import type { Verifier } from "../credentials/verifying.ts";
import { Exchanger } from "../exchanges/exchanging.ts";
import type { Habery } from "../identity/habbing.ts";
import { QueryReplies } from "../queries/query-replies.ts";
import { type DoerPacing, doEveryOnWrite, PROTOCOL_PACING } from "../runtime/doing.ts";
import { type RuntimeClock, systemClock } from "../runtime/runtime-clock.ts";
import {
  type AuxiliaryQueryProcessor,
  dispatchEnvelope,
  type DispatchResult,
  envelopeFromFrame,
  queryEnvelopeFromDispatch,
} from "./parsering.ts";

/**
 * Wait after every escrow pass, as KERIpy's Doist cycle (`tock` 0.03125 s, app/directing.py) paces its `escrowDo`,
 * which runs one full pass per cycle. A pass is never skipped or shortened; this is the time others get between passes.
 */
export const ESCROW_TOCK_MS = 31.25;

/** Protocol choices any input may make for a frame; input owners separately own cancellation and parsing. */
export interface IntakeOptions {
  /** Whether the frame arrived through local witness/controller intake. */
  local?: boolean;
  /** Hosted mailbox endpoint provenance, independent of the signed sender. */
  mailboxAid?: string | null;
  /** Advance durable escrows after capturing this frame's decision and direct replies. */
  escrows?: boolean;
}

/** Intake choices plus `retained`, which only a finite, caller-initiated local import sets. */
export interface DispatchOptions extends IntakeOptions {
  /**
   * The frame is retained history the caller already holds, read back from a store (an exported disclosure stream),
   * not a message arriving now. A v2 `exn`/`xip` then skips KRAM intake: its original stamp is long past the
   * receiver's window by design, and KRAM's replay protection guards live intake, not a local copy of accepted
   * history. Nothing else is relaxed: sender policy still applies, the Exchanger still authenticates every signature
   * against the sender's key state and runs the route's verify, escrows behave as usual, and queries and replies
   * still pass KRAM. The Exchanger keeps the fact (see `ExchangeInput.retained`). Network inputs (HTTP, TCP, mailbox,
   * witness ingress, the Reactor) take {@link IntakeOptions}, which cannot carry it.
   */
  retained?: boolean;
}

/** Exact processed evidence and mailbox authorization captured at the query decision. */
export interface ProtocolDispatchResult extends DispatchResult {
  /** Current request authorization, never inferred solely from a matching reply SAID. */
  mailboxQueryAuthorized: boolean;
}

/**
 * Identify a refusal of one already-extracted message, which must not end its stream.
 *
 * KERIpy's parser resumes after any non-extraction exception. This is deliberately narrower:
 * infrastructure failures, programmer errors and cancellation must still reach the input owner.
 * A dispatch-side ParserError also propagates, because it indicates corrupt local state and
 * skipping would advance a mailbox cursor past a message that was never processed.
 */
function isInvalidMessageError(error: unknown): error is ValidationError {
  return error instanceof ValidationError;
}

/**
 * Dispatch to synchronous semantic owners and publish their committed output.
 *
 * KERIpy supplies parsers with concrete Kevery/Revery/Exchanger owners. Domain
 * writers decide and commit without suspension; exchange durability and application
 * handlers run in their input's operation. Independent inputs and escrow scans may
 * progress during that I/O. This owner captures query replies before application delivery
 * and registers shared semantic routes once; it owns no lock, input queue or transport.
 */
export class ProtocolProcessor {
  /**
   * Bind long-lived semantic owners and register their reply routes exactly once.
   *
   * @param kvy Shared KEL owner for semantic reply routes, KRAM policy and escrow recovery.
   * @param rvy Shared reply verifier bound to the same database and private cue flow.
   * @param exc Shared exchange owner with application handlers already configured.
   * @param tvy Borrowed legacy TEL owner, or null without VDR support.
   * @param vry Borrowed credential verifier, or null without that capability.
   * @param registry Borrowed public v2 registry intake and escrow owner, or null.
   * @param protocolCues Private semantic-output Deck; distinct from application cues.
   * @param cues Application output Deck consumed by the composed cue router.
   * @param replies Shared live request correlations captured before application publication.
   * @param qvy Optional caller-owned auxiliary query receiver; owns its authorization and lifecycle.
   * @throws TypeError for inconsistent stores or cue bindings.
   */
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
    /** Public v2 registry intake; local alias management remains with Regery. */
    readonly registry: RegistryObserver | null,
    /** Private output from semantic handlers, captured before application publication. */
    private readonly protocolCues: Deck<AgentCue>,
    /** Ordinary application cues; the composed cue router is the consumer. */
    readonly cues: Deck<AgentCue>,
    /** Shared live request correlations; each requesting connection owns its slots. */
    readonly replies: QueryReplies,
    readonly qvy?: AuxiliaryQueryProcessor,
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

  /**
   * Construct an input-owned Kevery with identical store, policy and cue bindings; register no routes.
   *
   * @returns A new input-specific Kevery sharing accepted state, policy, Revery and the private cue Deck.
   */
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

  /**
   * Process one frame and publish its committed protocol cues before returning decision data.
   *
   * @param frame Complete hydrated frame whose evidence remains valid for this operation.
   * @param options Local intake policy, hosted mailbox provenance, whether to advance escrows, and whether the frame is
   *   retained history from a finite local import.
   * @param kvy Input-specific Kevery in this domain; defaults to the shared owner.
   * @returns Exact dispatch result and current mailbox authorization at its synchronous query decision.
   *   A message refused by validation after extraction is an `invalidMessage` drop, so the caller
   *   continues with the next frame as KERIpy's parser does.
   * @throws Domain mismatch, infrastructure/handler or cleanup errors propagate; publication still runs in the dispatch finalizer.
   */
  dispatch(
    frame: CesrFrame,
    { local = this.kvy.local, mailboxAid, escrows = false, retained = false }: DispatchOptions = {},
    kvy: Kevery = this.kvy,
  ): Operation<ProtocolDispatchResult> {
    // A short-lived input processor must publish into this owner's private cue flow.
    if (kvy.db !== this.kvy.db || kvy.cues !== this.protocolCues || kvy.rvy !== this.rvy) {
      throw new TypeError("Kevery belongs to another protocol processing domain");
    }
    // deno-lint-ignore no-this-alias -- Generator callbacks have no lexical this.
    const self = this;
    return call(function*() {
      try {
        const envelope = envelopeFromFrame(frame, local);
        let result: DispatchResult;
        let invalid = false;
        try {
          result = yield* dispatchEnvelope(
            envelope,
            self.rvy,
            kvy,
            self.exc,
            self.tvy ?? undefined,
            self.vry ?? undefined,
            mailboxAid,
            self.kvy, // One authoritative v2 sender policy and KRAM intake across all inputs.
            self.registry ?? undefined,
            self.qvy,
            retained,
          );
        } catch (error) {
          if (!isInvalidMessageError(error)) throw error;
          invalid = true;
          consoleLogger.warn("Skipping invalid message", {
            said: envelope.serder.said,
            ilk: envelope.serder.ilk,
            route: envelope.serder.route,
            detail: error.message,
          });
          result = { envelope, decision: { kind: "drop", reason: "invalidMessage", detail: error.message } };
        }
        const mailboxQueryAuthorized = !invalid && result.envelope.serder.route === "mbx"
          && kvy.isMailboxQueryAuthorized(queryEnvelopeFromDispatch(result.envelope));
        // Capture this request's facts before optional escrows can suspend or change key state.
        self.publishCues();
        if (escrows) yield* self.advanceEscrows();
        return { ...result, mailboxQueryAuthorized };
      } finally {
        self.publishCues();
      }
    });
  }

  /** Capture direct replies before handing ordinary protocol records to the application consumer. */
  private publishCues(): void {
    this.replies.capture(this.protocolCues);
    while (!this.protocolCues.empty) this.cues.push(this.protocolCues.pull()!);
  }

  /** Advance configured escrow owners; each scan joins its own I/O and handler cleanup. */
  *processEscrowsOnce(): Operation<void> {
    try {
      yield* this.advanceEscrows();
    } finally {
      this.publishCues();
    }
  }

  /**
   * Retry only KEL/reply dependencies and publish their committed cues.
   *
   * Finite introduction bootstrap needs these synchronous owners, without
   * advancing unrelated exchange, credential or registry application work.
   * Full host escrow processing retains its existing family/publication order.
   */
  processKelReplyEscrowsOnce(): void {
    try {
      this.advanceKelReplyEscrows();
    } finally {
      this.publishCues();
    }
  }

  /** Shared synchronous KEL/reply retry unit; the invoking composition owns publication. */
  private advanceKelReplyEscrows(): void {
    this.kvy.processEscrows();
    this.rvy.processEscrowReply();
  }

  /** Publish synchronous escrow facts before progressing asynchronous EXN recovery. */
  private *advanceEscrows(): Operation<void> {
    this.kvy.kramer?.prune();
    this.advanceKelReplyEscrows();
    this.tvy?.processEscrows();
    this.vry?.processEscrows();
    this.registry?.processAllEscrows();
    this.publishCues();
    yield* this.exc.processEscrows();
  }

  /**
   * Continuous escrow doer for the long-lived runtime host.
   *
   * KERIpy correspondence:
   * - mirrors the dedicated `escrowDo` loop rather than folding escrow
   *   processing into parser ingress
   *
   * A pass is a function of the store and of time, so this is a {@link doEveryOnWrite} doer: a pass on tock 0,
   * after any store write, and every `pacing.idleTocks` tocks for what only time releases (timeouts, KRAM
   * windows). Data-driven work waits at most one tock.
   */
  *escrowDo(clock: RuntimeClock = systemClock, pacing: Readonly<DoerPacing> = PROTOCOL_PACING): Operation<never> {
    // Escrows live in the KEL store and, for TEL and registry work, in the registry stores; a write to any of them
    // runs the next tock's pass.
    const stores = [this.kvy.db, this.tvy?.reger, this.registry?.store.baser].filter((store) => !!store);
    const written = {
      get writeActivity() {
        return stores.reduce((sum, store) => sum + store.writeActivity, 0);
      },
    };
    return yield* doEveryOnWrite(clock, pacing, written, () => this.processEscrowsOnce());
  }
}

/**
 * Compose minimal KEL/reply/exchange intake over an existing Habery; acquire no stores or workers.
 *
 * @param hby Borrowed local habitat collection and accepted-state database.
 * @returns A minimal KEL/reply/exchange processor with no registry owners or running workers.
 */
export function createProtocolProcessor(hby: Habery): ProtocolProcessor {
  const cues = new Deck<AgentCue>(), protocolCues = new Deck<AgentCue>();
  const rvy = new Revery(hby.db, { cues: protocolCues });
  const kvy = new Kevery(hby.db, { cues: protocolCues, rvy });
  const exc = new Exchanger(hby, { cues: protocolCues });
  return new ProtocolProcessor(kvy, rvy, exc, null, null, null, protocolCues, cues, new QueryReplies(cues));
}
