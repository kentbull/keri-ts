/** Exact issuer KEL authority for legacy TEL events. */
import { type Diger, Ilks, type NumberPrimitive, type SerderKERI } from "cesr-ts";
import type { Baser } from "../db/basing.ts";

/** Verify the complete TEL seal in the accepted issuer event at the supplied source coordinate. */
export function verifyTelAnchor(
  db: Baser,
  issuer: string,
  event: SerderKERI,
  ordinal?: NumberPrimitive | null,
  digest?: Diger | null,
): boolean {
  if (!ordinal || !digest || ordinal.num > BigInt(Number.MAX_SAFE_INTEGER)) return false;
  const accepted = db.kels.getLast(issuer, Number(ordinal.num));
  if (accepted !== digest.qb64) return false;
  const anchor = db.getEvtSerder(issuer, accepted);
  if (!anchor || anchor.said !== accepted) return false;
  return telAnchorMatches(issuer, event, anchor);
}

/** Match the complete TEL seal in an issuer KEL body before that anchor is signed or accepted. */
export function telAnchorMatches(issuer: string, event: SerderKERI, anchor: SerderKERI): boolean {
  if (anchor.pre !== issuer || (!anchor.estive && anchor.ilk !== Ilks.ixn)) return false;
  const seals = anchor.ked?.a;
  if (!Array.isArray(seals) || seals.length !== 1) return false;
  const seal: unknown = seals[0];
  return !!seal && typeof seal === "object" && !Array.isArray(seal)
    && "i" in seal && seal.i === event.pre && "s" in seal && seal.s === event.snh
    && "d" in seal && seal.d === event.said;
}
