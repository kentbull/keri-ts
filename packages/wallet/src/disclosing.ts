/** Finite ACDC v2 IPEX composition over exact wallet views and explicitly supplied private capability. */
import { type CesrFrame, parseBytes, SealSource, SerderACDC, SerderKERI } from "cesr-ts";
import { type Operation } from "effection";
import {
  anchorIpexExchange,
  type DisclosureSelection,
  envelopeFromFrame,
  exchangeWire,
  type Hab,
  IpexDiscloser,
  type IssuanceGrantOptions,
  Kever,
  type PreparedDisclosure,
  type PreparedGrantBody,
  type Receiptor,
  ValidationError,
  verifyExchangeProofs,
  type WitnessAuthMap,
} from "keri-ts/runtime";
import type { RegistryCustody } from "./custody.ts";
import type { Wallet } from "./wallet.ts";

export { exchangeWire };
export type { DisclosureSelection, IssuanceGrantOptions, PreparedDisclosure, PreparedGrantBody };

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

/** The protocol core over this wallet's inventory, which supplies its credential views. */
export class WalletDiscloser extends IpexDiscloser {
  declare readonly custody?: RegistryCustody;

  constructor(readonly wallet: Wallet, receiptor: Receiptor, custody?: RegistryCustody) {
    super(owned(wallet, receiptor, custody).hby, wallet.registry, wallet.exc, receiptor, custody, wallet);
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
}
