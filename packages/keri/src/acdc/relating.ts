/** KEL-backed ACDC relations; follows KERIpy 84301a9f's acdc.relating without verifier-owned writes. */
import { ValidationError } from "../core/errors.ts";
import type { Baser } from "../db/basing.ts";
import { dgKey } from "../db/core/keys.ts";

/** Missing evidence can arrive; inception-fixed refusals cannot be repaired by retrying. */
export type DelegationRelation =
  | { kind: "valid" }
  | { kind: "pending"; reason: string }
  | { kind: "refused"; reason: string };

/**
 * Resolve whether `pre` delegates upward to `delpre`, at any depth.
 * Each hop requires its fixed dip, the delegator's inception permission and an
 * accepted approval. Identity equality belongs to the caller's DI2I widening.
 * Cached first-seen approvals survive superseding; uncached lookup searches the
 * last accepted KEL events, matching Python's deliberate history asymmetry.
 * Unlike Python, lookup never repairs aess: accepted KEL intake owns those writes.
 */
export function delegationRelation(db: Baser, pre: string, delpre: string): DelegationRelation {
  const seen = new Set<string>();
  while (!seen.has(pre)) {
    seen.add(pre);
    const kever = db.getKever(pre);
    if (!kever) return { kind: "pending", reason: `Missing delegate KEL ${pre}.` };
    const parent = kever.delpre;
    if (!parent) return { kind: "refused", reason: `Delegation chain ends at ${pre}.` };
    if (!db.getKever(parent)) return { kind: "pending", reason: `Missing delegator KEL ${parent}.` };

    // Configuration is fixed at inception, including after delegator rotations.
    const inceptionSaid = db.kels.getLast(parent, 0);
    const inception = inceptionSaid ? db.getEvtSerder(parent, inceptionSaid) : null;
    if (!inception) return { kind: "pending", reason: `Missing delegator inception ${parent}.` };
    if (inception.traits.includes("DND")) return { kind: "refused", reason: `Delegator ${parent} carries DND.` };
    const dip = db.getEvtSerder(pre, pre);
    if (!dip) return { kind: "pending", reason: `Missing delegated inception ${pre}.` };

    // A cached approval names accepted history, not the current event at its ordinal.
    const source = db.aess.get(dgKey(pre, pre));
    if (source) {
      const digest = source[1].qb64;
      if (!db.fons.get(dgKey(parent, digest))) {
        return { kind: "pending", reason: `Missing accepted delegation approval ${parent}:${digest}.` };
      }
      const approval = db.getEvtSerder(parent, digest);
      if (!approval) throw new ValidationError(`Missing first-seen delegation event ${parent}:${digest}.`);
      // Protected intake can retain a raw hint. It neither grants authority nor vetoes a later genuine approval.
      if (
        !approval.eventSeals.some(seal => seal.i.qb64 === pre && seal.s.numh === dip.snh && seal.d.qb64 === dip.said)
        && !db.fetchLastSealingEventByEventSeal(parent, { i: pre, s: dip.snh, d: dip.said })
      ) {
        return { kind: "pending", reason: `Stored source does not approve delegated inception ${pre}.` };
      }
    } else if (!db.fetchLastSealingEventByEventSeal(parent, { i: pre, s: dip.snh, d: dip.said })) {
      return { kind: "pending", reason: `Missing delegation approval for ${pre} from ${parent}.` };
    }
    if (parent === delpre) return { kind: "valid" };
    pre = parent;
  }
  // Hash-linked inception ancestry cannot cycle; terminate corrupt local state without a protocol depth cap.
  return { kind: "refused", reason: `Delegation chain cycles at ${pre}.` };
}
