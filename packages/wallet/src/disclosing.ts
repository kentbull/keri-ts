/** Finite ACDC v2 IPEX composition over exact wallet views and explicitly supplied private capability. */
import {
  bytesEqual,
  type CesrFrame,
  collectPayload,
  Compactor,
  concatBytes,
  Counter,
  Diger,
  framePayload,
  type MapperMap,
  nestedPayload,
  NumberPrimitive,
  parseBytes,
  Prefixer,
  SealSource,
  SerderACDC,
  SerderKERI,
  unblindBlindState,
  unblindBoundState,
  type Versionage,
  Vrsn_2_0,
} from "cesr-ts";
import { call, type Operation } from "effection";
import { publicOpeningAttachment } from "keri-ts/db";
import {
  acceptedEventReplayMessage,
  acceptedRegistryEvidence,
  type AcdcV2Registry,
  authenticateIpexNode,
  type ChainVerdict,
  envelopeFromFrame,
  evaluateChain,
  type Hab,
  ipexExnBody,
  type IpexV2BodyOptions,
  isLocalGroupHab,
  issuedNodeVerdict,
  Kever,
  latestGroupContribution,
  localGroupMember,
  matchesRegistrySeal,
  prepareIpexExn,
  type Receiptor,
  type RegistryDisclosure,
  timestampMicros,
  validateAcdcSchema,
  ValidationError,
  verifyExchangeProofs,
  vet,
  vetBinds,
  vetBlind,
  vetBound,
  walkIpexGraph,
  type WitnessAuthMap,
} from "keri-ts/runtime";
import type { RegistryCustody } from "./custody.ts";
import type { Wallet } from "./wallet.ts";

/** A prepared signed exchange and its supporting public KEL/TEL bytes; delivery and intake stay explicit. */
export interface PreparedDisclosure {
  exn: SerderKERI;
  wire: Uint8Array;
  support: Uint8Array;
}
/** Frozen unsigned Grant and its exact selected nodes; group approval and presentation anchoring remain explicit. */
export interface PreparedGrantBody {
  exn: SerderKERI;
  raw: Uint8Array;
  nests: Uint8Array;
}
/** Exact parties reviewed by the operator before adding independent issuer authentication. */
export interface GrantFileSelection {
  said: string;
  sender: string;
  recipient: string;
}
/** Valid individual factors may remain below their ordinary signing threshold. */
export interface InspectedGrantFile {
  frame: CesrFrame;
  completeSigners: string[];
  partialSigners: string[];
}
/** Compare every named authentication factor without treating serialization grouping as new consent. */
function grantFileFactors(frame: CesrFrame): Map<string, string> {
  const factors = envelopeFromFrame(frame), result = new Map<string, string>();
  for (const group of factors.tsgs) {
    for (const sig of group.sigers) result.set(`tsg:${group.pre}:${group.sn}:${group.said}:${sig.qb64}`, group.pre);
  }
  for (const cigar of factors.cigars) result.set(`cigar:${cigar.verfer!.qb64}:${cigar.qb64}`, cigar.verfer!.qb64);
  for (const seal of factors.ssts) result.set(`seal:${seal.i.qb64}:${seal.s.num}:${seal.d.qb64}`, seal.i.qb64);
  return result;
}
/** Fresh origin and explicit far-node proofs; preparation grants neither DH nor inventory consent. */
export interface IssuanceGrantOptions extends Omit<IpexV2BodyOptions, "prior"> {
  recipient: string;
  priorSaid?: string;
  artifacts?: readonly Uint8Array[];
}
/** Select an exact issued credential or a retained Grant, never the fullest cached credential. */
export interface DisclosureSelection {
  said?: string;
  fromGrant?: string;
  /** Exact transferred credential/proof bytes; explicit presenter authorization creates no inventory consent. */
  transferred?: Uint8Array;
  presenterAuthorized?: boolean;
  disclose?: readonly string[];
  refresh?: boolean;
  openings?: readonly RegistryDisclosure[];
  derive?: boolean;
  artifacts?: readonly Uint8Array[];
}
/** Reuse a matching accepted KEL seal, or author once and gather real witness receipts. */
export function* anchorExchange(
  wallet: Wallet,
  receiptor: Receiptor,
  hab: Hab,
  body: SerderKERI | SerderACDC,
  auths?: WitnessAuthMap,
): Operation<SealSource> {
  if (receiptor.hby !== wallet.hby) throw new ValidationError("Receipt owner must share this wallet's Habery.");
  let anchor: SerderKERI | null = null, event: SerderKERI | null = hab.kever!.serder;
  while (event) {
    if (
      event.seals.some((seal) =>
        body instanceof SerderACDC
          ? matchesRegistrySeal(seal, body)
          : seal && typeof seal === "object" && "d" in seal && seal.d === body.said
      )
    ) {
      anchor = event;
    }
    event = event.prior ? hab.db.getEvtSerder(hab.pre, event.prior) : null;
  }
  if (!anchor) {
    const data = body instanceof SerderACDC
      ? [{ i: body.regid ?? body.said!, s: body.sad!.n, d: body.said! }]
      : [{ d: body.said! }];
    if (hab.kever!.estOnly) hab.rotate({ data });
    else hab.interact({ data });
    anchor = hab.kever!.serder;
  }
  yield* receiptor.receipt(hab.pre, { sn: anchor.sn!, allowTcp: true, auths });
  if (!hab.db.fullyWitnessed(anchor)) throw new ValidationError("Source anchor remains pending witness receipts.");
  return { s: NumberPrimitive.fromNum(BigInt(anchor.sn!)), d: new Diger({ qb64: anchor.said! }) };
}

/** Encode one frozen body and its existing prepared nests; source proofs do not alter its SAID. */
export function exchangeWire(
  hab: Hab,
  exn: SerderKERI,
  nested: Uint8Array = new Uint8Array(),
  source?: SealSource,
  gvrsn: Versionage = Vrsn_2_0,
): Uint8Array {
  const proof = source
    ? Counter.enclose({ code: "SealSourceCouples", qb64: SealSource.qb64b(source), version: gvrsn })
    : concatBytes(
      ...parseBytes(hab.endorse(exn, { gvrsn, pipelined: false, genusify: true }))[0].attachments.map((g) => g.raw),
    );
  return concatBytes(
    Counter.makeGVC(gvrsn),
    exn.raw,
    Counter.enclose({ qb64: concatBytes(proof, nested), version: gvrsn }),
  );
}

/** Borrow concrete owners only. No constructor opens a store, starts a worker or loads registry secrets. */
export class WalletDiscloser {
  constructor(readonly wallet: Wallet, readonly receiptor: Receiptor, readonly custody?: RegistryCustody) {
    if (receiptor.hby !== wallet.hby) {
      throw new ValidationError("Disclosure receipt owner must share the wallet Habery.");
    }
    if (
      custody
      && (custody.options.hby !== wallet.hby || custody.options.registry !== wallet.registry
        || custody.options.db !== wallet.db)
    ) {
      throw new ValidationError("Disclosure custody must use this wallet's actual owners.");
    }
  }
  /** Resolve only a local individual signer; group approval composes this body in the group workflow. */
  private signer(sender: string, gvrsn: Versionage = Vrsn_2_0): Hab {
    if (gvrsn.major < 2) throw new ValidationError("ACDC v2 disclosure requires attachment genus 2 or later.");
    const hab = this.wallet.hby.habs.get(sender);
    if (!hab || isLocalGroupHab(this.wallet.hby, hab)) {
      throw new ValidationError("ACDC v2 disclosure requires a local individual signer.");
    }
    return hab;
  }
  /** Revalidate exact accepted prior bytes without treating notification or salt possession as acceptance. */
  private *prior(said?: string): Operation<SerderKERI | undefined> {
    if (!said) return undefined;
    const body = this.wallet.hby.db.exns.get(said);
    if (!body || !this.wallet.exc.complete(said) || !this.wallet.exc.verifyAccepted(said, body.route!)) {
      throw new ValidationError("Prior ACDC v2 IPEX exchange must be accepted and authenticated.");
    }
    yield* call(async () => {
      for await (const _ of this.wallet.exc.replay(said)) { /* authenticated retained outer proof */ }
    });
    return body;
  }
  /** Reduce only the selected attribute view using the existing commitment-preserving Compactor. */
  private partial(credential: SerderACDC, paths?: readonly string[]): SerderACDC {
    if (!paths?.length) return credential;
    if (!credential.sad!.a || typeof credential.sad!.a !== "object" || Array.isArray(credential.sad!.a)) {
      throw new ValidationError("Attribute disclosure requires an expanded selected attribute map.");
    }
    const block = new Compactor({
      mad: structuredClone(credential.sad!.a) as MapperMap,
      kind: credential.kind,
      verify: false,
    });
    block.compact([...paths], "a");
    const partial = new SerderACDC({
      sad: { ...credential.sad!, a: block.partials![paths.join("|")].mad },
      kind: credential.kind,
      makify: true,
    });
    if (partial.said !== credential.said) {
      throw new ValidationError("Disclosure changed the selected credential commitment.");
    }
    return partial;
  }
  /** Authenticate every selected node, then authorize only the shared complete-root expression. */
  private requireGraph(origin: string, raw: Uint8Array, pendingPresentation = false): void {
    const graph = walkIpexGraph(origin, parseBytes(raw), true);
    if (!graph) throw new ValidationError("Selected credential graph is incomplete.");
    const verdicts = new Map<string, ChainVerdict>();
    for (const [said, node] of graph.nodes) {
      if (pendingPresentation) {
        const schema = validateAcdcSchema(node.body, this.wallet.hby.db);
        if (schema.kind !== "valid") {
          throw new ValidationError(schema.kind === "missing" ? `Missing ACDC schema: ${schema.said}` : schema.reason);
        }
      }
      const envelope = envelopeFromFrame(node);
      const auth = authenticateIpexNode(node.body, envelope, this.wallet.hby.db, this.wallet.registry);
      let verdict = issuedNodeVerdict(auth);
      if (pendingPresentation && auth.kind === "reject" && node.body.regid) {
        // Ordinary node authentication deliberately rejects absent current openings.
        // File consent may wait for that specific evidence, never for a known invalid state.
        const chain = acceptedRegistryEvidence(this.wallet.registry, node.body.regid);
        const binding = chain && vetBinds({
          ...chain,
          db: this.wallet.hby.db,
          acdc: node.body,
          target: said,
          blinders: [...envelope.bsqs, ...envelope.bsss],
        });
        const historical = authenticateIpexNode(node.body, envelope, this.wallet.hby.db, this.wallet.registry, true);
        if (
          binding?.kind === "missing" && binding.reason === "disclosure"
          && historical.kind === "authenticated" && historical.registration?.state === "issued"
        ) {
          verdict = { kind: "unknown", retryable: true, reason: "Missing current registry opening.", schemas: [] };
        }
      }
      verdicts.set(said, verdict);
    }
    const current = evaluateChain(graph, verdicts, this.wallet.hby.db);
    if (current?.kind === "valid") return;
    if (pendingPresentation && current?.kind === "unknown" && current.retryable) {
      const historical = new Map<string, ChainVerdict>();
      for (const [said, node] of graph.nodes) {
        historical.set(
          said,
          issuedNodeVerdict(authenticateIpexNode(
            node.body,
            envelopeFromFrame(node),
            this.wallet.hby.db,
            this.wallet.registry,
            true,
          )),
        );
      }
      if (evaluateChain(graph, historical, this.wallet.hby.db)?.kind === "valid") return;
    }
    throw new ValidationError("Current authenticated graph truth is required before use.");
  }
  /** Recover a candidate using an explicitly possessed UUID; this neither derives a salt nor grants authority. */
  unblind(
    opening: RegistryDisclosure,
    credential: string,
    states: readonly string[],
    bounds: readonly (readonly [number | bigint, string])[] = [],
  ): RegistryDisclosure | null {
    if (!opening.u.nonce) throw new ValidationError("Unblinding requires an explicitly possessed disclosure UUID.");
    const options = { said: opening.d.nonce, uuid: opening.u.nonce, acdc: credential, states: [...states] };
    return "bn" in opening
      ? unblindBoundState({ ...options, bounds: [[opening.bn.num, opening.bd.nonce], ...bounds] })
      : unblindBlindState(options);
  }
  /** Attach exact accepted issuer openings from head through vacuous suffix to this credential's binding. */
  registryProof(
    credential: SerderACDC,
    registry: string,
    retained: readonly RegistryDisclosure[] = [],
    options: Pick<DisclosureSelection, "derive"> = {},
  ): Uint8Array {
    const chain = acceptedRegistryEvidence(this.wallet.registry, registry);
    if (!chain || chain.updates.some((update) => update.ilk !== "bup")) {
      throw new ValidationError("Accepted ACDC v2 registry history is required.");
    }
    if (options.derive && !this.custody) throw new ValidationError("Explicit derivation requires provisioned custody.");
    const proofs: Uint8Array[] = [];
    let binding: SerderACDC | null = null;
    for (const event of [...chain.updates].reverse()) {
      const blid = event.sad!.b as string;
      let opening = retained.find((proof) => proof.d.nonce === blid) ?? this.wallet.registry.publicOpening(event.said!);
      if (!opening && options.derive) {
        // Exact retained coordinates are required; missing local material is a refusal.
        opening = this.custody!.derivedOpening(event);
      }
      if (
        !opening || !vetBlind(opening, blid) || (opening.td.nonce && opening.td.nonce !== credential.said)
        || vetBound(opening, credential, this.wallet.hby.db)
      ) {
        throw new ValidationError("Current exact registry opening is unavailable or binds different evidence.");
      }
      proofs.push(publicOpeningAttachment(opening));
      if (opening.td.nonce) {
        binding = event;
        break;
      }
    }
    if (!binding) throw new ValidationError("Registry has no disclosed credential binding.");
    if (!credential.regid) {
      proofs.push(
        Counter.enclose({
          code: "SealSourceTriples",
          version: Vrsn_2_0,
          qb64: concatBytes(
            new Prefixer({ qb64: registry }).qb64b,
            NumberPrimitive.fromNum(BigInt(`0x${binding.sad!.n}`)).qb64b,
            new Diger({ qb64: binding.said! }).qb64b,
          ),
        }),
      );
    }
    return concatBytes(
      Counter.makeGVC(Vrsn_2_0),
      credential.raw,
      Counter.enclose({ qb64: concatBytes(...proofs), version: Vrsn_2_0 }),
    );
  }
  /** Select immutable admitted/transferred nests; proof refresh changes attachments only when explicitly requested. */
  private *selected(selection: DisclosureSelection, offer = false): Operation<Uint8Array> {
    if (
      [selection.said, selection.fromGrant, selection.transferred].filter(value => value !== undefined).length !== 1
    ) {
      throw new ValidationError("Select exactly one issued credential, retained Grant or transferred view.");
    }
    const retained = Boolean(selection.fromGrant || selection.transferred);
    if (selection.refresh && !retained) throw new ValidationError("Refresh requires a retained view.");
    if (retained && selection.artifacts) {
      throw new ValidationError("A retained Grant keeps its exact original artifacts.");
    }
    if (
      retained && !selection.refresh
      && (selection.derive || selection.openings?.length)
    ) {
      throw new ValidationError("New held-Grant proof requires explicit refresh.");
    }
    let held: { credential: SerderACDC; proof: Uint8Array; artifacts: Uint8Array[] } | null = selection.fromGrant
      ? yield* call(() =>
        this.wallet.heldCredential(selection.fromGrant!, { presenterAuthorized: selection.presenterAuthorized })
      )
      : null;
    if (selection.transferred) {
      if (selection.presenterAuthorized !== true) {
        throw new ValidationError("Transferred view requires explicit presenter authorization.");
      }
      const frames = parseBytes(concatBytes(Counter.makeGVC(Vrsn_2_0), selection.transferred.slice()));
      if (!frames.length || frames.some(frame => !(frame.body instanceof SerderACDC) || frame.nests?.length)) {
        throw new ValidationError("Transferred view must contain direct credential node frames.");
      }
      const streams = yield* call(() =>
        Promise.all(frames.map(frame => collectPayload(nestedPayload(frame, Vrsn_2_0))))
      );
      held = { credential: frames[0].body as SerderACDC, proof: streams[0], artifacts: streams.slice(1) };
    }
    const credential = this.partial(
      held?.credential ?? this.wallet.issuedCredential(selection.said!),
      selection.disclose,
    );
    const original = held ? parseBytes(concatBytes(Counter.makeGVC(Vrsn_2_0), held.proof))[0] : null;
    let origin: Uint8Array;
    if (offer) origin = concatBytes(credential.raw, Counter.enclose({ qb64: new Uint8Array() }));
    else if (held && !selection.refresh) {
      origin = concatBytes(
        credential.raw,
        Counter.enclose({ qb64: concatBytes(...original!.attachments.map((group) => group.raw)) }),
      );
    } else {
      const envelope = original ? envelopeFromFrame(original) : null;
      const candidates = [
        ...new Set(
          envelope?.ssts.filter((seal) => this.wallet.registry.seqEvent(seal.i.qb64, 0)).map((seal) => seal.i.qb64),
        ),
      ];
      const regid = credential.regid
        ?? (selection.said ? this.wallet.db.issued.get([selection.said])?.registry : undefined)
        ?? (candidates.length === 1 ? candidates[0] : undefined);
      if (!regid) throw new ValidationError("Selected issuer registry proof is unavailable.");
      origin = this.registryProof(credential, regid, [
        ...(envelope?.bsqs ?? []),
        ...(envelope?.bsss ?? []),
        ...(selection.openings ?? []),
      ], selection);
    }
    const artifacts = selection.artifacts ?? held?.artifacts ?? [];
    return concatBytes(
      Counter.makeGVC(Vrsn_2_0),
      origin,
      ...artifacts.map((raw) =>
        offer
          ? concatBytes(
            parseBytes(concatBytes(Counter.makeGVC(Vrsn_2_0), raw))[0].body.raw,
            Counter.enclose({ qb64: new Uint8Array() }),
          )
          : raw
      ),
    );
  }
  /** Create an application request; no credential-use approval is invented for negotiation. */
  *prepareApply(sender: string, options: IpexV2BodyOptions): Operation<PreparedDisclosure> {
    const hab = this.signer(sender, options.gvrsn ?? Vrsn_2_0), exn = ipexExnBody(sender, "/ipex/apply", [], options);
    return {
      exn,
      wire: exchangeWire(hab, exn, undefined, undefined, options.gvrsn ?? Vrsn_2_0),
      support: new Uint8Array(),
    };
  }
  /** Offer only the selected commitment/view without issuer proof attachments. */
  *prepareOffer(
    sender: string,
    selection: DisclosureSelection,
    options: IpexV2BodyOptions & { priorSaid?: string },
  ): Operation<PreparedDisclosure> {
    const hab = this.signer(sender, options.gvrsn ?? Vrsn_2_0), prior = yield* this.prior(options.priorSaid);
    const raw = yield* this.selected(selection, true);
    const [exn, nests] = yield* prepareIpexExn(sender, "/ipex/offer", raw, { ...options, prior });
    return {
      exn,
      wire: exchangeWire(hab, exn, nests, undefined, options.gvrsn ?? Vrsn_2_0),
      support: new Uint8Array(),
    };
  }
  /** Accept or decline the exact authenticated predecessor and its negotiated anchoring choice. */
  *prepareReply(
    sender: string,
    verb: "agree" | "spurn",
    priorSaid: string,
    message = "",
    recipient?: string,
    auths?: WitnessAuthMap,
  ): Operation<PreparedDisclosure> {
    const hab = this.signer(sender), prior = yield* this.prior(priorSaid);
    const exn = ipexExnBody(sender, `/ipex/${verb}`, [], { message, prior, recipient });
    const source = verb === "agree" && (exn.sad!.a as { ax?: boolean[] }).ax?.[0]
      ? yield* anchorExchange(this.wallet, this.receiptor, hab, exn, auths)
      : undefined;
    return { exn, wire: exchangeWire(hab, exn, undefined, source), support: source ? this.kel(hab) : new Uint8Array() };
  }
  /** Select and authorize once before freezing a Grant body, without signing or committing group approval. */
  *prepareGrantBody(
    sender: string,
    selection: DisclosureSelection,
    options: IpexV2BodyOptions & { priorSaid?: string },
  ): Operation<PreparedGrantBody> {
    return yield* this.grantBody(sender, selection, options, false);
  }
  /** Freeze an endorsement file from issued evidence, allowing only retryable current-opening absence. */
  *prepareGrantFileBody(
    sender: string,
    selection: DisclosureSelection,
    options: IpexV2BodyOptions & { priorSaid?: string },
  ): Operation<PreparedGrantBody> {
    return yield* this.grantBody(sender, selection, options, true);
  }
  /** Both public preparation profiles preserve the same selected view and body construction. */
  private *grantBody(
    sender: string,
    selection: DisclosureSelection,
    options: IpexV2BodyOptions & { priorSaid?: string },
    pendingPresentation: boolean,
  ): Operation<PreparedGrantBody> {
    const hab = this.wallet.hby.habs.get(sender);
    if (!hab?.kever || (options.gvrsn ?? Vrsn_2_0).major < 2) {
      throw new ValidationError("ACDC v2 Grant preparation requires an accepted local sender and attachment genus 2.");
    }
    if (selection.derive && this.custody?.options.hab !== hab) {
      throw new ValidationError("Derived disclosure requires the actual sender habitat's custody.");
    }
    const prior = yield* this.prior(options.priorSaid), raw = yield* this.selected(selection);
    this.requireGraph(parseBytes(raw)[0].body.said!, raw, pendingPresentation);
    const [exn, nests] = yield* prepareIpexExn(sender, "/ipex/grant", raw, { ...options, prior });
    return { exn, raw, nests };
  }
  /** Inspect one exact unanchored Grant without dropping invalid signatures or publishing any evidence. */
  inspectGrantFile(raw: Uint8Array, selection?: GrantFileSelection): InspectedGrantFile {
    const frames = parseBytes(raw), frame = frames[0], message = frame?.body;
    if (
      frames.length !== 1 || !(message instanceof SerderKERI) || !message.verify()
      || message.pvrsn.major !== 2 || message.pvrsn.minor !== 0 || !["xip", "exn"].includes(message.ilk ?? "")
      || message.route !== "/ipex/grant" || (message.sad!.a as { ax?: boolean[] }).ax?.[0]
      || frame.essrs?.length || !frame.nests?.length
      || frame.nests.some(node => !(node.body instanceof SerderACDC) || node.nests?.length || node.essrs?.length)
      || selection && (message.said !== selection.said || message.pre !== selection.sender
          || message.sad!.ri !== selection.recipient)
    ) {
      throw new ValidationError("Select one exact unanchored v2 Grant, its disclosed nodes and declared parties.");
    }
    const factors = envelopeFromFrame(frame);
    if (
      factors.attachmentGroups.some(group =>
        ![
          "TransIdxSigGroups",
          "NonTransReceiptCouples",
          "SealSourceTriples",
        ].includes(group.name.replace(/^Big/, ""))
      )
    ) {
      throw new ValidationError("Grant file permits only named authentication and exact nested evidence.");
    }
    const other = verifyExchangeProofs(this.wallet.hby.db, message, {
      cigars: factors.cigars,
      sourceSeals: factors.ssts,
    });
    if (other.invalid || other.missing.length) {
      throw new ValidationError("Invalid or unavailable Grant authentication.");
    }
    const complete = new Set([
      ...other.cigars.map(proof => proof.verfer!.qb64),
      ...other.sourceSeals.map(seal => seal.i.qb64),
    ]);
    const groups = new Map<string, { pre: string; event: SerderKERI; indices: Set<number> }>();
    for (const group of factors.tsgs) {
      const accepted = group.sn <= BigInt(Number.MAX_SAFE_INTEGER)
        ? this.wallet.hby.db.kels.getLast(group.pre, Number(group.sn))
        : null;
      const event = accepted ? this.wallet.hby.db.getEvtSerder(group.pre, accepted) : null;
      if (
        !group.prefixer.transferable || !event?.estive || !event.tholder || accepted !== group.said
        || !group.sigers.length
      ) {
        throw new ValidationError("Grant contribution requires an accepted establishment event.");
      }
      const verified = Kever.verifyIndexedSignatures(message.raw, group.sigers, event.verfers);
      if (new Set(verified.sigers.map(sig => sig.qb64)).size !== new Set(group.sigers.map(sig => sig.qb64)).size) {
        throw new ValidationError("Invalid supplied Grant signature.");
      }
      const key = `${group.pre}:${group.sn}:${group.said}`;
      const aggregate = groups.get(key) ?? { pre: group.pre, event, indices: new Set<number>() };
      for (const index of verified.indices) aggregate.indices.add(index);
      groups.set(key, aggregate);
    }
    const partial = new Set<string>();
    for (const { pre, event, indices } of groups.values()) {
      if (event.tholder!.satisfy([...indices])) complete.add(pre);
      else partial.add(pre);
    }
    return { frame, completeSigners: [...complete], partialSigners: [...partial] };
  }
  /** Add only this local registry issuer's consent; partial group authentication remains explicitly incomplete. */
  *endorseGrant(
    issuer: string,
    raw: Uint8Array,
    selection: GrantFileSelection & { contributions?: readonly Uint8Array[] },
  ): Operation<PreparedDisclosure & { endorsed: boolean }> {
    const hab = this.wallet.hby.habs.get(issuer), inspected = this.inspectGrantFile(raw, selection);
    const frame = inspected.frame, exn = frame.body as SerderKERI;
    if (!hab?.kever || !inspected.completeSigners.includes(exn.pre!)) {
      throw new ValidationError(
        "Issuer endorsement requires a local signer and complete original sender authentication.",
      );
    }
    if (
      isLocalGroupHab(this.wallet.hby, hab)
      && !latestGroupContribution(hab.db, localGroupMember(this.wallet.hby, issuer).pre, hab.kever.verfers)
    ) {
      throw new ValidationError("Issuer endorsement requires a current group signing member.");
    }
    if (
      !selection.recipient || selection.recipient === selection.sender
      || new Prefixer({ qb64: selection.recipient }).qb64 !== selection.recipient
    ) {
      throw new ValidationError("Issuer endorsement requires a distinct qualified recipient.");
    }
    const nodes = frame.nests!.filter(node => (node.body as SerderACDC).regid);
    if (!nodes.length || !nodes.some(node => (node.body as SerderACDC).issuer === issuer)) {
      throw new ValidationError("Selected signer is not an issuer of this disclosed registry scope.");
    }
    for (const node of nodes.filter(node => (node.body as SerderACDC).issuer === issuer)) {
      const credential = node.body as SerderACDC;
      if (this.wallet.registry.seqEvent(credential.regid!, 0)?.issuer !== issuer) {
        throw new ValidationError("Selected credential registry does not belong to this issuer.");
      }
    }
    const nested = yield* call(() => Promise.all(frame.nests!.map(node => collectPayload(framePayload(node)))));
    const originals = grantFileFactors(frame);
    for (const raw of selection.contributions ?? []) {
      const candidate = this.inspectGrantFile(raw, selection).frame;
      const candidateNodes = yield* call(() =>
        Promise.all(candidate.nests!.map(node => collectPayload(framePayload(node))))
      );
      if (
        !bytesEqual(candidate.body.raw, exn.raw) || nested.length !== candidateNodes.length
        || nested.some((node, index) => !bytesEqual(node, candidateNodes[index]))
      ) {
        throw new ValidationError("Issuer contribution changed the exact Grant or nested evidence.");
      }
      const additions = grantFileFactors(candidate);
      if (
        [...originals.keys()].some(key => !additions.has(key))
        || [...additions].some(([key, signer]) => !originals.has(key) && (signer !== issuer || !key.startsWith("tsg:")))
      ) {
        throw new ValidationError("Contribution adds authentication outside the selected issuer.");
      }
      frame.attachments.push(...candidate.attachments);
    }
    const all = envelopeFromFrame(frame);
    for (const group of all.tsgs.filter(group => group.pre === issuer)) {
      if (group.sn !== BigInt(hab.kever.lastEst.s) || group.said !== hab.kever.lastEst.d) {
        throw new ValidationError("Issuer contributions name another establishment event.");
      }
    }
    // Offline file endorsement may precede local KRAM intake; it grants no live auxiliary authority.
    const checkDeadline = () => {
      const deadline = this.wallet.exc.exchangeDeadline(exn);
      const expiry = deadline ? timestampMicros(deadline) : null;
      if (
        this.wallet.hby.db.erpy.get([exn.said!]) || deadline
          && (expiry === null || BigInt(this.receiptor.clock.now()) * 1000n >= expiry)
      ) {
        throw new ValidationError("Prepared Grant is terminated or past its original deadline.");
      }
    };
    checkDeadline();
    this.requireGraph(
      (frame.nests![0].body as SerderACDC).said!,
      concatBytes(Counter.makeGVC(Vrsn_2_0), ...nested),
      true,
    );
    // Selection and supplied proof validation precede any local signature work.
    frame.attachments.push(...parseBytes(hab.endorse(exn, { gvrsn: Vrsn_2_0 }))[0].attachments);
    const wire = yield* call(() => collectPayload(framePayload(frame)));
    checkDeadline();
    const final = this.inspectGrantFile(wire, selection);
    return {
      exn,
      wire,
      support: this.proofSupport(concatBytes(Counter.makeGVC(Vrsn_2_0), ...nested), hab),
      endorsed: final.completeSigners.includes(issuer) && !final.partialSigners.includes(issuer),
    };
  }

  /** Prepare one fresh issuer origin with explicit authenticated far nodes, without changing disclosure authority. */
  *prepareIssuanceGrantBody(
    sender: string,
    credential: SerderACDC,
    options: IssuanceGrantOptions,
  ): Operation<PreparedGrantBody> {
    const hab = this.wallet.hby.habs.get(sender), origin = new SerderACDC({ raw: credential.raw.slice() });
    if (
      !hab?.kever || (options.gvrsn ?? Vrsn_2_0).major < 2 || origin.pvrsn.major !== 2
      || !origin.verify() || !["acm", "act", "acg"].includes(origin.ilk!) || origin.issuer !== sender
      || !options.recipient || options.recipient === sender || origin.issuee !== options.recipient || !origin.regid
    ) {
      throw new ValidationError(
        "Fresh issuance requires an exact v2 credential from the local issuer to its selected issuee.",
      );
    }
    const chain = acceptedRegistryEvidence(this.wallet.registry, origin.regid);
    if (
      !chain || chain.updates.length || chain.rip.issuer !== sender
      || vet({ ...chain, db: this.wallet.hby.db }).kind !== "verified"
    ) {
      throw new ValidationError("Fresh issuance requires the issuer's accepted anchored RIP without updates.");
    }
    const raw = concatBytes(
      Counter.makeGVC(Vrsn_2_0),
      origin.raw,
      Counter.enclose({ qb64: new Uint8Array(), version: Vrsn_2_0 }),
      ...(options.artifacts ?? []).map(artifact => artifact.slice()),
    );
    const graph = walkIpexGraph(origin.said!, parseBytes(raw), true);
    if (!graph) {
      throw new ValidationError("Fresh issuance requires its complete explicitly disclosed credential graph.");
    }
    for (const [said, node] of graph.nodes) {
      const schema = validateAcdcSchema(node.body, this.wallet.hby.db);
      if (schema.kind !== "valid") {
        throw new ValidationError(schema.kind === "missing" ? `Missing ACDC schema: ${schema.said}` : schema.reason);
      }
      if (
        said !== origin.said
        && authenticateIpexNode(node.body, envelopeFromFrame(node), this.wallet.hby.db, this.wallet.registry).kind
          !== "authenticated"
      ) {
        throw new ValidationError(
          "Fresh issuance supports one new origin; every far node requires authenticated issuer proof.",
        );
      }
    }
    const prior = yield* this.prior(options.priorSaid);
    if (
      options.anchor || prior && (!["/ipex/apply", "/ipex/agree"].includes(prior.route!)
          || (prior.sad!.a as { ax?: boolean[] }).ax?.[0])
    ) {
      throw new ValidationError(
        "Fresh issuance requires an unanchored Grant and an accepted Apply or Agree when linked.",
      );
    }
    const [exn, nests] = yield* prepareIpexExn(sender, "/ipex/grant", raw, { ...options, prior });
    return { exn, raw, nests };
  }

  /** Extend the frozen Grant's exact origin proof; ordinary intake still authenticates the supplied presentation evidence. */
  *attachPresentationProof(
    prepared: PreparedGrantBody,
    opening: RegistryDisclosure,
    source: SealSource,
  ): Operation<PreparedGrantBody> {
    const frames = parseBytes(prepared.raw), node = frames[0].body as SerderACDC;
    if (!node.issuee || opening.td.nonce !== prepared.exn.said || opening.ts.label !== "presented") {
      throw new ValidationError("Presentation proof must target this exact Grant and disclosed Issuee.");
    }
    const seal = Counter.enclose({
      code: "SealSourceTriples",
      qb64: concatBytes(new Prefixer({ qb64: node.issuee }).qb64b, source.s.qb64b, source.d.qb64b),
      version: Vrsn_2_0,
    });
    const first = concatBytes(
      node.raw,
      Counter.enclose({
        qb64: concatBytes(...frames[0].attachments.map(group => group.raw), publicOpeningAttachment(opening), seal),
        version: Vrsn_2_0,
      }),
    );
    const rest = yield* call(() =>
      Promise.all(frames.slice(1).map(frame => collectPayload(nestedPayload(frame, Vrsn_2_0))))
    );
    const raw = concatBytes(Counter.makeGVC(Vrsn_2_0), first, ...rest);
    const payloads = yield* call(() =>
      Promise.all(parseBytes(raw).map(frame => collectPayload(nestedPayload(frame, Vrsn_2_0))))
    );
    return { exn: prepared.exn, raw, nests: concatBytes(...payloads) };
  }
  /** Authenticate and authorize the selected graph before the Grant builder and after receipt waits. */
  *prepareGrant(
    sender: string,
    selection: DisclosureSelection,
    options: IpexV2BodyOptions & { priorSaid?: string; presentation?: AcdcV2Registry; auths?: WitnessAuthMap },
  ): Operation<PreparedDisclosure> {
    const hab = this.signer(sender, options.gvrsn ?? Vrsn_2_0);
    const prepared = yield* this.prepareGrantBody(sender, selection, options);
    let raw = prepared.raw;
    const origin = parseBytes(raw)[0].body.said!;
    const exn = prepared.exn;
    let nests = prepared.nests;
    if (options.presentation) {
      const reg = options.presentation, frames = parseBytes(raw), node = frames[0].body as SerderACDC;
      const attribute = node.sad!.a as { rd?: unknown; i?: unknown };
      if (
        reg.hab.pre !== sender || reg.store.baser !== this.wallet.registry.baser
        || attribute?.rd !== reg.regk || attribute?.i !== sender || isLocalGroupHab(this.wallet.hby, reg.hab)
      ) {
        throw new ValidationError("Presentation registry must match the selected disclosed local Issuee declaration.");
      }
      // The Grant SAID is frozen before the BUP/KEL commitment. Only its nested proof is extended.
      const [proof, update] = reg.present(exn, "presented", { stamp: options.stamp });
      const seal = yield* anchorExchange(this.wallet, this.receiptor, hab, update, options.auths);
      reg.processEscrows();
      if (reg.store.seqEvent(reg.regk!, Number(BigInt(`0x${update.sad!.n}`)))?.said !== update.said) {
        throw new ValidationError("Presentation BUP remains pending authenticated acceptance.");
      }
      ({ raw, nests } = yield* this.attachPresentationProof({ exn, raw, nests }, proof, seal));
    }
    const source = (exn.sad!.a as { ax?: boolean[] }).ax?.[0]
      ? yield* anchorExchange(this.wallet, this.receiptor, hab, exn, options.auths)
      : undefined;
    this.requireGraph(origin, raw);
    return {
      exn,
      wire: exchangeWire(hab, exn, nests, source, options.gvrsn ?? Vrsn_2_0),
      support: this.proofSupport(raw, hab),
    };
  }
  /** Carry selected public evidence and root-first delegation ancestry; receiver intake still verifies every approval. */
  proofSupport(raw: Uint8Array, hab: Hab): Uint8Array {
    const aids = new Set([hab.pre]), registries = new Set<string>();
    for (const frame of parseBytes(raw)) {
      if (!(frame.body instanceof SerderACDC)) continue;
      const node = frame.body, envelope = envelopeFromFrame(frame);
      if (node.issuer) aids.add(node.issuer);
      if (node.issuee) aids.add(node.issuee);
      if (node.regid) registries.add(node.regid);
      const a = node.sad!.a as { rd?: unknown; i?: unknown };
      if (a && typeof a === "object" && typeof a.rd === "string") registries.add(a.rd);
      for (const seal of envelope.ssts) {
        if (this.wallet.registry.seqEvent(seal.i.qb64, 0)) registries.add(seal.i.qb64);
        else aids.add(seal.i.qb64);
      }
    }
    const messages: Uint8Array[] = [Counter.makeGVC(Vrsn_2_0)];
    const db = this.wallet.hby.db, ordered = new Set<string>();
    // An ancestry claim selects supporting KELs; it does not establish delegation authority.
    for (const aid of aids) {
      const ancestors: string[] = [], seen = new Set<string>();
      let current: string | null = aid;
      while (current && !ordered.has(current)) {
        if (seen.has(current)) throw new ValidationError(`Cyclic disclosure delegation ancestry at ${current}.`);
        seen.add(current);
        const state = db.getKever(current);
        if (!state) break;
        ancestors.push(current);
        current = state.delpre;
      }
      for (const ancestor of ancestors.reverse()) ordered.add(ancestor);
    }
    // Keep first-seen authorizers and exact stored attachments, including superseded history.
    // clonePreIter skips broken rows; finite disclosure must instead fail if an accepted row cannot be replayed.
    for (const aid of ordered) {
      for (const [, fn, said] of db.fels.getAllItemIter(aid)) messages.push(db.cloneEvtMsg(aid, fn, said, Vrsn_2_0));
    }
    for (const regid of registries) messages.push(this.wallet.registry.cloneTel(regid));
    return concatBytes(...messages);
  }
  /** Public replay includes actual stored witness receipts; it grants no new consent. */
  kel(hab: Hab): Uint8Array {
    return concatBytes(
      Counter.makeGVC(Vrsn_2_0),
      ...Array.from(
        { length: hab.kever!.sn + 1 },
        (_, sn) => acceptedEventReplayMessage(this.wallet.hby, hab.pre, sn, Vrsn_2_0).message,
      ),
    );
  }
}
