/**
 * Explicitly approved IPEX Unblind, following Python's local query/reply profile.
 * Only event openings cross this boundary. Roots, application state vocabulary,
 * transport and final Admit remain with their existing owners.
 */
import {
  bytesEqual,
  type CesrFrame,
  type Cigar,
  concatBytes,
  Counter,
  type Diger,
  Kinds,
  makeBlindUuid,
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
import { isLocalGroupHab } from "../app/multisig/group-members.ts";
import {
  type AuxiliaryQueryProcessor,
  envelopeFromFrame,
  type MessageDropDecision,
} from "../app/protocol/parsering.ts";
import { abortable } from "../app/runtime/abortable.ts";
import { Deck } from "../core/deck.ts";
import type { KeriDispatchEnvelope, TransIdxSigGroup } from "../core/dispatch.ts";
import { ValidationError } from "../core/errors.ts";
import { verifyExchangeProofs, verifyQueryAttachments } from "../core/exchange/exchange-proofing.ts";
import { query, reply } from "../core/protocol-eventing.ts";
import { messagize } from "../core/protocol-serialization.ts";
import { type ReplyProcessDecision, unverifiedReplyDecision } from "../core/routing.ts";
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
  requestedByPeer: boolean;
  received: boolean;
  abandoned: boolean;
}

/** Caller-owned delivery of a fully signed reply; approval and bytes are process-local. */
export interface UnblindOutgoing {
  kin: "reply";
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
 * One individual presentation's explicit proof-release consent. Inject as qvy
 * and register Route on the habitat's existing Revery Router. Wire intake cannot
 * approve work; a fresh owner cannot resume an unfinished operation. Group query
 * and reply contribution requires a separate implementation and refuses here.
 */
export class Unblind implements AuxiliaryQueryProcessor {
  static readonly Route = "/ipex/unblind";
  readonly outgoing = new Deck<UnblindOutgoing>();
  private readonly operations = new Map<string, UnblindOperation>();
  readonly hab: Hab;
  readonly exc: Exchanger;
  readonly registry: RegistryObserver;
  readonly states: readonly string[];

  /** Bind the exact Grant verifier's store and an explicit ordinary-state vocabulary. */
  constructor({ hab, exc, registry, states }: {
    hab: Hab;
    exc: Exchanger;
    registry: RegistryObserver;
    states: readonly string[];
  }) {
    if (
      !(hab instanceof Hab) || hab.db !== exc.hby.db || registry.db !== hab.db
      || exc.hby.habs.get(hab.pre!) !== hab || isLocalGroupHab(exc.hby, hab)
    ) {
      throw new ValidationError("Unblind requires a local individual signing habitat");
    }
    if (!Array.isArray(states) || states.some((state) => typeof state !== "string")) {
      throw new ValidationError("Unblind requires an explicit sequence of state strings");
    }
    this.hab = hab;
    this.exc = exc;
    this.registry = registry;
    this.states = [...states];
  }

  /** Freeze one authenticated live Grant's exact bodies, parties and authorized registry scope. */
  approve(grant: string): string {
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
      this.live(existing);
      return xid;
    }
    const context = this.exc.presentationContext(grant, { xid, sender, recipient });
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
      requestedByPeer: false,
      received: false,
      abandoned: false,
    });
    return xid;
  }

  /** Freeze a signed disclosee query over the missing accepted public suffix. */
  start(grant: string): Uint8Array {
    const op = this.operation(this.approve(grant));
    if (this.hab.pre !== op.recipient) throw new ValidationError("Only the disclosee starts Unblind");
    if (!op.query) {
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
              qb64: SealSource.qb64b({ s: anchor[0], d: anchor[1] }),
            }),
            { nested: true, gvrsn: Vrsn_2_0 },
          ));
        }
      }
      if (!Object.keys(requested).length) throw new ValidationError("Grant already carries the current openings");
      const message = query(Unblind.Route, { x: op.xid, re: requested }, {
        pre: this.hab.pre,
        replyRoute: Unblind.Route,
        pvrsn: Vrsn_2_0,
        kind: Kinds.json,
      });
      op.query = this.signed(message, children);
      op.requested = requested;
    }
    this.current(op);
    return op.query.slice();
  }

  /** Authenticate the full peer threshold before public evidence intake or proof release. */
  processQuery(envelope: KeriDispatchEnvelope): { kind: "accept" } | MessageDropDecision {
    try {
      const { serder } = envelope;
      if (serder.ilk !== "qry" || serder.sad!.rr !== Unblind.Route) throw new ValidationError("Invalid Unblind query");
      this.attachments(envelope, "query");
      const { op, selected } = this.preflight(serder, "q", "sender");
      if (!verifyQueryAttachments(this.hab.db, envelope)) return { kind: "drop", reason: "missingAuthentication" };
      if (op.requested && !sameSelection(op.requested, selected)) {
        throw new ValidationError("Conflicting Unblind request");
      }
      this.receiveEvents(selected, envelope.nests);
      this.live(op);
      op.requested = selected;
      op.requestedByPeer = true;
      this.respond(op.xid);
      return { kind: "accept" };
    } catch (error) {
      if (error instanceof ValidationError) return { kind: "drop", reason: "invalidQuery" };
      throw error;
    }
  }

  /** Retry a previously authenticated request locally when held proofs become available. */
  respond(xid: string): Uint8Array {
    const op = this.operation(xid), { nests } = this.live(op);
    if (this.hab.pre !== op.sender || !op.requestedByPeer) throw new ValidationError("No authenticated peer request");
    this.current(op);
    if (!op.reply) {
      const { selected, openings } = this.minimum(op, nests, (event) => this.held(op, event, nests));
      const message = reply(Unblind.Route, { x: op.xid, re: selected }, {
        pre: this.hab.pre!,
        pvrsn: Vrsn_2_0,
        kind: Kinds.json,
      });
      op.reply = this.signed(message, openings.map(publicOpeningAttachment));
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
      const { op, selected, nests } = this.preflight(serder, "a", "recipient");
      if (!op.query) throw new ValidationError("Reply has no outstanding Unblind query");
      this.current(op);
      const verified = this.replyOpenings(op, selected, nests, [
        ...attachments?.bsqs ?? [],
        ...attachments?.bsss ?? [],
      ]);
      for (const [said, opening] of verified) op.openings.set(said, opening);
      const decision = this.hab.rvy.acceptReply({ serder, saider: diger, route, aid: op.sender, cigars, tsgs });
      if (decision.kind !== "accept") return decision;
      const minimum = this.minimum(op, nests, (event) => this.opening(op.openings, event));
      if (!sameSelection(selected, minimum.selected)) {
        throw new ValidationError("Reply is not the minimum current suffix");
      }
      op.selected = selected;
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
    return op.received;
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
      return yield* this.exc.processEvent({ ...input, nests });
    }
    // Serialization may suspend; repeat all authority and snapshot checks inside
    // the single writer. This does not rewrite another Grant or any Admit.
    const wires = yield* abortable((signal) => prepareNests(nests, signal));
    const result = db.env!.transactionSync((): ExchangeDecision => {
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
    yield* abortable(async () => {
      await db.env!.flushed;
    });
    return result;
  }

  /** Discard approved work and unsent replies; delivered bytes remain caller-owned. */
  abandon(xid: string): void {
    const op = this.operation(xid);
    const keep = [...this.outgoing].filter((item) => !op.reply || !bytesEqual(item.msg, op.reply));
    this.outgoing.clear();
    this.outgoing.extend(keep);
    op.query = op.reply = null;
    op.openings.clear();
    op.abandoned = true;
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

  private preflight(serder: SerderKERI, field: "q" | "a", role: "sender" | "recipient", own = false) {
    const data = serder.sad?.[field];
    if (
      !serder.verify() || serder.pvrsn.major !== 2 || serder.pvrsn.minor !== 0 || serder.route !== Unblind.Route
      || !data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).sort().join() !== "re,x"
      || !("x" in data) || typeof data.x !== "string" || !("re" in data) || !data.re
      || typeof data.re !== "object" || Array.isArray(data.re)
    ) throw new ValidationError("Invalid Unblind message shape");
    const op = this.operation(data.x), { nests } = this.live(op);
    if (this.hab.pre !== op[role] || serder.pre !== op[own ? role : role === "sender" ? "recipient" : "sender"]) {
      throw new ValidationError("Wrong Unblind sender or local recipient");
    }
    const selected: Selection = {};
    for (const [regid, values] of Object.entries(data.re)) {
      if (
        !op.scope.has(regid) || !Array.isArray(values) || !values.length
        || values.some((value) => typeof value !== "string" || !value) || new Set(values).size !== values.length
      ) {
        throw new ValidationError("Unblind events must be distinct lists within the approved scope");
      }
      selected[regid] = [...values];
    }
    if (field === "q" && !Object.keys(selected).length) throw new ValidationError("Unblind query scope is empty");
    return { op, selected, nests };
  }

  /** Encode the endorsed finite body and explicit counted evidence in one attachment enclosure. */
  private signed(message: SerderKERI, extra: readonly Uint8Array[]): Uint8Array {
    const auth = parsed(this.hab.endorse(message, { gvrsn: Vrsn_2_0 }));
    const attachments = concatBytes(...auth.attachmentGroups.map((group) => group.raw), ...extra);
    return concatBytes(
      Counter.makeGVC(Vrsn_2_0),
      message.raw,
      Counter.enclose({ code: "AttachmentGroup", qb64: attachments, version: Vrsn_2_0 }),
    );
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
  private receiveEvents(requested: Selection, nests: readonly CesrFrame[]): void {
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
          if (source.issuer !== rip.issuer || !verifyRegistryAnchor(checked.event, { db: this.hab.db, ...source })) {
            throw new ValidationError("Query event has an unverified source");
          }
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
            states: this.states,
          });
          if (opening) break;
        }
      }
    }
    if (!opening) throw new ValidationError("Required exact event opening is unavailable");
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
