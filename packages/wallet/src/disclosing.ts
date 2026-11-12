/** Finite ACDC v2 IPEX composition over exact wallet views and explicitly supplied private capability. */
import {
  type CesrFrame,
  collectPayload,
  concatBytes,
  Counter,
  nestedPayload,
  parseBytes,
  SealSource,
  SerderACDC,
  SerderKERI,
  Vrsn_2_0,
} from "cesr-ts";
import { call, type Operation } from "effection";
import {
  type AcdcV2Registry,
  anchorIpexExchange,
  envelopeFromFrame,
  exchangeWire,
  type Hab,
  IpexDiscloser,
  type IpexV2BodyOptions,
  isLocalGroupHab,
  type IssuanceGrantOptions,
  Kever,
  type PreparedDisclosure,
  type PreparedGrantBody,
  prepareIpexExn,
  type Receiptor,
  type RegistryDisclosure,
  ValidationError,
  verifyExchangeProofs,
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
