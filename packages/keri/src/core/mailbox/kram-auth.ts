/** Internal KRAM source authentication; orchestration owns missing-state queries. */
import type { SealSource } from "cesr-ts";
import type { Baser } from "../../db/basing.ts";
import type { KeriDispatchEnvelope } from "../dispatch.ts";

/** Known invalid sources may permit signature fallback; missing state must block it. */
export type KramSourceDecision =
  | { kind: "valid" }
  | { kind: "invalid"; reason: "noSource" | "digestMismatch" | "noAnchor" }
  | { kind: "missing"; sender: string; sn: bigint };

/**
 * Authenticate the parent body against the last sender source reference.
 * Frozen KERIpy candidates are all couples, then sender-matching triples.
 * Only the last candidate's accepted KEL digest and message-SAID seal matter.
 * Borrow evidence without changing foreign triples or authenticating children.
 * Preserve exact missing coordinates beyond the database's safe-number range;
 * infrastructure/corrupt-state failures propagate to the orchestration owner.
 */
export function authenticateKramSource(db: Baser, envelope: KeriDispatchEnvelope): KramSourceDecision {
  const sender = envelope.serder.pre, message = envelope.serder.said;
  if (!sender || !message) throw new Error("KRAM source authentication requires sender and message SAID");
  let source: Pick<SealSource, "s" | "d"> | undefined = envelope.sscs.at(-1);
  for (const triple of envelope.ssts) if (triple.i.qb64 === sender) source = triple;
  if (!source) return { kind: "invalid", reason: "noSource" };
  const sn = source.s.num;
  if (sn > BigInt(Number.MAX_SAFE_INTEGER)) return { kind: "missing", sender, sn };
  const said = db.kels.getLast(sender, Number(sn));
  if (!said) return { kind: "missing", sender, sn };
  if (said !== source.d.qb64) return { kind: "invalid", reason: "digestMismatch" };
  const event = db.getEvtSerder(sender, said);
  if (!event) return { kind: "missing", sender, sn };
  const anchored = event.seals.some((seal) =>
    seal && typeof seal === "object" && !Array.isArray(seal) && "d" in seal && seal.d === message
  );
  return anchored ? { kind: "valid" } : { kind: "invalid", reason: "noAnchor" };
}
