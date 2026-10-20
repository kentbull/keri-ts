/** Historical TEL backer selection from accepted management coordinates. */
import { Ilks, ParserError, SerderKERI } from "cesr-ts";
import { DatabaseOperationError } from "../core/errors.ts";
import { dgKey } from "../db/core/keys.ts";
import type { Reger } from "../db/reger.ts";

/** Missing management evidence is retryable; a contradictory remote coordinate is refused. */
export type BackerState =
  | { kind: "backers"; toad: number; baks: string[] }
  | { kind: "missing"; reason: string }
  | { kind: "reject"; reason: string };

/**
 * Resolve the complete ra.i/ra.s/ra.d tuple before reading its ordered roster.
 * Raw/escrowed management bodies confer no authority. KERIpy's digest-only raw
 * lookup is deliberately strengthened here; wire fields and signature indexes stay unchanged.
 */
export function resolveBackerState(reger: Reger, regk: string, seal: unknown): BackerState {
  if (
    !seal || typeof seal !== "object" || Array.isArray(seal)
    || !("i" in seal) || seal.i !== regk || !("s" in seal) || typeof seal.s !== "string"
    || !/^[0-9a-f]+$/.test(seal.s) || !("d" in seal) || typeof seal.d !== "string"
  ) return { kind: "reject", reason: "Backer TEL event registry anchor mismatch." };
  const ordinal = BigInt(`0x${seal.s}`);
  if (ordinal > BigInt(Number.MAX_SAFE_INTEGER)) {
    return { kind: "reject", reason: "Backer management ordinal exceeds exact storage representation." };
  }
  const accepted = reger.tels.getOn(regk, Number(ordinal));
  if (!accepted) return { kind: "missing", reason: "Backer TEL event awaits accepted registry management state." };
  if (accepted.qb64 !== seal.d) return { kind: "reject", reason: "Backer TEL event registry anchor digest mismatch." };
  const key = dgKey(regk, accepted.qb64), raw = reger.tvts.get(key);
  if (!raw) throw new DatabaseOperationError("Accepted backer management body is missing.");
  let event: SerderKERI;
  try {
    event = new SerderKERI({ raw });
  } catch (error) {
    if (!(error instanceof ParserError)) throw error;
    throw new DatabaseOperationError("Accepted backer management body is corrupt.", { cause: error });
  }
  if (
    !event.verify() || event.pre !== regk || event.sn !== Number(ordinal) || event.said !== accepted.qb64
    || (event.ilk !== Ilks.vcp && event.ilk !== Ilks.vrt)
  ) throw new DatabaseOperationError("Accepted backer management coordinate is inconsistent.");
  const threshold = event.ked?.bt;
  if (typeof threshold !== "string" || !/^[0-9a-f]+$/.test(threshold)) {
    throw new DatabaseOperationError("Accepted backer threshold is invalid.");
  }
  const baks = reger.baks.get(key), toad = Number(BigInt(`0x${threshold}`));
  if (
    !Number.isSafeInteger(toad) || toad > baks.length || (baks.length > 0 && toad < 1)
    || new Set(baks).size !== baks.length
  ) throw new DatabaseOperationError("Accepted backer roster and threshold are inconsistent.");
  return { kind: "backers", toad, baks };
}
