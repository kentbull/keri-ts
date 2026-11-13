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
import { timestampMicros } from "../../time/mod.ts";
import type { Exchanger } from "../exchanges/exchanging.ts";
import type { Hab, Habery } from "../identity/habbing.ts";
import type { RuntimeClock } from "../runtime/runtime-clock.ts";
import { type DisclosurePlan, singleDagDisclosurePlan } from "./ipex-graph.ts";
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

/** Whether an Apply still waits for an answer or already has one. */
export type ApplyState = "pending" | "answered";

/** An accepted Apply addressed to a local identifier: unanswered (`pending`), or answered by the exchange `answer`. */
export interface PendingApply {
  /** SAID of the Apply exchange. */
  apply: string;
  /** The local identifier it is addressed to. */
  holder: string;
  /** The AID that sent it. */
  applicant: string;
  /** The Apply's message text. */
  message: string;
  /** The disclosure the applicant asks for; empty when the Apply names none. */
  plan: DisclosurePlan;
  /** The Apply's exchange deadline (ISO 8601); null when KRAM is off, so the exchange has no lifetime. */
  deadline: string | null;
  state: ApplyState;
  /** SAID of the exchange that answered it (an Offer or a Spurn); null while `pending`. */
  answer: string | null;
}

/** Choices of {@link pendingApplies}. */
export interface ApplyListOptions {
  /** Only the Applies addressed to this identifier. */
  hab?: Hab;
  /** Also list the Applies an exchange has answered, whatever their deadline; each says so in its `state`. */
  includeAnswered?: boolean;
}

/**
 * The accepted v2 Applies addressed to a local identifier (to `hab` when given) that no exchange has answered
 * (no `erpy` pointer) and whose deadline has not passed; with `includeAnswered`, the answered ones too. Mutates
 * nothing. A group member lists the Applies of its group once the group has accepted them. The deadline is the
 * Apply's own stamp plus the exchange window once KRAM has pruned its cache row, so an expired Apply stays
 * omitted after the prune.
 */
export function pendingApplies(
  deps: { readonly hby: Habery; readonly exc: Exchanger; readonly clock: RuntimeClock },
  { hab, includeAnswered = false }: ApplyListOptions = {},
): PendingApply[] {
  const { hby, exc, clock } = deps, found: PendingApply[] = [];
  const now = BigInt(clock.now()) * 1000n;
  for (const [[apply], serder] of [...hby.db.exns.getTopItemIter()]) {
    const holder = serder.sad?.ri;
    if (serder.route !== "/ipex/apply" || serder.pvrsn.major < 2 || typeof holder !== "string") continue;
    if (!hby.habs.has(holder) || (hab && hab.pre !== holder)) continue;
    if (!exc.complete(apply)) continue;
    const answer = hby.db.erpy.get([apply])?.qb64 ?? null;
    if (answer && !includeAnswered) continue;
    const deadline = exc.exchangeExpiry(apply), expiry = deadline ? timestampMicros(deadline) : null;
    if (!answer && expiry !== null && now >= expiry) continue;
    const q = serder.sad?.q as { dp?: unknown } | undefined;
    found.push({
      apply,
      holder,
      applicant: serder.pre!,
      message: String((serder.sad?.a as { m?: unknown } | undefined)?.m ?? ""),
      plan: singleDagDisclosurePlan(q?.dp) ?? [],
      deadline,
      state: answer ? "answered" : "pending",
      answer,
    });
  }
  return found;
}

/** The exchange that answered another: an Agree for an Offer, an Offer for an Apply, an Admit for a Grant. */
export interface ExchangeAnswer {
  /** SAID of the answering exchange. */
  answer: string;
  /** Its route, for example `/ipex/agree`. */
  route: string;
  /** The AID that sent it. */
  sender: string;
  /** Whether this runtime has accepted it (it may be stored and still awaiting its proofs). */
  accepted: boolean;
}

/** What answered the exchange `said`, from the answer pointer the stores keep; null when nothing has. Mutates nothing. */
export function exchangeAnswer(
  deps: { readonly hby: Habery; readonly exc: Exchanger },
  said: string,
): ExchangeAnswer | null {
  const answer = deps.hby.db.erpy.get([said])?.qb64, serder = answer ? deps.hby.db.exns.get([answer]) : null;
  if (!answer || !serder?.route) return null;
  return { answer, route: serder.route, sender: serder.pre!, accepted: deps.exc.complete(answer) };
}

/** The Agree that answers the Offer `offer`; null while nothing, or something other than an Agree (a Spurn), answered it. */
export function agreeFor(
  deps: { readonly hby: Habery; readonly exc: Exchanger },
  offer: string,
): ExchangeAnswer | null {
  const answer = exchangeAnswer(deps, offer);
  return answer?.route === "/ipex/agree" ? answer : null;
}
