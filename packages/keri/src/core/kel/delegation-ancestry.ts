/**
 * Read-only delegation ancestry over accepted KEL evidence.
 *
 * KERIpy correspondence: `core.eventing.delegationRefusal` and
 * `Kevery.isDelegated` (upstream PR 1757, formerly `acdc.relating`). ACDC
 * DI2I/DI1I edges ask this KEL question; they do not own it.
 */
import type { SerderKERI } from "cesr-ts";
import type { Baser } from "../../db/basing.ts";
import { dgKey } from "../../db/core/keys.ts";
import { ValidationError } from "../errors.ts";
import { readEventSeal } from "../wire-fields.ts";

/**
 * `pending` evidence can still arrive; `refused` is fixed by inception and
 * cannot be repaired by retrying.
 */
export type DelegationAncestry =
  | { kind: "valid" }
  | { kind: "pending"; reason: string }
  | { kind: "refused"; reason: string };

/**
 * Whether one accepted delegator event carries the exact `{i,s,d}` seal of a delegated inception.
 *
 * The delegator's seals are remote-authored and unchecked at acceptance; other shapes and undecodable values are
 * skipped (`readEventSeal`), never thrown.
 */
function approves(event: SerderKERI, dip: SerderKERI): boolean {
  return event.seals.some((raw) => {
    const seal = readEventSeal(raw);
    return seal !== null && seal.i.qb64 === dip.pre && seal.s.numh === dip.snh && seal.d.qb64 === dip.said;
  });
}

/**
 * Find the delegator's accepted approval of `dip`.
 *
 * The aess source couple is a fast path only when it names a first-seen event
 * that actually carries the dip seal; protected intake can retain an unverified
 * hint, which neither grants authority nor vetoes a later genuine approval.
 * Otherwise any first-seen delegator event carrying the seal is accepted,
 * including one superseded since, so cached and uncached validators agree.
 */
function acceptedApproval(db: Baser, delegator: string, dip: SerderKERI): SerderKERI | null {
  const source = db.aess.get(dgKey(dip.pre!, dip.said!));
  if (source) {
    const digest = source[1].qb64;
    if (db.fons.get(dgKey(delegator, digest))) {
      const approval = db.getEvtSerder(delegator, digest);
      if (!approval) throw new ValidationError(`Missing first-seen delegation event ${delegator}:${digest}.`);
      if (approves(approval, dip)) return approval;
    }
  }
  for (const [, , said] of db.fels.getAllItemIter(delegator)) {
    if (!db.fons.get(dgKey(delegator, said))) continue;
    const event = db.getEvtSerder(delegator, said);
    if (event && approves(event, dip)) return event;
  }
  return null;
}

/**
 * Resolve whether `pre` is an anchored delegated descendant of `ancestor`, at any depth.
 *
 * Every hop requires the delegate's fixed dip, the delegator's inception
 * permission (DND is checked before the anchor) and an accepted delegator
 * approval of that dip. Identity (`pre === ancestor`) is not delegation; the
 * DI2I/DI1I callers own that widening.
 *
 * Security rationale, preserved from KERIpy's `relating.delegationRefusal`:
 * - The delegate's own `di` (Kever.delpre) is a self-assertion. Local, member
 *   or witness acceptance can admit a dip whose delegator never anchored it, so
 *   only the delegator's anchored approval seal records actual authority.
 * - DND is re-read from the delegator's accepted inception, not mutable state,
 *   because that same exemption can admit dips a disinterested validator would
 *   refuse; identical bytes must not get opposite verdicts by host topology.
 * - Only the dip anchor matters. A delegation is settled at inception; later
 *   delegate rotations, delegator rotations, witness changes and retirement do
 *   not renew or revoke it.
 * - No depth bound: a delegated prefix digests its own dip, so a cycle implies
 *   a hash cycle. The visited set only terminates corrupt local state.
 *
 * Unlike KERIpy, lookup never repairs aess; accepted KEL intake owns those writes.
 * An aess couple naming a first-seen event that is absent from `evts` is
 * corrupt durable state and throws.
 */
export function delegationAncestry(db: Baser, pre: string, ancestor: string): DelegationAncestry {
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

    if (!acceptedApproval(db, parent, dip)) {
      return { kind: "pending", reason: `Missing accepted delegation approval for ${pre} from ${parent}.` };
    }
    if (parent === ancestor) return { kind: "valid" };
    pre = parent;
  }
  return { kind: "refused", reason: `Delegation chain cycles at ${pre}.` };
}
