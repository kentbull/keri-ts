/**
 * IPEX Unblind, following Python's local query/reply profile.
 * Only event openings cross this boundary. Roots, application state vocabulary,
 * transport and final Admit remain with their existing owners.
 *
 * Consent: the disclosee explicitly approves (`approve`/`start`) the Grant it requests proofs for.
 * The discloser has no separate approval step: it consented by signing the presentation Grant, so an
 * authenticated query for a live Grant this identifier sent is answered automatically, bounded by that
 * Grant's registry scope and original deadline. The rule is decided from stored state, so it survives a
 * restart. KERIpy's `Unblind` keeps its own local approve gate; that is local policy and the wire is
 * unchanged.
 */
import {
  bytesEqual,
  type CesrFrame,
  type Cigar,
  concatBytes,
  Counter,
  Diger,
  Kinds,
  makeBlindUuid,
  NumberPrimitive,
  parseAttachmentGroup,
  parseBytes,
  SealSource,
  SerderACDC,
  type SerderKERI,
  unblindBlindState,
  Vrsn_2_0,
} from "cesr-ts";
import type { Operation } from "effection";
import type { ExchangeDecision, Exchanger, PresentationScope } from "../app/exchanges/exchanging.ts";
import { Hab } from "../app/identity/habbing.ts";
import { IpexV2Handler } from "../app/ipex/ipex-v2.ts";
import { isLocalGroupHab, latestGroupContribution, localGroupMember } from "../app/multisig/group-members.ts";
import {
  type AuxiliaryQueryProcessor,
  auxiliaryQueryWire,
  envelopeFromFrame,
  type MessageDropDecision,
  restoreAuxiliaryQuery,
} from "../app/protocol/parsering.ts";
import { abortable } from "../app/runtime/abortable.ts";
import { Deck } from "../core/deck.ts";
import { type KeriDispatchEnvelope, TransIdxSigGroup } from "../core/dispatch.ts";
import { PresentationClosedError, ValidationError } from "../core/errors.ts";
import { verifyExchangeProofs, verifyQueryAttachments } from "../core/exchange/exchange-proofing.ts";
import { Kever } from "../core/kel/kever.ts";
import { query, reply } from "../core/protocol-eventing.ts";
import { messagize } from "../core/protocol-serialization.ts";
import { fetchStoredTsgs, type ReplyProcessDecision, type Revery, unverifiedReplyDecision } from "../core/routing.ts";
import type { Baser } from "../db/basing.ts";
import { prepareNests, publishNests } from "../db/exchange/exchange-nests.ts";
import type { RegistryObserver } from "./observing.ts";
import {
  type RegistryDisclosure,
  validateUpdate,
  verifyRegistryAnchor,
  vet,
  vetBlind,
  vetBound,
} from "./regeventing.ts";
import { publicOpeningAttachment } from "./registering.ts";

type Selection = Record<string, string[]>;
interface UnblindOperation {
  xid: string;
  grant: string;
  sender: string;
  recipient: string;
  raw: Uint8Array;
  bodies: Uint8Array[];
  scope: PresentationScope;
  query: Uint8Array | null;
  reply: Uint8Array | null;
  requested: Selection | null;
  selected: Selection | null;
  openings: Map<string, RegistryDisclosure>;
  /** Ordinary-state vocabulary frozen when the operation was approved. */
  states: readonly string[];
  requestedByPeer: boolean;
  received: boolean;
  abandoned: boolean;
  proposal: Uint8Array | null;
  contribution: Uint8Array | null;
}

/** Ordinary registry states an Unblind operation may reveal unless its approval names others. */
export const DEFAULT_UNBLIND_STATES: readonly string[] = Object.freeze(["issued", "revoked", ""]);

/** Member signing proposals or elected delivery of full aggregates; all bytes are process-local. */
export interface UnblindOutgoing {
  kin: "sign" | "query" | "reply";
  dest: string;
  msg: Uint8Array;
}

/** Compare registry selections without treating JSON dictionary order as authority. */
function sameSelection(left: Selection, right: Selection): boolean {
  return Object.keys(left).length === Object.keys(right).length
    && Object.entries(left).every(([key, values]) =>
      right[key]?.length === values.length && values.every((value, index) => right[key][index] === value)
    );
}

/** Decode exactly one complete wire message, without dispatch or database effects. */
function parsed(raw: Uint8Array): KeriDispatchEnvelope {
  const frames = parseBytes(concatBytes(Counter.makeGVC(Vrsn_2_0), raw));
  if (frames.length !== 1) throw new ValidationError("Expected exactly one Unblind message");
  return envelopeFromFrame(frames[0]);
}

/** Source evidence is accepted only from the public chain, never raw escrow bodies. */
function ordinal(event: SerderACDC): number {
  const sn = BigInt(`0x${event.sad!.n}`);
  if (sn > BigInt(Number.MAX_SAFE_INTEGER)) throw new ValidationError("Registry ordinal exceeds storage range");
  return Number(sn);
}

/**
 * One presentation's explicit proof-release consent. Inject as qvy
 * and register Route on the habitat's existing Revery Router. Wire intake cannot
 * approve work; a fresh owner cannot resume an unfinished operation. Group members
 * sign exact proposals under that approval. Ordinary thresholds elect delivery
 * from the completed aggregate; neither contribution nor delivery requires a root.
 */
/** A query's source event is not known here yet: the issuer's KEL has not reached the anchoring event. */
class SourceNotYetKnown extends ValidationError {
  override readonly name: string = "SourceNotYetKnown";
  constructor(readonly issuer: string, readonly sn: number) {
    super(`Query event has an unverified source: the anchoring event ${sn} of ${issuer} is not known`);
  }
}

/** Milliseconds between requests for the issuer's KEL while a query waits for its anchoring event. */
const KEL_ASK_MS = 5000;

export class Unblind implements AuxiliaryQueryProcessor {
  static readonly Route = "/ipex/unblind";
  readonly resource = Unblind.Route;
  readonly outgoing = new Deck<UnblindOutgoing>();
  private readonly operations = new Map<string, UnblindOperation>();
  /** Whether the persisted requests this identifier owes replies to were taken up by this owner. */
  private restored = false;
  /**
   * Queries held until the issuer's anchoring event is known here, by transaction. The wire is already in `heldu`; this
   * only says which are still waiting and when the issuer's KEL was last asked for. Memory only: a reopened owner
   * processes `heldu` again and the query waits again.
   */
  private readonly waiting = new Map<string, { issuer: string; sn: number; askedAt: number }>();
  readonly hab: Hab;
  readonly exc: Exchanger;
  readonly rvy: Revery;
  readonly registry: RegistryObserver;
  readonly group: boolean;
  private readonly kram: boolean;

  /** Bind the exact Grant verifier's store; the state vocabulary is chosen per approved operation. */
  constructor({ hab, exc, registry, rvy = hab.rvy, kram = true }: {
    hab: Hab;
    exc: Exchanger;
    registry: RegistryObserver;
    rvy?: Revery;
    /** False when the runtime has KRAM off: its `tmsc`/`msgc` rows never exist, so `approve` refuses. */
    kram?: boolean;
  }) {
    this.kram = kram;
    if (
      !(hab instanceof Hab) || hab.db !== exc.hby.db || registry.db !== hab.db || rvy.db !== hab.db
      || exc.hby.habs.get(hab.pre!) !== hab
    ) {
      throw new ValidationError("Unblind requires a local signing habitat");
    }
    this.group = isLocalGroupHab(exc.hby, hab);
    if (this.group) localGroupMember(exc.hby, hab.pre!);
    this.hab = hab;
    this.exc = exc;
    this.rvy = rvy;
    this.registry = registry;
  }

  /**
   * Freeze one authenticated live Grant's exact bodies, parties, authorized registry scope and
   * ordinary-state vocabulary. `states` defaults to the registry-root triple and applies to this
   * operation only; approving the same Grant again with different explicit states is refused,
   * while omitting `states` on a repeat approval keeps the frozen vocabulary.
   */
  approve(grant: string, options: { states?: readonly string[] } = {}): string {
    if (!this.kram) throw new ValidationError("Unblind requires KRAM: enable it with the runtime's kram option");
    const states = options.states ?? DEFAULT_UNBLIND_STATES;
    if (!Array.isArray(states) || states.some((state) => typeof state !== "string")) {
      throw new ValidationError("Unblind requires an explicit sequence of state strings");
    }
    const input = this.exc.retainedInput(grant);
    if (!input) throw new ValidationError("Unblind requires an authenticated retained Grant");
    const message = input.serder, sender = message.pre, recipient = message.sad!.ri;
    const xid = message.ilk === "xip" ? message.said : message.sad!.x;
    if (
      typeof xid !== "string" || !sender || typeof recipient !== "string" || sender === recipient
      || ![sender, recipient].includes(this.hab.pre!)
    ) throw new ValidationError("Local habitat is not a presentation party");
    const handler = this.exc.handlerFor(message);
    if (!(handler instanceof IpexV2Handler) || handler.registry !== this.registry.store) {
      throw new ValidationError("Unblind must use the selected Grant verifier's registry store");
    }
    const existing = this.operations.get(xid);
    if (existing) {
      if (existing.grant !== grant) throw new ValidationError("Another Grant is selected for this transaction");
      if (
        options.states
        && (existing.states.length !== states.length || existing.states.some((state, i) => state !== states[i]))
      ) {
        throw new ValidationError("Unblind operation already approved with different states");
      }
      this.live(existing);
      return xid;
    }
    const context = this.exc.presentationContext(grant, { xid, sender, recipient });
    if (!context && this.hab.db.erpy.get([grant])) {
      throw new PresentationClosedError(
        "Presentation is closed: its terminal response (Admit or Spurn) ended the discloser's authority to answer "
          + "queries about it, so an Unblind must be requested before the response is made",
      );
    }
    if (!context) throw new ValidationError("Presentation is unavailable, terminated or expired");
    this.operations.set(xid, {
      xid,
      grant,
      sender,
      recipient,
      raw: message.raw.slice(),
      bodies: context.nests.map((nest) => nest.body.raw.slice()),
      scope: new Map([...context.registries].map(([regid, nodes]) => [regid, [...nodes]])),
      query: null,
      reply: null,
      requested: null,
      selected: null,
      openings: new Map(),
      states: [...states],
      requestedByPeer: false,
      received: false,
      abandoned: false,
      proposal: null,
      contribution: null,
    });
    return xid;
  }

  /** Freeze a signed disclosee query over the missing accepted public suffix. */
  start(grant: string, options: { states?: readonly string[] } = {}): Uint8Array {
    const op = this.operation(this.approve(grant, options));
    if (this.hab.pre !== op.recipient) throw new ValidationError("Only the disclosee starts Unblind");
    if (!op.query && !op.contribution) {
      const { requested, children } = this.request(op);
      const message = query(Unblind.Route, { x: op.xid, re: requested }, {
        pre: this.hab.pre,
        replyRoute: Unblind.Route,
        pvrsn: Vrsn_2_0,
        kind: Kinds.json,
      });
      const signed = this.signed(message, children);
      op.requested = requested;
      if (this.group) {
        op.proposal = message.raw.slice();
        op.contribution = signed;
        this.outgoing.push({ kin: "sign", dest: this.hab.pre!, msg: signed.slice() });
      } else op.query = signed;
    }
    this.current(op);
    return (op.query ?? op.contribution!).slice();
  }

  /**
   * Re-sign this disclosee's started individual query for delivery now.
   *
   * KERIpy `Unblind.requery` (kentbull/keripy#159): a queued query can age past
   * the discloser's KRAM timeliness window before transport begins. The renewal
   * keeps the approved Grant, the frozen requested events and their nested
   * public evidence; only the query's own `dt`, SAID and signatures change, and
   * it becomes the outstanding query. A newer registry head still needs a new
   * operation, and the Grant's deadline is never extended. Groups cannot renew here.
   */
  requery(xid: string): Uint8Array {
    const op = this.operation(xid);
    if (this.group) throw new ValidationError("one group member cannot renew a threshold unblind query");
    if (this.hab.pre !== op.recipient || !op.query) throw new ValidationError("unblind has no started disclosee query");
    if (op.received) throw new ValidationError("unblind already received its authenticated reply");
    this.current(op);
    const { requested, children } = this.request(op);
    if (!op.requested || !sameSelection(requested, op.requested)) {
      throw new ValidationError("unblind request differs from the approved query");
    }
    const message = query(Unblind.Route, { x: op.xid, re: requested }, {
      pre: this.hab.pre,
      replyRoute: Unblind.Route,
      pvrsn: Vrsn_2_0,
      kind: Kinds.json,
    });
    op.query = this.signed(message, children);
    return op.query.slice();
  }

  /**
   * Contribute to one exact group proposal under the existing local approval.
   * Validate every member signature and the public suffix/minimum openings before
   * signing. A rootless member signs the supplied proof, never derives a root.
   */
  contribute(xid: string, proposal: Uint8Array): Uint8Array {
    if (!this.group) throw new ValidationError("Unblind contribution requires a local group member");
    const envelope = parsed(proposal), message = envelope.serder, querying = message.ilk === "qry";
    if (!querying && message.ilk !== "rpy") throw new ValidationError("Expected a signed Unblind query or reply");
    this.attachments(envelope, querying ? "query" : "reply");
    if (envelope.sigers.length || envelope.cigars.length) {
      throw new ValidationError("Group proposal requires named group signing factors");
    }
    const { op, selected, nests } = this.preflight(
      message,
      querying ? "q" : "a",
      querying ? "recipient" : "sender",
      true,
    );
    if (op.xid !== xid || querying && message.sad!.rr !== Unblind.Route) {
      throw new ValidationError("Proposal differs from the approved Unblind transaction");
    }
    if (!querying && !op.requestedByPeer) {
      throw new ValidationError("Group reply requires its authenticated peer query");
    }
    this.current(op);
    if (op.proposal && !bytesEqual(op.proposal, message.raw)) {
      throw new ValidationError("Unblind proposal body is frozen");
    }
    const kever = this.hab.kever!;
    const groups = [
      ...envelope.tsgs,
      ...envelope.ssgs.map(group =>
        new TransIdxSigGroup(
          group.prefixer,
          NumberPrimitive.fromNum(BigInt(kever.lastEst.s)),
          new Diger({ qb64: kever.lastEst.d }),
          group.sigers,
        )
      ),
    ];
    if (!groups.length) throw new ValidationError("Proposal lacks a group member signature");
    for (const group of groups) {
      if (group.pre !== this.hab.pre || group.sn !== BigInt(kever.lastEst.s) || group.said !== kever.lastEst.d) {
        throw new ValidationError("Proposal names different group establishment keys");
      }
      const verified = Kever.verifyIndexedSignatures(message.raw, group.sigers, kever.verfers);
      if (!verified.sigers.length || verified.sigers.length !== group.sigers.length) {
        throw new ValidationError("Proposal lacks valid member contributions");
      }
    }
    const extra = querying
      ? this.queryEvidence(op, selected, envelope.nests)
      : envelope.attachmentGroups.filter(group =>
        ["BlindedStateQuadruples", "BoundStateSextuples"]
          .includes(group.name.replace(/^Big/, ""))
      ).map(group => group.raw);
    if (!querying) {
      const openings = this.replyOpenings(op, selected, nests, [...envelope.bsqs, ...envelope.bsss]);
      const minimum = this.minimum(op, nests, event => this.opening(openings, event));
      if (!sameSelection(selected, minimum.selected)) {
        throw new ValidationError("Reply is not the minimum current suffix");
      }
    }
    if (op.contribution) {
      const previous = parsed(op.contribution);
      const old = querying
        ? this.publicEvents(previous.nests)
        : previous.attachmentGroups.filter(group =>
          ["BlindedStateQuadruples", "BoundStateSextuples"]
            .includes(group.name.replace(/^Big/, ""))
        ).map(group => group.raw);
      if (old.length !== extra.length || old.some((wire, index) => !bytesEqual(wire, extra[index]))) {
        throw new ValidationError("Unblind proposal evidence is frozen");
      }
    } else {
      const signed = this.signed(message, extra);
      op.proposal = message.raw.slice();
      op.contribution = signed;
      if (querying) op.requested = selected;
    }
    return op.contribution.slice();
  }

  /** Authenticate the full peer threshold before public evidence intake or proof release. */
  processQuery(envelope: KeriDispatchEnvelope): { kind: "accept" } | MessageDropDecision {
    try {
      const { serder } = envelope;
      if (serder.ilk !== "qry" || serder.sad!.rr !== Unblind.Route) throw new ValidationError("Invalid Unblind query");
      this.attachments(envelope, "query");
      const own = this.group && serder.pre === this.hab.pre;
      const xid = (serder.sad?.q as { x?: unknown } | undefined)?.x;
      if (!own && typeof xid === "string" && !this.operations.has(xid)) {
        // The discloser consented by signing the Grant: answer an authenticated query for a live one it sent.
        if (!verifyQueryAttachments(this.hab.db, envelope)) return { kind: "drop", reason: "missingAuthentication" };
        this.approve(this.sentGrant(serder.pre!, xid));
      }
      const { op, selected } = this.preflight(serder, "q", own ? "recipient" : "sender", own);
      if (own && (!op.proposal || !bytesEqual(op.proposal, serder.raw))) {
        throw new ValidationError("Own Unblind query lacks its exact locally approved proposal");
      }
      if (!verifyQueryAttachments(this.hab.db, envelope)) return { kind: "drop", reason: "missingAuthentication" };
      if (op.requested && !sameSelection(op.requested, selected)) {
        throw new ValidationError("Conflicting Unblind request");
      }
      if (own) {
        const extra = this.queryEvidence(op, selected, envelope.nests);
        this.current(op);
        const kever = this.hab.kever!;
        let groups = envelope.tsgs.filter(group => group.pre === this.hab.pre);
        if (!groups.length) {
          const sigers = [
            ...envelope.sigers,
            ...envelope.ssgs.filter(group => group.pre === this.hab.pre).flatMap(group => group.sigers),
          ];
          groups = [
            new TransIdxSigGroup(
              kever.prefixer,
              NumberPrimitive.fromNum(BigInt(kever.lastEst.s)),
              new Diger({ qb64: kever.lastEst.d }),
              sigers,
            ),
          ];
        }
        this.groupMessage(op, "query", serder, groups, extra);
        return { kind: "accept" };
      }
      try {
        this.receiveEvents(selected, envelope.nests);
      } catch (error) {
        if (!(error instanceof SourceNotYetKnown)) throw error;
        // Not invalid, only early: keep the query durably, ask for the issuer's KEL, and take it up when it arrives.
        this.hab.db.heldu.pin([this.hab.pre!, op.xid], auxiliaryQueryWire(envelope, this.publicEvents(envelope.nests)));
        this.waiting.set(op.xid, { issuer: error.issuer, sn: error.sn, askedAt: 0 });
        this.askForKel(op.xid);
        return { kind: "accept" };
      }
      this.waiting.delete(op.xid);
      this.live(op);
      op.requested = selected;
      op.requestedByPeer = true;
      // KRAM now holds this query as seen, so a resend of it is a replay and a group cannot re-date it: the
      // owed reply must outlive this owner. The accepted request is the durable record; the operation is a cache.
      this.hab.db.heldu.pin([this.hab.pre!, op.xid], auxiliaryQueryWire(envelope, this.publicEvents(envelope.nests)));
      if (!this.group) this.respond(op.xid);
      return { kind: "accept" };
    } catch (error) {
      if (error instanceof ValidationError) return { kind: "drop", reason: "invalidQuery" };
      throw error;
    }
  }

  /**
   * Take up the requests this identifier owes a reply to after its owner was lost: each persisted request is
   * processed again as when first accepted, and one that no longer holds (the Grant ended, its evidence changed)
   * is dropped. Done once per owner, before the first look at what is owed.
   */
  /** Ask, through the ordinary missing-state query cue, for the issuer's events up to the anchoring one; at most every few seconds. */
  private askForKel(xid: string): void {
    const held = this.waiting.get(xid), now = Date.now();
    if (!held || now - held.askedAt < KEL_ASK_MS) return;
    held.askedAt = now;
    this.rvy.cues.push({ kin: "query", pre: held.issuer, route: "logs", q: { s: held.sn.toString(16) } });
  }

  /** Take up the held queries whose anchoring event has since arrived; the rest ask for it again in due time. */
  private retryWaiting(): void {
    for (const [xid, held] of [...this.waiting]) {
      if (this.hab.db.kels.getLast(held.issuer, held.sn) === null) {
        this.askForKel(xid);
        continue;
      }
      const wire = this.hab.db.heldu.get([this.hab.pre!, xid]);
      this.waiting.delete(xid);
      if (!wire) continue;
      let decision;
      try {
        decision = this.processQuery(restoreAuxiliaryQuery(wire));
      } catch (error) {
        if (!(error instanceof ValidationError)) throw error;
      }
      if (decision?.kind !== "accept") this.hab.db.heldu.rem([this.hab.pre!, xid]);
    }
  }

  /** Why the query of `xid` has not been answered, when it is waiting for the issuer's anchoring event. */
  missingSource(xid: string): string | null {
    const held = this.waiting.get(xid);
    return held ? `the anchoring event ${held.sn} of the issuer ${held.issuer} was never received` : null;
  }

  private restoreHeld(): void {
    if (this.restored) return;
    this.restored = true;
    for (const [[, xid], wire] of [...this.hab.db.heldu.getTopItemIter([this.hab.pre!])]) {
      if (this.operations.has(xid)) continue;
      let decision;
      try {
        decision = this.processQuery(restoreAuxiliaryQuery(wire));
      } catch (error) {
        if (!(error instanceof ValidationError)) throw error;
      }
      if (decision?.kind !== "accept") this.hab.db.heldu.rem([this.hab.pre!, xid]);
    }
  }

  /** Schedule responder work only after the selected live operation authenticates its peer query. */
  hasPeerQuery(xid: string): boolean {
    const op = this.operation(xid);
    this.live(op);
    this.current(op);
    if (this.hab.pre !== op.sender) throw new ValidationError("Peer query readiness requires the selected discloser");
    return op.requestedByPeer;
  }

  /** Retry a previously authenticated request locally when held proofs become available. */
  respond(xid: string): Uint8Array {
    const op = this.operation(xid), { nests } = this.live(op);
    if (this.hab.pre !== op.sender || !op.requestedByPeer) throw new ValidationError("No authenticated peer request");
    this.current(op);
    if (this.group && op.contribution) return (op.reply ?? op.contribution).slice();
    if (!op.reply) {
      const { selected, openings } = this.minimum(op, nests, (event) => this.held(op, event, nests));
      const message = reply(Unblind.Route, { x: op.xid, re: selected }, {
        pre: this.hab.pre!,
        pvrsn: Vrsn_2_0,
        kind: Kinds.json,
      });
      const signed = this.signed(message, openings.map(publicOpeningAttachment));
      if (this.group) {
        op.proposal = message.raw.slice();
        op.contribution = signed;
        this.outgoing.push({ kin: "sign", dest: this.hab.pre!, msg: signed.slice() });
        return signed.slice();
      }
      op.reply = signed;
    }
    this.outgoing.push({ kin: "reply", dest: op.recipient, msg: op.reply.slice() });
    return op.reply.slice();
  }

  /** Independently vet openings before caching them; Revery owns signature threshold and BADA. */
  processReply({ serder, diger, route, cigars = [], tsgs = [], attachments }: {
    serder: SerderKERI;
    diger: Diger;
    route: string;
    cigars?: Cigar[];
    tsgs?: TransIdxSigGroup[];
    attachments?: KeriDispatchEnvelope;
  }): ReplyProcessDecision {
    try {
      if (serder.ilk !== "rpy" || route !== Unblind.Route) throw new ValidationError("Invalid Unblind reply");
      // Revery's proof escrow can retry without attachments after independently
      // checked openings entered this process-local operation on initial intake.
      if (attachments) {
        if (!bytesEqual(attachments.serder.raw, serder.raw)) {
          throw new ValidationError("Reply attachment body mismatch");
        }
        this.attachments(attachments, "reply");
      }
      const own = this.group && serder.pre === this.hab.pre;
      const { op, selected, nests } = this.preflight(serder, "a", own ? "sender" : "recipient", own);
      if (own && (!op.proposal || !bytesEqual(op.proposal, serder.raw) || !op.requestedByPeer)) {
        throw new ValidationError("Own Unblind reply lacks its exact locally approved proposal");
      }
      if (!own && !op.query) throw new ValidationError("Reply has no outstanding Unblind query");
      this.current(op);
      const verified = this.replyOpenings(op, selected, nests, [
        ...attachments?.bsqs ?? [],
        ...attachments?.bsss ?? [],
      ]);
      for (const [said, opening] of verified) op.openings.set(said, opening);
      const minimum = this.minimum(op, nests, (event) => this.opening(op.openings, event));
      if (own) {
        if (!sameSelection(selected, minimum.selected)) {
          throw new ValidationError("Reply is not the minimum current suffix");
        }
      } else {
        if (
          Object.entries(minimum.selected).some(([regid, saids]) =>
            saids.some(said => !selected[regid]?.includes(said))
          )
        ) throw new ValidationError("Reply does not cover the required current suffix");
        for (const said of Object.values(selected).flat()) this.opening(op.openings, this.registry.store.event(said)!);
      }
      const decision = this.rvy.acceptReply({ serder, saider: diger, route, aid: op.sender, cigars, tsgs });
      if (decision.kind !== "accept") return decision;
      op.selected = selected;
      if (own) {
        this.groupMessage(
          op,
          "reply",
          serder,
          fetchStoredTsgs(this.hab.db, diger.qb64).filter(group => group.pre === this.hab.pre),
          minimum.openings.map(publicOpeningAttachment),
        );
        return decision;
      }
      op.received = true;
      return decision;
    } catch (error) {
      if (error instanceof ValidationError) return unverifiedReplyDecision(error.message);
      throw error;
    }
  }

  /** Authenticated reply readiness only: neither credential-state acceptance nor Admit. */
  complete(xid: string): boolean {
    const op = this.operation(xid);
    this.live(op);
    this.current(op);
    return this.group && this.hab.pre === op.sender ? op.reply !== null : op.received;
  }

  /**
   * Return the verified openings an authenticated reply selected.
   *
   * KERIpy `Unblind.openings` (kentbull/keripy#156): a read-only accessor for a
   * group member forwarding the completed reply, with its proofs, to the other
   * members. It requires the same readiness as `complete` (local approval, live
   * original Grant, an authenticated reply or frozen own group reply). Each
   * opening was checked against its accepted event and the approved disclosure
   * when the reply arrived. It is not a credential-state verdict and authorizes
   * neither Admit nor retention; `finish` owns that.
   *
   * @returns registry event SAID to opening, in the reply's selected order; a copy.
   */
  openings(xid: string): Map<string, RegistryDisclosure> {
    if (!this.complete(xid)) throw new ValidationError("unblind reply has not been authenticated and verified");
    const op = this.operation(xid);
    const openings = new Map<string, RegistryDisclosure>();
    for (const said of Object.values(op.selected ?? {}).flat()) {
      const opening = op.openings.get(said);
      if (!opening) throw new ValidationError("unblind reply has not been authenticated and verified");
      openings.set(said, opening);
    }
    return openings;
  }

  /** Retry this exact Grant, or atomically update only its live accepted proof view. */
  *finish(xid: string): Operation<ExchangeDecision> {
    const op = this.operation(xid), { nests } = this.live(op), db = this.hab.db;
    this.current(op);
    if (this.hab.pre === op.sender) {
      if (!op.requestedByPeer || !op.reply) throw new ValidationError("Responder requires its completed signed reply");
      const frame = parsed(op.reply);
      this.attachments(frame, "reply");
      const { selected } = this.preflight(frame.serder, "a", "sender", true);
      const proof = verifyExchangeProofs(db, frame.serder, { tsgs: frame.tsgs, cigars: frame.cigars });
      if (
        proof.invalid || proof.missing.length || !(proof.tsgs.some((group) => group.pre === op.sender)
          || proof.cigars.some((cigar) => cigar.verfer?.qb64 === op.sender))
      ) {
        throw new ValidationError("Responder reply lacks its full signature threshold");
      }
      const openings = this.replyOpenings(op, selected, nests, [...frame.bsqs, ...frame.bsss]);
      if (!op.selected || !sameSelection(op.selected, selected)) {
        const minimum = this.minimum(op, nests, (event) => this.opening(openings, event));
        if (!sameSelection(selected, minimum.selected)) {
          throw new ValidationError("Reply is not the minimum current suffix");
        }
      }
      op.selected = selected;
      op.openings = openings;
    } else if (!op.received) throw new ValidationError("Unblind reply has not been authenticated and verified");
    const accepted = this.exc.complete(op.grant), snapshot = db.enst.get([op.grant]);
    for (const nest of nests) {
      const evidence = envelopeFromFrame(nest),
        present = new Set([...evidence.bsqs, ...evidence.bsss].map((v) => v.d.nonce));
      for (const said of Object.values(op.selected!).flat()) {
        const event = this.registry.store.event(said)!, opening = this.opening(op.openings, event);
        if (
          event.sad!.rd === nest.body.ked?.rd && (!opening.td.nonce || opening.td.nonce === nest.body.said)
          && !present.has(opening.d.nonce)
        ) {
          nest.attachments.push(parseAttachmentGroup(publicOpeningAttachment(opening), Vrsn_2_0, "txt").group);
          present.add(opening.d.nonce);
        }
      }
    }
    if (!accepted) {
      const input = this.exc.retainedInput(op.grant, { pending: true });
      if (!input) throw new ValidationError("Selected pending Grant is no longer live");
      return yield* this.exc.acceptPendingGrantProof({ ...input, nests });
    }
    // Serialization may suspend; repeat all authority and snapshot checks inside
    // the single writer. This does not rewrite another Grant or any Admit.
    const wires = yield* abortable((signal) => prepareNests(nests, signal));
    const result = db.transaction((): ExchangeDecision => {
      this.live(op);
      this.current(op);
      const retained = db.enst.get([op.grant]);
      if (retained.length !== snapshot.length || retained.some((raw, index) => raw !== snapshot[index])) {
        throw new ValidationError("Approved presentation evidence changed");
      }
      const verified = this.exc.verifyGrantProofs(op.grant, nests);
      if (typeof verified !== "object" || verified.kind !== "accept") {
        return { kind: "reject", said: op.grant, reason: "Updated presentation proofs did not verify" };
      }
      publishNests(db, op.grant, wires);
      for (const [node, record] of verified.registryStates) db.exrs.pin([op.grant, node], record);
      return { kind: "accept", said: op.grant };
    });
    yield* db.flushed();
    return result;
  }

  /** Discard approved work and unsent replies; delivered bytes remain caller-owned. */
  abandon(xid: string): void {
    this.forget(xid);
    this.hab.db.heldu.rem([this.hab.pre!, xid]);
  }

  /** Drop an operation's process-local approval, messages and openings; a persisted request stays. */
  private forget(xid: string): void {
    const op = this.operation(xid);
    const keep = [...this.outgoing].filter(item =>
      ![op.query, op.reply, op.contribution]
        .some(wire => wire && bytesEqual(item.msg, wire))
    );
    this.outgoing.clear();
    this.outgoing.extend(keep);
    op.query = null;
    op.reply = null;
    op.proposal = null;
    op.contribution = null;
    op.openings.clear();
    op.abandoned = true;
  }

  /** Select the exact missing public suffix without signing or changing registry state. */
  private request(op: UnblindOperation): { requested: Selection; children: Uint8Array[] } {
    const nests = this.live(op).nests, carried = this.carried(op, nests);
    const requested: Selection = {}, children: Uint8Array[] = [];
    for (const regid of op.scope.keys()) {
      const events = this.events(regid);
      let missing = false, start = 0;
      for (let index = events.length - 1; index >= 0; index--) {
        const opening = carried.get(events[index].said!);
        if (!opening) missing = true;
        else if (this.checkOpening(op, events[index], opening, nests)) {
          start = index + 1;
          break;
        }
      }
      if (!missing) continue;
      requested[regid] = [];
      for (const event of events.slice(start)) {
        const anchor = this.registry.store.anchor(event.said!);
        if (!anchor) throw new ValidationError("Requested event lacks accepted source evidence");
        requested[regid].push(event.said!);
        children.push(messagize(
          event,
          Counter.enclose({
            code: "SealSourceCouples",
            version: Vrsn_2_0,
            qb64: SealSource.qb64b({ s: NumberPrimitive.fromNum(anchor[0].num), d: anchor[1] }),
          }),
          { nested: true, gvrsn: Vrsn_2_0 },
        ));
      }
    }
    if (!Object.keys(requested).length) throw new ValidationError("Grant already carries the current openings");
    return { requested, children };
  }

  /**
   * Whether this local habitat is the party of Unblind transaction `xid` with `sender`.
   *
   * Messages carry no recipient, so a per-identifier registry selects the owner by transaction:
   * an approved operation here, a stored Grant from this habitat addressed to `sender`, or, for a
   * group, its own members' contributions, which KRAM must pool before this owner consents.
   */
  inTransaction(sender: string, xid: string): boolean {
    return this.operations.has(xid) || (this.group && sender === this.hab.pre)
      || Unblind.recipients(this.hab.db, this.hab.pre!, xid).includes(sender);
  }

  /** Recipients of the Grants `pre` sent in transaction `xid`, from KRAM-accepted store rows. */
  static recipients(db: Baser, pre: string, xid: string): string[] {
    const recipients: string[] = [];
    for (const [key] of db.tmsc.getTopItemIter([pre, xid])) {
      const grant = db.exns.get([key[2]]) ?? db.epse.get([key[2]]);
      if (grant?.pre === pre && typeof grant.sad?.ri === "string") recipients.push(grant.sad.ri);
    }
    return recipients;
  }

  /** Release all process-local approvals, opening references and retry bytes without changing stores. */
  close(): void {
    for (const xid of this.operations.keys()) this.forget(xid);
    this.operations.clear();
    this.outgoing.clear();
  }

  /** The one live Grant this identifier sent to `recipient` in exchange `xid`, from KRAM-accepted store rows. */
  private sentGrant(recipient: string, xid: string): string {
    const said = [...this.hab.db.tmsc.getTopItemIter([this.hab.pre, xid])]
      .map(([key]) => this.hab.db.exns.get([key[2]]) ?? this.hab.db.epse.get([key[2]]))
      .filter((grant) =>
        grant && grant.pre === this.hab.pre && grant.sad!.ri === recipient
        && this.exc.presentationContext(grant.said!, { xid, sender: this.hab.pre!, recipient })
      );
    if (said.length !== 1) throw new ValidationError("Unblind query has no unique live Grant sent by this identifier");
    return said[0]!.said!;
  }

  /**
   * Individual discloser operations whose authenticated peer query is waiting for a delivered reply.
   * Hosts adopt these to deliver the reply; a group discloser's replies need member contributions instead.
   */
  awaitingReply(): { xid: string; grant: string }[] {
    this.restoreHeld();
    this.retryWaiting();
    if (this.group) return [];
    return [...this.operations.values()]
      .filter((op) => op.sender === this.hab.pre && (op.requestedByPeer || this.waiting.has(op.xid)) && !op.abandoned)
      .map(({ xid, grant }) => ({ xid, grant }));
  }

  private operation(xid: string): UnblindOperation {
    const op = this.operations.get(xid);
    if (!op) throw new ValidationError("Unblind transaction has no local approval");
    return op;
  }

  private live(op: UnblindOperation) {
    const context = this.exc.presentationContext(op.grant, op);
    if (op.abandoned || !context || !bytesEqual(context.serder.raw, op.raw)) {
      throw new ValidationError("Presentation is unavailable, terminated or expired");
    }
    if (
      context.nests.length !== op.bodies.length
      || context.nests.some((nest, i) => !bytesEqual(nest.body.raw, op.bodies[i]))
      || context.registries.size !== op.scope.size || [...op.scope].some(([regid, nodes]) => {
        const selected = context.registries.get(regid);
        return !selected || selected.length !== nodes.length || nodes.some((node, i) => selected[i] !== node);
      })
    ) throw new ValidationError("Presentation differs from the approved Grant");
    return context;
  }

  private current(op: UnblindOperation): void {
    for (const [regid, saids] of Object.entries(op.requested ?? {})) {
      if (this.registry.store.headEvent(regid)?.said !== saids.at(-1)) {
        throw new ValidationError("Registry head changed after the Unblind request");
      }
    }
  }

  /** Decode the exact query/reply body before applying consent and event scope. */
  private parameters(serder: SerderKERI, field: "q" | "a"): { x: string; re: Record<string, unknown> } {
    const data = serder.sad?.[field];
    if (
      !serder.verify() || serder.pvrsn.major !== 2 || serder.pvrsn.minor !== 0 || serder.route !== Unblind.Route
      || !data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).sort().join() !== "re,x"
      || !("x" in data) || typeof data.x !== "string" || !("re" in data) || !data.re
      || typeof data.re !== "object" || Array.isArray(data.re)
    ) throw new ValidationError("Invalid Unblind message shape");
    return data as { x: string; re: Record<string, unknown> };
  }

  /** Keep selected event identities distinct and inside the authenticated Grant's registry scope. */
  private selection(re: Record<string, unknown>, scope: PresentationScope, field: "q" | "a"): Selection {
    const selected: Selection = {};
    for (const [regid, values] of Object.entries(re)) {
      if (
        !scope.has(regid) || !Array.isArray(values) || !values.length
        || values.some((value) => typeof value !== "string" || !value) || new Set(values).size !== values.length
      ) {
        throw new ValidationError("Unblind events must be distinct lists within the approved scope");
      }
      selected[regid] = [...values];
    }
    if (field === "q" && !Object.keys(selected).length) throw new ValidationError("Unblind query scope is empty");
    return selected;
  }

  private preflight(serder: SerderKERI, field: "q" | "a", role: "sender" | "recipient", own = false) {
    const data = this.parameters(serder, field);
    const op = this.operation(data.x), { nests } = this.live(op);
    if (this.hab.pre !== op[role] || serder.pre !== op[own ? role : role === "sender" ? "recipient" : "sender"]) {
      throw new ValidationError("Wrong Unblind sender or local recipient");
    }
    const selected = this.selection(data.re, op.scope, field);
    return { op, selected, nests };
  }

  /** Encode the endorsed finite body and explicit counted evidence in one attachment enclosure. */
  private signed(message: SerderKERI, extra: readonly Uint8Array[], groups?: readonly TransIdxSigGroup[]): Uint8Array {
    const auth = parsed(
      groups
        ? messagize(message, { tsgs: groups, gvrsn: Vrsn_2_0 })
        : this.hab.endorse(message, { gvrsn: Vrsn_2_0 }),
    );
    const attachments = concatBytes(...auth.attachmentGroups.map((group) => group.raw), ...extra);
    return concatBytes(
      Counter.makeGVC(Vrsn_2_0),
      message.raw,
      Counter.enclose({ code: "AttachmentGroup", qb64: attachments, version: Vrsn_2_0 }),
    );
  }

  /** Reconstruct only allowed finite public event children; credentials never pass this encoder. */
  private publicEvents(nests: readonly CesrFrame[]): Uint8Array[] {
    return nests.map(nest => {
      if (!(nest.body instanceof SerderACDC) || nest.body.ilk !== "bup") {
        throw new ValidationError("Unblind query must carry public BUP evidence");
      }
      this.attachments(envelopeFromFrame(nest), "event");
      return messagize(nest.body, concatBytes(...nest.attachments.map(group => group.raw)), {
        nested: true,
        gvrsn: Vrsn_2_0,
      });
    });
  }

  /** Local group signatures cover exactly the suffix selected from this member's accepted state. */
  private queryEvidence(op: UnblindOperation, selected: Selection, nests: readonly CesrFrame[]): Uint8Array[] {
    const expected = this.request(op), supplied = this.publicEvents(nests);
    if (
      !sameSelection(selected, expected.requested) || supplied.length !== expected.children.length
      || supplied.some((wire, index) => !bytesEqual(wire, expected.children[index]))
    ) {
      throw new ValidationError("Group query differs from the selected public events and sources");
    }
    return supplied;
  }

  /** Freeze a complete aggregate, then elect delivery from its own historical signing indices. */
  private groupMessage(
    op: UnblindOperation,
    field: "query" | "reply",
    message: SerderKERI,
    groups: readonly TransIdxSigGroup[],
    extra: readonly Uint8Array[],
  ): void {
    if (field === "query" && op.query) return;
    if (!op[field]) {
      const verified = verifyExchangeProofs(this.hab.db, message, {
        tsgs: groups.filter(group => group.pre === this.hab.pre),
      });
      if (!verified.tsgs.length || verified.invalid || verified.missing.length) {
        throw new ValidationError("Own Unblind message lacks a verified group signature threshold");
      }
      op[field] = this.signed(message, extra, verified.tsgs);
    }
    // Later contributions cannot change which member is elected by these frozen bytes.
    const proof = parsed(op[field]!).tsgs[0];
    const establishment = this.hab.db.getEvtSerder(proof.pre, proof.said);
    if (!establishment?.estive) throw new ValidationError("Group aggregate establishment is unavailable");
    const member = localGroupMember(this.exc.hby, this.hab.pre!);
    const contribution = latestGroupContribution(this.hab.db, member.pre!, establishment.verfers);
    if (contribution?.index === Math.min(...proof.sigers.map(siger => siger.index))) {
      this.outgoing.push({ kin: field, dest: field === "query" ? op.sender : op.recipient, msg: op[field]!.slice() });
    }
  }

  /** Reject foreign evidence families, including unknown raw attachment groups. */
  private attachments(envelope: KeriDispatchEnvelope, kind: "query" | "reply" | "event"): void {
    const common = [
      envelope.wigers,
      envelope.trqs,
      envelope.frcs,
      envelope.tdcs,
      envelope.ptds,
      envelope.tmqs,
      envelope.essrs ?? [],
      envelope.unresolvedLast,
    ];
    const forbidden = kind === "event"
      ? [
        ...common,
        envelope.sigers,
        envelope.cigars,
        envelope.tsgs,
        envelope.ssgs,
        envelope.nests,
        envelope.bsqs,
        envelope.bsss,
      ]
      : [
        ...common,
        envelope.sscs,
        envelope.ssts,
        ...(kind === "query" ? [envelope.bsqs, envelope.bsss] : [envelope.nests, envelope.ssgs]),
      ];
    const allowed = kind === "event"
      ? ["SealSourceCouples", "SealSourceTriples"]
      : [
        "ControllerIdxSigs",
        "NonTransReceiptCouples",
        "TransIdxSigGroups",
        ...(kind === "query" ? ["TransLastIdxSigGroups"] : ["BlindedStateQuadruples", "BoundStateSextuples"]),
      ];
    if (
      forbidden.some((values) => values.length)
      || envelope.attachmentGroups.some((group) => !allowed.includes(group.name.replace(/^Big/, "")))
    ) throw new ValidationError("Unsupported Unblind attachments");
  }

  private events(regid: string): SerderACDC[] {
    const head = this.registry.store.headEvent(regid);
    if (!head || head.ilk !== "bup") throw new ValidationError("Accepted registry updates are unavailable");
    const events: SerderACDC[] = [];
    for (let sn = 1; sn <= ordinal(head); sn++) {
      const event = this.registry.store.seqEvent(regid, sn);
      if (!event) throw new ValidationError("Accepted registry chain is incomplete");
      events.push(event);
    }
    return events;
  }

  /** Vet every supplied suffix before any ordinary TEL intake changes the accepted prefix. */
  private validateEvents(requested: Selection, nests: readonly CesrFrame[]): void {
    const saids = Object.values(requested).flat();
    if (nests.length !== saids.length || nests.some((nest, i) => nest.body.said !== saids[i])) {
      throw new ValidationError("Nested events differ from the exact Unblind request");
    }
    let offset = 0;
    for (const [regid, selected] of Object.entries(requested)) {
      const rip = this.registry.store.seqEvent(regid, 0), head = this.registry.store.headEvent(regid);
      if (!rip || !head) throw new ValidationError("Query registry has no accepted inception");
      const children = nests.slice(offset, offset + selected.length);
      offset += selected.length;
      if (!(children[0].body instanceof SerderACDC)) throw new ValidationError("Expected public BUP evidence");
      if (validateUpdate(children[0].body, regid).kind !== "valid") {
        throw new ValidationError("Query must carry public BUP evidence");
      }
      const first = ordinal(children[0].body), prefix: SerderACDC[] = [];
      if (first < 1 || first > ordinal(head) + 1) throw new ValidationError("Query has no accepted preceding prefix");
      for (let sn = 1; sn < first; sn++) {
        const event = this.registry.store.seqEvent(regid, sn);
        if (!event) throw new ValidationError("Query has no accepted preceding prefix");
        prefix.push(event);
      }
      for (let i = 0; i < children.length; i++) {
        const frame = children[i], event = frame.body;
        if (!(event instanceof SerderACDC)) throw new ValidationError("Expected public BUP evidence");
        const checked = validateUpdate(event, regid), envelope = envelopeFromFrame(frame);
        this.attachments(envelope, "event");
        if (checked.kind !== "valid" || ordinal(event) !== first + i) {
          throw new ValidationError("Query BUP suffix is not contiguous");
        }
        const sources = [
          ...envelope.sscs.map((seal) => ({ issuer: rip.issuer!, number: seal.s, diger: seal.d })),
          ...envelope.ssts.map((seal) => ({ issuer: seal.i.qb64, number: seal.s, diger: seal.d })),
        ];
        for (const source of sources) {
          if (source.issuer !== rip.issuer) throw new ValidationError("Query event has an unverified source");
          if (verifyRegistryAnchor(checked.event, { db: this.hab.db, ...source })) continue;
          const sn = Number(source.number.num);
          // An anchoring event the issuer's KEL here has not reached is early; one that is known and does not seal is wrong.
          if (Number.isSafeInteger(sn) && this.hab.db.kels.getLast(source.issuer, sn) === null) {
            throw new SourceNotYetKnown(source.issuer, sn);
          }
          throw new ValidationError("Query event has an unverified source");
        }
        const accepted = this.registry.store.seqEvent(regid, first + i);
        if (accepted && !bytesEqual(accepted.raw, event.raw)) {
          throw new ValidationError("Query conflicts with accepted history");
        }
        prefix.push(event);
      }
      if (
        vet({ rip, updates: prefix, db: this.hab.db }).kind !== "verified"
        || ordinal(head) > first + selected.length - 1
      ) throw new ValidationError("Query has unverified or superseded history");
    }
  }

  private receiveEvents(requested: Selection, nests: readonly CesrFrame[]): void {
    this.validateEvents(requested, nests);
    for (const frame of nests) {
      const envelope = envelopeFromFrame(frame);
      const decision = this.registry.processEvent(frame.body as SerderACDC, {
        sscs: envelope.sscs,
        ssts: envelope.ssts,
      });
      if (decision.kind !== "accept" && decision.kind !== "duplicate") {
        throw new ValidationError("Public BUP has not reached acceptance");
      }
    }
  }

  private checkOpening(
    op: UnblindOperation,
    event: SerderACDC,
    opening: RegistryDisclosure,
    nests: readonly CesrFrame[],
  ): boolean {
    if (!vetBlind(opening, String(event.sad!.b))) {
      throw new ValidationError("Opening does not match the exact event BLID");
    }
    const target = opening.td.nonce, binding = !!(target || opening.ts.text);
    if (binding && !op.scope.get(String(event.sad!.rd))?.includes(target)) {
      throw new ValidationError("Opening targets an unrelated credential");
    }
    const credential = nests.find((nest) => nest.body.said === target)?.body;
    if (vetBound(opening, credential instanceof SerderACDC ? credential : undefined, this.hab.db)) {
      throw new ValidationError("Bound opening lacks its exact accepted Issuee event");
    }
    return binding;
  }

  private carried(op: UnblindOperation, nests: readonly CesrFrame[]): Map<string, RegistryDisclosure> {
    const carried = new Map<string, RegistryDisclosure>();
    for (const nest of nests) {
      const regid = nest.body.ked?.rd;
      if (typeof regid !== "string" || !op.scope.has(regid)) continue;
      const envelope = envelopeFromFrame(nest);
      for (const opening of [...envelope.bsqs, ...envelope.bsss]) {
        for (const event of this.events(regid)) {
          if (opening.d.nonce === event.sad!.b) {
            this.checkOpening(op, event, opening, nests);
            carried.set(event.said!, opening);
          }
        }
      }
    }
    return carried;
  }

  private held(op: UnblindOperation, event: SerderACDC, nests: readonly CesrFrame[]): RegistryDisclosure {
    let opening = this.registry.store.publicOpening(event.said!);
    if (!opening) {
      for (const nest of nests) {
        const envelope = envelopeFromFrame(nest);
        opening = [...envelope.bsqs, ...envelope.bsss].find((candidate) => candidate.d.nonce === event.sad!.b) ?? null;
        if (opening) break;
      }
    }
    if (!opening) {
      const root = this.hab.mgr.getRegistryRoot(this.hab.pre!, String(event.sad!.rd));
      if (root) {
        for (const target of op.scope.get(String(event.sad!.rd))!) {
          opening = unblindBlindState({
            said: String(event.sad!.b),
            uuid: makeBlindUuid({ salt: root.qb64, sn: BigInt(ordinal(event)) }),
            acdc: target,
            states: op.states,
          });
          if (opening) break;
        }
      }
    }
    if (!opening) {
      throw new ValidationError(
        "Required exact event opening is unavailable: this identifier holds no public or carried opening and cannot "
          + "derive one from its registry root (an update blinded with a random blinder, as `Registry.blind` does "
          + "without custody, can be opened only by its author or from an opening its author published)",
      );
    }
    this.checkOpening(op, event, opening, nests);
    return opening;
  }

  private minimum(
    op: UnblindOperation,
    nests: readonly CesrFrame[],
    resolve: (event: SerderACDC) => RegistryDisclosure,
  ) {
    const carried = this.carried(op, nests), selected: Selection = {}, openings = new Map<string, RegistryDisclosure>();
    for (const [regid, saids] of Object.entries(op.requested!)) {
      const suffix: string[] = [];
      let bound = false;
      for (const event of this.events(regid).reverse()) {
        let opening = carried.get(event.said!);
        if (!opening) {
          if (!saids.includes(event.said!)) {
            throw new ValidationError("Required older opening was neither carried nor requested");
          }
          opening = resolve(event);
          suffix.push(event.said!);
          openings.set(opening.d.nonce, opening);
        }
        if (this.checkOpening(op, event, opening, nests)) {
          bound = true;
          break;
        }
      }
      if (!bound) throw new ValidationError("Registry suffix contains no credential state");
      if (suffix.length) selected[regid] = suffix.reverse();
    }
    return { selected, openings: [...openings.values()] };
  }

  private opening(openings: Map<string, RegistryDisclosure>, event: SerderACDC): RegistryDisclosure {
    const opening = openings.get(event.said!);
    if (!opening) throw new ValidationError("Reply lacks a required opening");
    return opening;
  }

  private replyOpenings(
    op: UnblindOperation,
    selected: Selection,
    nests: readonly CesrFrame[],
    proofs: readonly RegistryDisclosure[],
  ) {
    if (
      !op.requested
      || Object.entries(selected).some(([regid, saids]) =>
        !op.requested![regid] || saids.some((said) => !op.requested![regid].includes(said))
      )
    ) {
      throw new ValidationError("Reply names an event outside the outstanding request");
    }
    const seen = new Set<string>(), verified = new Map<string, RegistryDisclosure>();
    for (const opening of proofs) {
      if (seen.has(opening.d.nonce)) throw new ValidationError("Duplicate Unblind opening");
      seen.add(opening.d.nonce);
      const events = Object.values(selected).flat().map((said) => this.registry.store.event(said)!);
      const matches = events.filter((event) => event.sad!.b === opening.d.nonce);
      if (!matches.length) throw new ValidationError("Reply carries an excess opening");
      for (const event of matches) {
        this.checkOpening(op, event, opening, nests);
        verified.set(event.said!, opening);
      }
    }
    return verified;
  }
}
