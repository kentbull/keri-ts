/**
 * IPEX discloser core: Grant preparation over borrowed protocol owners.
 *
 * Holds the parts of disclosure that read no credential inventory: exchange
 * wires, source anchoring, fresh-issuance Grant bodies and public proof
 * support, plus graph authorization, registry proofs, Apply and Reply bodies.
 * Selecting issued or held credentials stays with the embedder
 * (`WalletDiscloser` extends this class).
 * No constructor opens a store, starts a worker or loads registry secrets.
 */
import {
  collectPayload,
  Compactor,
  concatBytes,
  Counter,
  Diger,
  type MapperMap,
  nestedPayload,
  NumberPrimitive,
  parseBytes,
  Prefixer,
  SealSource,
  SerderACDC,
  type SerderKERI,
  unblindBlindState,
  unblindBoundState,
  type Versionage,
  Vrsn_2_0,
} from "cesr-ts";
import { call, type Operation } from "effection";
import { type ChainVerdict, evaluateChain } from "../../acdc/chaining.ts";
import type { RegistryCustody } from "../../acdc/custody.ts";
import {
  matchesRegistrySeal,
  type RegistryDisclosure,
  vet,
  vetBinds,
  vetBlind,
  vetBound,
} from "../../acdc/regeventing.ts";
import { publicOpeningAttachment, type RegistryStore } from "../../acdc/registering.ts";
import type { Registry } from "../../acdc/registraring.ts";
import { validateSchema as validateAcdcSchema } from "../../acdc/scheming.ts";
import { ValidationError } from "../../core/errors.ts";
import type { Exchanger } from "../exchanges/exchanging.ts";
import { acceptedEventReplayMessage, type Hab, type Habery } from "../identity/habbing.ts";
import { isLocalGroupHab } from "../multisig/group-members.ts";
import { envelopeFromFrame } from "../protocol/parsering.ts";
import type { Receiptor, WitnessAuthMap } from "../witness/receipting.ts";
import { ipexExnBody, type IpexV2BodyOptions, prepareIpexExn } from "./ipex-building.ts";
import { walkIpexGraph } from "./ipex-graph.ts";
import { acceptedRegistryEvidence, authenticateIpexNode, issuedNodeVerdict } from "./ipex-node-authentication.ts";
import { ipexGrantWalk } from "./ipex-v2.ts";

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
/** Fresh origin and explicit far-node proofs; preparation grants neither DH nor inventory consent. */
export interface IssuanceGrantOptions extends Omit<IpexV2BodyOptions, "prior"> {
  recipient: string;
  priorSaid?: string;
  artifacts?: readonly Uint8Array[];
}
/** Reuse a matching accepted KEL seal, or author once and gather real witness receipts. */
export function* anchorExchange(
  hby: Habery,
  receiptor: Receiptor,
  hab: Hab,
  body: SerderKERI | SerderACDC,
  auths?: WitnessAuthMap,
): Operation<SealSource> {
  if (receiptor.hby !== hby) throw new ValidationError("Receipt owner must share this wallet's Habery.");
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

/** Exact admitted node streams; no fuller cached section replaces retained disclosure. */
export interface HeldCredential {
  credential: SerderACDC;
  proof: Uint8Array;
  artifacts: Uint8Array[];
  grant: SerderKERI;
  admit: string;
}
/** Credential views presentation selects from; the embedder owns the inventory behind them. */
export interface CredentialViews {
  /** Reconstruct a locally issued credential; throws when it is not retained. */
  issued(said: string): SerderACDC;
  /** Registry of a retained issuance, when the embedder records one. */
  issuedRegistry(said: string): string | undefined;
  /** Read the original admitted proof, or a presenter-authorized transferred view. */
  held(grant: string, options?: { presenterAuthorized?: boolean }): Promise<HeldCredential>;
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
/** Borrow concrete owners only. No constructor opens a store, starts a worker or loads registry secrets. */
export class IpexDiscloser {
  constructor(
    readonly hby: Habery,
    readonly registry: RegistryStore,
    readonly exc: Exchanger,
    readonly receiptor: Receiptor,
    readonly custody?: RegistryCustody,
    readonly views?: CredentialViews,
  ) {
    if (receiptor.hby !== hby) throw new ValidationError("Disclosure receipt owner must share the Habery.");
    if (custody && (custody.options.hby !== hby || custody.options.registry !== registry)) {
      throw new ValidationError("Disclosure custody must use this discloser's actual owners.");
    }
  }
  /** Selection needs the embedder's credential views; fresh issuance and replies do not. */
  protected credentials(): CredentialViews {
    if (!this.views) throw new ValidationError("Credential selection requires the embedder's credential views.");
    return this.views;
  }
  /** Resolve only a local individual signer; group approval composes this body in the group workflow. */
  protected signer(sender: string, gvrsn: Versionage = Vrsn_2_0): Hab {
    if (gvrsn.major < 2) throw new ValidationError("ACDC v2 disclosure requires attachment genus 2 or later.");
    const hab = this.hby.habs.get(sender);
    if (!hab || isLocalGroupHab(this.hby, hab)) {
      throw new ValidationError("ACDC v2 disclosure requires a local individual signer.");
    }
    return hab;
  }

  /** Revalidate exact accepted prior bytes without treating notification or salt possession as acceptance. */
  protected *prior(said?: string): Operation<SerderKERI | undefined> {
    if (!said) return undefined;
    const body = this.hby.db.exns.get(said);
    if (!body || !this.exc.complete(said) || !this.exc.verifyAccepted(said, body.route!)) {
      throw new ValidationError("Prior ACDC v2 IPEX exchange must be accepted and authenticated.");
    }
    yield* call(async () => {
      for await (const _ of this.exc.replay(said)) { /* authenticated retained outer proof */ }
    });
    return body;
  }

  /** Prepare one fresh issuer origin with explicit authenticated far nodes, without changing disclosure authority. */
  *prepareIssuanceGrantBody(
    sender: string,
    credential: SerderACDC,
    options: IssuanceGrantOptions,
  ): Operation<PreparedGrantBody> {
    const hab = this.hby.habs.get(sender), origin = new SerderACDC({ raw: credential.raw.slice() });
    if (
      !hab?.kever || (options.gvrsn ?? Vrsn_2_0).major < 2 || origin.pvrsn.major !== 2
      || !origin.verify() || !["acm", "act", "acg"].includes(origin.ilk!) || origin.issuer !== sender
      || !options.recipient || options.recipient === sender || origin.issuee !== options.recipient || !origin.regid
    ) {
      throw new ValidationError(
        "Fresh issuance requires an exact v2 credential from the local issuer to its selected issuee.",
      );
    }
    const chain = acceptedRegistryEvidence(this.registry, origin.regid);
    if (
      !chain || chain.updates.length || chain.rip.issuer !== sender
      || vet({ ...chain, db: this.hby.db }).kind !== "verified"
    ) {
      throw new ValidationError("Fresh issuance requires the issuer's accepted anchored RIP without updates.");
    }
    const raw = concatBytes(
      Counter.makeGVC(Vrsn_2_0),
      origin.raw,
      Counter.enclose({ qb64: new Uint8Array(), version: Vrsn_2_0 }),
      ...(options.artifacts ?? []).map(artifact => artifact.slice()),
    );
    const graph = walkIpexGraph(origin.said!, parseBytes(raw), ipexGrantWalk(this.exc));
    if (!graph) {
      throw new ValidationError("Fresh issuance requires its complete explicitly disclosed credential graph.");
    }
    for (const [said, node] of graph.nodes) {
      const schema = validateAcdcSchema(node.body, this.hby.db);
      if (schema.kind !== "valid") {
        throw new ValidationError(schema.kind === "missing" ? `Missing ACDC schema: ${schema.said}` : schema.reason);
      }
      if (
        said !== origin.said
        && authenticateIpexNode(node.body, envelopeFromFrame(node), this.hby.db, this.registry).kind
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
        if (this.registry.seqEvent(seal.i.qb64, 0)) registries.add(seal.i.qb64);
        else aids.add(seal.i.qb64);
      }
    }
    const messages: Uint8Array[] = [Counter.makeGVC(Vrsn_2_0)];
    const db = this.hby.db, ordered = new Set<string>();
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
    for (const regid of registries) messages.push(this.registry.cloneTel(regid));
    return concatBytes(...messages);
  }

  /** Public replay includes actual stored witness receipts; it grants no new consent. */
  kel(hab: Hab): Uint8Array {
    return concatBytes(
      Counter.makeGVC(Vrsn_2_0),
      ...Array.from(
        { length: hab.kever!.sn + 1 },
        (_, sn) => acceptedEventReplayMessage(this.hby, hab.pre, sn, Vrsn_2_0).message,
      ),
    );
  }
  /** Reduce only the selected attribute view using the existing commitment-preserving Compactor. */
  protected partial(credential: SerderACDC, paths?: readonly string[]): SerderACDC {
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
  protected requireGraph(origin: string, raw: Uint8Array, pendingPresentation = false): void {
    const graph = walkIpexGraph(origin, parseBytes(raw), ipexGrantWalk(this.exc));
    if (!graph) throw new ValidationError("Selected credential graph is incomplete.");
    const verdicts = new Map<string, ChainVerdict>();
    for (const [said, node] of graph.nodes) {
      if (pendingPresentation) {
        const schema = validateAcdcSchema(node.body, this.hby.db);
        if (schema.kind !== "valid") {
          throw new ValidationError(schema.kind === "missing" ? `Missing ACDC schema: ${schema.said}` : schema.reason);
        }
      }
      const envelope = envelopeFromFrame(node);
      const auth = authenticateIpexNode(node.body, envelope, this.hby.db, this.registry);
      let verdict = issuedNodeVerdict(auth);
      if (pendingPresentation && auth.kind === "reject" && node.body.regid) {
        // Ordinary node authentication deliberately rejects absent current openings.
        // File consent may wait for that specific evidence, never for a known invalid state.
        const chain = acceptedRegistryEvidence(this.registry, node.body.regid);
        const binding = chain && vetBinds({
          ...chain,
          db: this.hby.db,
          acdc: node.body,
          target: said,
          blinders: [...envelope.bsqs, ...envelope.bsss],
        });
        const historical = authenticateIpexNode(node.body, envelope, this.hby.db, this.registry, true);
        if (
          binding?.kind === "missing" && binding.reason === "disclosure"
          && historical.kind === "authenticated" && historical.registration?.state === "issued"
        ) {
          verdict = { kind: "unknown", retryable: true, reason: "Missing current registry opening.", schemas: [] };
        }
      }
      verdicts.set(said, verdict);
    }
    const current = evaluateChain(graph, verdicts, this.hby.db);
    if (current?.kind === "valid") return;
    if (pendingPresentation && current?.kind === "unknown" && current.retryable) {
      const historical = new Map<string, ChainVerdict>();
      for (const [said, node] of graph.nodes) {
        historical.set(
          said,
          issuedNodeVerdict(authenticateIpexNode(
            node.body,
            envelopeFromFrame(node),
            this.hby.db,
            this.registry,
            true,
          )),
        );
      }
      if (evaluateChain(graph, historical, this.hby.db)?.kind === "valid") return;
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
    options: { derive?: boolean } = {},
  ): Uint8Array {
    const chain = acceptedRegistryEvidence(this.registry, registry);
    if (!chain || chain.updates.some((update) => update.ilk !== "bup")) {
      throw new ValidationError("Accepted ACDC v2 registry history is required.");
    }
    if (options.derive && !this.custody) throw new ValidationError("Explicit derivation requires provisioned custody.");
    const proofs: Uint8Array[] = [];
    let binding: SerderACDC | null = null;
    for (const event of [...chain.updates].reverse()) {
      const blid = event.sad!.b as string;
      let opening = retained.find((proof) => proof.d.nonce === blid) ?? this.registry.publicOpening(event.said!);
      if (!opening && options.derive) {
        // Exact retained coordinates are required; missing local material is a refusal.
        opening = this.custody!.derivedOpening(event);
      }
      if (
        !opening || !vetBlind(opening, blid) || (opening.td.nonce && opening.td.nonce !== credential.said)
        || vetBound(opening, credential, this.hby.db)
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
  /** Create an application request; no credential-use approval is invented for negotiation. */
  *prepareApply(sender: string, options: IpexV2BodyOptions): Operation<PreparedDisclosure> {
    const hab = this.signer(sender, options.gvrsn ?? Vrsn_2_0), exn = ipexExnBody(sender, "/ipex/apply", [], options);
    return {
      exn,
      wire: exchangeWire(hab, exn, undefined, undefined, options.gvrsn ?? Vrsn_2_0),
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
      ? yield* anchorExchange(this.hby, this.receiptor, hab, exn, auths)
      : undefined;
    return { exn, wire: exchangeWire(hab, exn, undefined, source), support: source ? this.kel(hab) : new Uint8Array() };
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
  /** Select immutable admitted/transferred nests; proof refresh changes attachments only when explicitly requested. */
  protected *selected(selection: DisclosureSelection, offer = false): Operation<Uint8Array> {
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
        this.credentials().held(selection.fromGrant!, { presenterAuthorized: selection.presenterAuthorized })
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
      held?.credential ?? this.credentials().issued(selection.said!),
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
          envelope?.ssts.filter((seal) => this.registry.seqEvent(seal.i.qb64, 0)).map((seal) => seal.i.qb64),
        ),
      ];
      const regid = credential.regid
        ?? (selection.said ? this.credentials().issuedRegistry(selection.said) : undefined)
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
  protected *grantBody(
    sender: string,
    selection: DisclosureSelection,
    options: IpexV2BodyOptions & { priorSaid?: string },
    pendingPresentation: boolean,
  ): Operation<PreparedGrantBody> {
    const hab = this.hby.habs.get(sender);
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
  /** Authenticate and authorize the selected graph before the Grant builder and after receipt waits. */
  *prepareGrant(
    sender: string,
    selection: DisclosureSelection,
    options: IpexV2BodyOptions & { priorSaid?: string; presentation?: Registry; auths?: WitnessAuthMap },
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
        reg.hab.pre !== sender || reg.store.baser !== this.registry.baser
        || attribute?.rd !== reg.regk || attribute?.i !== sender || isLocalGroupHab(this.hby, reg.hab)
      ) {
        throw new ValidationError("Presentation registry must match the selected disclosed local Issuee declaration.");
      }
      // The Grant SAID is frozen before the BUP/KEL commitment. Only its nested proof is extended.
      const [proof, update] = reg.present(exn, "presented", { stamp: options.stamp });
      const seal = yield* anchorExchange(this.hby, this.receiptor, hab, update, options.auths);
      reg.processEscrows();
      if (reg.store.seqEvent(reg.regk!, Number(BigInt(`0x${update.sad!.n}`)))?.said !== update.said) {
        throw new ValidationError("Presentation BUP remains pending authenticated acceptance.");
      }
      ({ raw, nests } = yield* this.attachPresentationProof({ exn, raw, nests }, proof, seal));
    }
    const source = (exn.sad!.a as { ax?: boolean[] }).ax?.[0]
      ? yield* anchorExchange(this.hby, this.receiptor, hab, exn, options.auths)
      : undefined;
    this.requireGraph(origin, raw);
    return {
      exn,
      wire: exchangeWire(hab, exn, nests, source, options.gvrsn ?? Vrsn_2_0),
      support: this.proofSupport(raw, hab),
    };
  }
}
