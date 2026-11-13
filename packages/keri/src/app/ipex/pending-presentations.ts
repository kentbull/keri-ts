/**
 * Pure read of the Grants a disclosee holds pending until it fetches their registry proofs.
 *
 * A presentation Grant reaches the disclosee as a pending exchange: it is authenticated and stored, but
 * stays unfinished until `requestUnblind` completes the registry proofs behind it. This lists the pending
 * v2 Grants addressed to local identifiers whose deadline has not passed. An issuance Grant waiting for the
 * holder's exchange consent is pending in the same table; `pendingIssuanceGrants` names those, and a caller
 * that wants presentations only removes them.
 */
import { SerderACDC } from "cesr-ts";
import { ValidationError } from "../../core/errors.ts";
import type { Hab } from "../identity/habbing.ts";
import { type UnblindingOperations, type UnblindingStatus, unblindingStatus } from "./unblinding-workflow.ts";

/** A pending Grant addressed to a local identifier. */
export interface PendingPresentation {
  /** SAID of the Grant exchange. */
  grant: string;
  /** The local identifier it is addressed to. */
  disclosee: string;
  /** The AID that sent it. */
  presenter: string;
  /** SAID of the credential the Grant discloses, when its first node is one. */
  credential?: string;
  /** The Grant's exchange deadline (ISO 8601). */
  deadline: string;
  /** `active`: an Unblind is running for it; `interrupted`: none is, so consent is needed. */
  status: UnblindingStatus;
}

/**
 * The pending v2 Grants addressed to a local identifier (to `hab` when given) that are inside their deadline.
 * Mutates nothing.
 */
export function pendingPresentations(ops: UnblindingOperations, { hab }: { hab?: Hab } = {}): PendingPresentation[] {
  const { deps } = ops, found: PendingPresentation[] = [];
  for (const [[grant], serder] of [...deps.hby.db.epse.getTopItemIter()]) {
    const disclosee = serder.sad?.ri;
    if (serder.route !== "/ipex/grant" || serder.pvrsn.major < 2 || typeof disclosee !== "string") continue;
    if (!deps.hby.habs.has(disclosee) || (hab && hab.pre !== disclosee)) continue;
    try {
      const status = unblindingStatus(ops, grant);
      if (status.state !== "active" && status.state !== "interrupted") continue;
      const body = deps.exc.retainedInput(grant)?.nests?.[0]?.body;
      found.push({
        grant,
        disclosee,
        presenter: serder.pre!,
        credential: body instanceof SerderACDC ? body.said ?? undefined : undefined,
        deadline: deps.exc.exchangeDeadline(serder)!,
        status,
      });
    } catch (error) {
      // Not a Grant this runtime can unblind (no deadline): it is not pending here.
      if (!(error instanceof ValidationError)) throw error;
    }
  }
  return found;
}
