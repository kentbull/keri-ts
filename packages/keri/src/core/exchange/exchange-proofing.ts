/** Independently verify EXN or disclosed-node proofs against already accepted KEL state. */
import { type Cigar, Diger, NumberPrimitive, type SealEvent, type SerderACDC, type SerderKERI } from "cesr-ts";
import type { Baser } from "../../db/basing.ts";
import { type KeriDispatchEnvelope, TransIdxSigGroup } from "../dispatch.ts";
import { Kever } from "../kel/kever.ts";

/** Explicit proof factors; no parent or neighboring node can supply implicit evidence here. */
export interface ExchangeFactors {
  tsgs?: readonly TransIdxSigGroup[];
  cigars?: readonly Cigar[];
  sourceSeals?: readonly SealEvent[];
}

/** Missing accepted KEL coordinates are distinct from permanently invalid proof claims. */
export interface MissingExchangeState {
  pre: string;
  sn: bigint | null;
}

/** Valid factors plus invalid/missing observations, for the owning route's selection policy. */
export interface ExchangeProofVerification {
  tsgs: TransIdxSigGroup[];
  cigars: Cigar[];
  sourceSeals: SealEvent[];
  invalid: boolean;
  missing: MissingExchangeState[];
}

/**
 * Authenticate a named query sender independently of optional KRAM admission.
 * Explicit sender TSGs take precedence; only their absence allows raw/last
 * factors to resolve against current accepted establishment state. A valid
 * alternative suffices, but missing claimed coordinates refuse, as in Python.
 */
export function verifyQueryAttachments(db: Baser, envelope: KeriDispatchEnvelope): boolean {
  const { serder } = envelope;
  let tsgs = envelope.tsgs.filter((group) => group.pre === serder.pre);
  const kever = db.getKever(serder.pre!);
  if (!tsgs.length && kever) {
    const sigers = [
      ...envelope.sigers,
      ...envelope.ssgs.filter((group) => group.pre === serder.pre)
        .flatMap((group) => group.sigers),
    ];
    if (sigers.length) {
      tsgs = [
        new TransIdxSigGroup(
          kever.prefixer,
          NumberPrimitive.fromNum(BigInt(kever.lastEst.s)),
          new Diger({ qb64: kever.lastEst.d }),
          sigers,
        ),
      ];
    }
  }
  const verified = verifyExchangeProofs(db, serder, {
    tsgs,
    cigars: envelope.cigars.filter((cigar) => cigar.verfer?.qb64 === serder.pre),
  });
  return !verified.missing.length && !!(verified.tsgs.length || verified.cigars.length);
}

/**
 * Match frozen KERIpy peer.exchanging.verifyAttachments without fetching or publishing.
 * Source seals select an accepted key event containing this body's SAID.
 * Safe-integer bounds are JavaScript/database constraints, not protocol ordinal limits.
 * The route decides whether one valid factor suffices and whether optional failures matter.
 */
export function verifyExchangeProofs(
  db: Baser,
  serder: SerderKERI | SerderACDC,
  factors: ExchangeFactors,
): ExchangeProofVerification {
  const result: ExchangeProofVerification = { tsgs: [], cigars: [], sourceSeals: [], invalid: false, missing: [] };
  for (const group of factors.tsgs ?? []) {
    if (!group.prefixer.transferable || group.sn > BigInt(Number.MAX_SAFE_INTEGER)) {
      result.invalid = true;
      continue;
    }
    const said = db.kels.getLast(group.pre, Number(group.sn));
    const event = said ? db.getEvtSerder(group.pre, said) : null;
    if (!event) {
      result.missing.push({ pre: group.pre, sn: group.sn });
      continue;
    }
    if (said !== group.said || !event.estive || !event.tholder) {
      result.invalid = true;
      continue;
    }
    const verified = Kever.verifyIndexedSignatures(serder.raw, group.sigers, event.verfers);
    if (!event.tholder.satisfy(verified.indices)) {
      result.invalid = true;
      continue;
    }
    result.tsgs.push(new TransIdxSigGroup(group.prefixer, group.seqner, group.diger, verified.sigers));
  }
  for (const cigar of factors.cigars ?? []) {
    if (!cigar.verfer || cigar.verfer.transferable || !cigar.verfer.verify(cigar.raw, serder.raw)) {
      result.invalid = true;
    } else result.cigars.push(cigar);
  }
  for (const seal of factors.sourceSeals ?? []) {
    if (!seal.i.transferable || seal.s.num > BigInt(Number.MAX_SAFE_INTEGER)) {
      result.invalid = true;
      continue;
    }
    const said = db.kels.getLast(seal.i.qb64, Number(seal.s.num));
    const event = said ? db.getEvtSerder(seal.i.qb64, said) : null;
    if (!event) {
      result.missing.push({ pre: seal.i.qb64, sn: seal.s.num });
      continue;
    }
    if (
      said !== seal.d.qb64
      || !event.seals.some((item) =>
        item !== null && typeof item === "object" && !Array.isArray(item)
        && (item as Record<string, unknown>).d === serder.said
      )
    ) {
      result.invalid = true;
    } else result.sourceSeals.push(seal);
  }
  return result;
}
