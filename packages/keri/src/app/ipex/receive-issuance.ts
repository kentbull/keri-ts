/**
 * The holder's side of a credential, as workflows a host calls instead of sequencing the library itself.
 *
 * - {@link admitAndDeliver}: the Admit consent, the host's one step between accepting the Admit and sending it
 *   (`onAdmitted`: a wallet records its consent in its inventory there), and delivery within a budget. It
 *   works for any accepted v2 Grant, so a host that never ran the DH exchange uses it alone.
 * - {@link receiveIssuance}: the whole individual path for a pending Grant: approve the DH exchange, wait for the
 *   issuer to finish it, then {@link admitAndDeliver}. Calling it again for a Grant that timed out resumes at
 *   the step it reached.
 *
 * Both follow the workflow contract: they may sign (the consents), never wait on a remote without a budget, and
 * return remote and time-driven outcomes as values. Group identifiers use the group paths in `group-issuance.ts`.
 */
import type { Versionage } from "cesr-ts";
import type { Operation } from "npm:effection@^3.6.0";
import { race } from "npm:effection@^3.6.0";
import { ValidationError } from "../../core/errors.ts";
import { waitOnClock } from "../runtime/workflow-contract.ts";
import type { WitnessAuthMap } from "../witness/receipting.ts";
import {
  type AdmitDeps,
  admitIssuance,
  approveIssuanceExchange,
  deliverIssuanceAdmit,
  type IssuanceAdmit,
  type IssuanceEndState,
  type IssuanceOperations,
  type IssuanceStatus,
  issuanceStatus,
  waitForIssuance,
} from "./issuance.ts";

/** Default budget of delivering an Admit, in milliseconds. */
export const ADMIT_DELIVERY_TIMEOUT_MS = 30_000;

/** The host's step between accepting the Admit locally and delivering it. It runs once, before delivery. */
export type OnAdmitted = (admitted: IssuanceAdmit) => Operation<void>;

/** Whether the Admit reached the issuer. The Admit is accepted locally either way. */
export type AdmitDeliveryOutcome = { state: "delivered"; to: string[] } | { state: "undelivered"; reason: string };

/** Inputs of {@link admitAndDeliver}. */
export interface AdmitAndDeliverInput {
  /** SAID of the accepted Grant; the holder is its recipient. */
  grant: string;
  message?: string;
  gvrsn?: Versionage;
  auths?: WitnessAuthMap;
  /** False when the caller takes the signed bytes itself (a file) and nothing is sent. Default true. */
  deliver?: boolean;
  /** Budget of the delivery. Default {@link ADMIT_DELIVERY_TIMEOUT_MS}. */
  deliveryTimeoutMs?: number;
  onAdmitted?: OnAdmitted;
}

/** What {@link admitAndDeliver} reports: the signed Admit and what delivery did. */
export interface AdmitAndDeliverOutcome {
  admitted: IssuanceAdmit;
  /** `undelivered` with the reason when delivery was not asked for, failed or ran out of budget. */
  delivery: AdmitDeliveryOutcome;
}

/** How a delivery of `deliver: false` reads. */
const NOT_DELIVERED = "Delivery was not requested.";

/**
 * Sign and accept the Admit, run `onAdmitted`, then deliver within the budget. A failed or expired delivery is a
 * value; the Admit stays accepted and `rebuildIssuanceAdmit` can send it again.
 *
 * @throws ValidationError as {@link admitIssuance} does, and whatever `onAdmitted` throws.
 */
export function* admitAndDeliver(deps: AdmitDeps, input: AdmitAndDeliverInput): Operation<AdmitAndDeliverOutcome> {
  const { grant, message, gvrsn, auths, onAdmitted } = input;
  const admitted = yield* admitIssuance(deps, grant, { message, gvrsn, auths });
  // The host's record precedes delivery: whatever happens to the network, its consent is on record.
  if (onAdmitted) yield* onAdmitted(admitted);
  if (input.deliver === false) return { admitted, delivery: { state: "undelivered", reason: NOT_DELIVERED } };
  const budget = input.deliveryTimeoutMs ?? ADMIT_DELIVERY_TIMEOUT_MS;
  const expired: AdmitDeliveryOutcome = {
    state: "undelivered",
    reason: `Delivery did not finish within ${budget} ms.`,
  };
  try {
    const delivery = yield* race([
      (function*(): Operation<AdmitDeliveryOutcome> {
        return { state: "delivered", to: yield* deliverIssuanceAdmit(deps.delivery, admitted) };
      })(),
      (function*(): Operation<AdmitDeliveryOutcome> {
        yield* waitOnClock(deps.clock, budget);
        return expired;
      })(),
    ]);
    return { admitted, delivery };
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return { admitted, delivery: { state: "undelivered", reason: error.message } };
  }
}

/** Inputs of {@link receiveIssuance}. */
export interface ReceiveIssuanceInput extends AdmitAndDeliverInput {
  /** Budget of the wait for the issuer to finish the exchange. */
  timeoutMs: number;
}

/** A terminal state of an issuance other than completion. */
export type EndedIssuanceStatus = Extract<IssuanceStatus, { state: IssuanceEndState }>;

/** Result of {@link receiveIssuance}. */
export type ReceiveIssuanceOutcome = AdmittedIssuance | EndedIssuance | TimedOutIssuance;

/**
 * The credential is admitted. `admit` is the Admit's SAID. `admitted` carries the signed bytes of this call's
 * Admit, and is absent when an earlier call admitted the Grant (then `delivery` is `undelivered` and says so).
 */
export interface AdmittedIssuance {
  outcome: "admitted";
  grant: string;
  admit: string;
  admitted?: IssuanceAdmit;
  delivery: AdmitDeliveryOutcome;
}

/** The exchange stopped before an Admit. */
export interface EndedIssuance {
  outcome: "ended";
  grant: string;
  status: EndedIssuanceStatus;
}

/** The issuer has not finished within `timeoutMs`; the operation is live and calling again resumes it. */
export interface TimedOutIssuance {
  outcome: "timed-out";
  grant: string;
  timeoutMs: number;
  status: IssuanceStatus;
}

/**
 * The individual holder's whole path for a Grant addressed to a local identifier: approve the DH exchange when it is pending,
 * wait for the issuer to finish it, then admit and deliver ({@link admitAndDeliver}).
 *
 * @throws ValidationError for a Grant that is not addressed to a local identifier, one this runtime issued, or a
 * group identifier.
 */
export function* receiveIssuance(
  ops: IssuanceOperations,
  input: ReceiveIssuanceInput,
): Operation<ReceiveIssuanceOutcome> {
  const { grant, timeoutMs } = input, { deps } = ops;
  const first = issuanceStatus(ops, grant);
  if (first.role === "issuer") throw new ValidationError("This Grant was issued by this runtime.");
  if (first.state === "active" && first.needs === "exchange") approveIssuanceExchange(ops, grant);
  const waited = yield* waitForIssuance(ops, grant, {
    timeoutMs,
    until: (status) => status.state !== "active" || status.needs === "admit",
  });
  const { status } = waited;
  if (waited.outcome === "timed-out") return { outcome: "timed-out", grant, timeoutMs, status };
  if (status.state === "done") {
    const admit = deps.hby.db.erpy.get([grant])!.qb64;
    return {
      outcome: "admitted",
      grant,
      admit,
      delivery: { state: "undelivered", reason: "Admitted by an earlier call; rebuild and send it to deliver again." },
    };
  }
  if (status.state !== "active") return { outcome: "ended", grant, status };
  const done = yield* admitAndDeliver(deps, input);
  return {
    outcome: "admitted",
    grant,
    admit: done.admitted.admit.said!,
    admitted: done.admitted,
    delivery: done.delivery,
  };
}
