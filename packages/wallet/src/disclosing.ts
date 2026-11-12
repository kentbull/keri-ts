/** Finite ACDC v2 IPEX composition over exact wallet views and explicitly supplied private capability. */
import {
  type CesrFrame,
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
  SerderKERI,
  unblindBlindState,
  unblindBoundState,
  Vrsn_2_0,
} from "cesr-ts";
import { call, type Operation } from "effection";
import { publicOpeningAttachment } from "keri-ts/db";
import {
  acceptedRegistryEvidence,
  type AcdcV2Registry,
  anchorIpexExchange,
  authenticateIpexNode,
  type ChainVerdict,
  envelopeFromFrame,
  evaluateChain,
  exchangeWire,
  type Hab,
  IpexDiscloser,
  ipexExnBody,
  ipexGrantWalk,
  type IpexV2BodyOptions,
  isLocalGroupHab,
  type IssuanceGrantOptions,
  issuedNodeVerdict,
  Kever,
  type PreparedDisclosure,
  type PreparedGrantBody,
  prepareIpexExn,
  type Receiptor,
  type RegistryDisclosure,
  validateAcdcSchema,
  ValidationError,
  verifyExchangeProofs,
  vetBinds,
  vetBlind,
  vetBound,
  walkIpexGraph,
  type WitnessAuthMap,
} from "keri-ts/runtime";
import type { RegistryCustody } from "./custody.ts";
import type { Wallet } from "./wallet.ts";

export { exchangeWire };
export type { IssuanceGrantOptions, PreparedDisclosure, PreparedGrantBody };

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
  return yield* anchorIpexExchange(wallet.hby, receiptor, hab, body, auths);
}

/** Verify the wallet's actual owners before the core sees them, keeping the original refusals. */
function owned(wallet: Wallet, receiptor: Receiptor, custody?: RegistryCustody): Wallet {
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
  return wallet;
}

/** The protocol core plus wallet views: selection of issued or held credentials stays here. */
export class WalletDiscloser extends IpexDiscloser {
  declare readonly custody?: RegistryCustody;

  constructor(readonly wallet: Wallet, receiptor: Receiptor, custody?: RegistryCustody) {
    super(owned(wallet, receiptor, custody).hby, wallet.registry, wallet.exc, receiptor, custody);
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
    const graph = walkIpexGraph(origin, parseBytes(raw), ipexGrantWalk(this.wallet.exc));
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
}
