/** Finite ACDC v2 IPEX composition over exact wallet views and explicitly supplied private capability. */
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
import { publicOpeningAttachment } from "keri-ts/db";
import {
  acceptedEventReplayMessage,
  acceptedRegistryEvidence,
  type AcdcV2Registry,
  authenticateIpexNode,
  envelopeFromFrame,
  evaluateAcdcRelations,
  type Hab,
  ipexExnBody,
  type IpexV2BodyOptions,
  isLocalGroupHab,
  matchesRegistrySeal,
  prepareIpexExn,
  type Receiptor,
  type RegistryDisclosure,
  type RegistryState,
  ValidationError,
  vetBlind,
  vetBound,
  walkIpexGraph,
} from "keri-ts/runtime";
import type { RegistryCustody } from "./custody.ts";
import type { Wallet } from "./wallet.ts";

/** A prepared signed exchange and its supporting public KEL/TEL bytes; delivery and intake stay explicit. */
export interface PreparedDisclosure {
  exn: SerderKERI;
  wire: Uint8Array;
  support: Uint8Array;
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
  boundEvent?: string;
  artifacts?: readonly Uint8Array[];
}
/** Reuse a matching accepted KEL seal, or author once and gather real witness receipts. */
export function* anchorExchange(
  wallet: Wallet,
  receiptor: Receiptor,
  hab: Hab,
  body: SerderKERI | SerderACDC,
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
  yield* receiptor.receipt(hab.pre, { sn: anchor.sn!, allowTcp: true });
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
  private requireGraph(origin: string, raw: Uint8Array): void {
    const graph = walkIpexGraph(origin, parseBytes(raw), true, this.wallet.hby.db);
    if (!graph || "kind" in graph) throw new ValidationError("Selected credential graph is incomplete.");
    const states = new Map<string, RegistryState>();
    for (const [said, node] of graph.nodes) {
      const auth = authenticateIpexNode(node.body, envelopeFromFrame(node), this.wallet.hby.db, this.wallet.registry);
      if (auth.kind !== "authenticated") throw new ValidationError("Selected issuer proof is unavailable or invalid.");
      if (auth.registration) states.set(said, auth.registration);
    }
    if (evaluateAcdcRelations(graph, this.wallet.hby.db, states) !== true) {
      throw new ValidationError("Current authenticated graph truth is required before use.");
    }
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
    options: Pick<DisclosureSelection, "derive" | "boundEvent"> = {},
  ): Uint8Array {
    const chain = acceptedRegistryEvidence(this.wallet.registry, registry);
    if (!chain || chain.updates.some((update) => update.ilk !== "bup")) {
      throw new ValidationError("Accepted ACDC v2 registry history is required.");
    }
    if (options.derive && !this.custody) throw new ValidationError("Explicit derivation requires provisioned custody.");
    const proofs: Uint8Array[] = [];
    let bound: { bsn: number; bd: string } | undefined;
    if (options.boundEvent) {
      const db = this.wallet.hby.db, issuee = credential.issuee;
      const event = issuee ? db.getEvtSerder(issuee, options.boundEvent) : null;
      if (
        !event || event.sn === null || db.kels.getLast(issuee!, event.sn) !== event.said || !db.fullyWitnessed(event)
      ) {
        throw new ValidationError("Bound reference requires an exact accepted witnessed Issuee event.");
      }
      bound = { bsn: event.sn, bd: event.said! };
    }
    let binding: SerderACDC | null = null;
    for (const event of [...chain.updates].reverse()) {
      const blid = event.sad!.b as string;
      let opening = retained.find((proof) => proof.d.nonce === blid) ?? this.wallet.registry.publicOpening(event.said!);
      if (!opening && options.derive) {
        // Exact event coordinates take priority; an explicit bound event may reproduce foreign derived history.
        try {
          opening = this.custody!.derivedOpening(event);
        } catch (error) {
          if (
            !(error instanceof ValidationError) || error.message !== "Exact derived update coordinates are unavailable"
          ) throw error;
        }
        if (!opening) {
          const ordinal = BigInt(`0x${event.sad!.n}`);
          for (const [target, state] of [[credential.said!, "issued"], [credential.said!, "revoked"], ["", ""]]) {
            const candidate = this.custody!.derive(
              registry,
              ordinal,
              target,
              state,
              bound ? { bound: true, bsn: target ? bound.bsn : 0, bd: target ? bound.bd : "" } : {},
            );
            if (candidate.d.nonce === blid) {
              opening = candidate;
              break;
            }
          }
        }
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
      && (selection.derive || selection.openings?.length || selection.boundEvent)
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
  ): Operation<PreparedDisclosure> {
    const hab = this.signer(sender), prior = yield* this.prior(priorSaid);
    const exn = ipexExnBody(sender, `/ipex/${verb}`, [], { message, prior, recipient });
    const source = verb === "agree" && (exn.sad!.a as { ax?: boolean[] }).ax?.[0]
      ? yield* anchorExchange(this.wallet, this.receiptor, hab, exn)
      : undefined;
    return { exn, wire: exchangeWire(hab, exn, undefined, source), support: source ? this.kel(hab) : new Uint8Array() };
  }
  /** Authenticate and authorize the selected graph before the Grant builder and after receipt waits. */
  *prepareGrant(
    sender: string,
    selection: DisclosureSelection,
    options: IpexV2BodyOptions & { priorSaid?: string; presentation?: AcdcV2Registry },
  ): Operation<PreparedDisclosure> {
    const hab = this.signer(sender, options.gvrsn ?? Vrsn_2_0), prior = yield* this.prior(options.priorSaid);
    let raw = yield* this.selected(selection);
    const origin = parseBytes(raw)[0].body.said!;
    this.requireGraph(origin, raw);
    const [exn, originalNests] = yield* prepareIpexExn(sender, "/ipex/grant", raw, { ...options, prior });
    let nests = originalNests;
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
      const seal = yield* anchorExchange(this.wallet, this.receiptor, hab, update);
      reg.processEscrows();
      if (reg.store.seqEvent(reg.regk!, Number(BigInt(`0x${update.sad!.n}`)))?.said !== update.said) {
        throw new ValidationError("Presentation BUP remains pending authenticated acceptance.");
      }
      const source = Counter.enclose({
        code: "SealSourceTriples",
        qb64: concatBytes(
          new Prefixer({ qb64: sender }).qb64b,
          seal.s.qb64b,
          seal.d.qb64b,
        ),
        version: Vrsn_2_0,
      });
      const first = concatBytes(
        node.raw,
        Counter.enclose({
          qb64: concatBytes(
            ...frames[0].attachments.map((group) => group.raw),
            publicOpeningAttachment(proof),
            source,
          ),
        }),
      );
      const rest = yield* call(() =>
        Promise.all(frames.slice(1).map((frame) => collectPayload(nestedPayload(frame, Vrsn_2_0))))
      );
      raw = concatBytes(Counter.makeGVC(Vrsn_2_0), first, ...rest);
      const payloads = yield* call(() =>
        Promise.all(parseBytes(raw).map((frame) => collectPayload(nestedPayload(frame, Vrsn_2_0))))
      );
      nests = concatBytes(...payloads);
    }
    const source = (exn.sad!.a as { ax?: boolean[] }).ax?.[0]
      ? yield* anchorExchange(this.wallet, this.receiptor, hab, exn)
      : undefined;
    this.requireGraph(origin, raw);
    return {
      exn,
      wire: exchangeWire(hab, exn, nests, source, options.gvrsn ?? Vrsn_2_0),
      support: this.proofSupport(raw, hab),
    };
  }
  /** Carry the selected nodes' accepted public dependencies; neither query nor publish private openings. */
  private proofSupport(raw: Uint8Array, hab: Hab): Uint8Array {
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
    for (const aid of aids) {
      const state = this.wallet.hby.db.getKever(aid);
      if (!state) continue;
      for (let sn = 0; sn <= state.sn; sn++) {
        messages.push(acceptedEventReplayMessage(this.wallet.hby, aid, sn, Vrsn_2_0).message);
      }
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
