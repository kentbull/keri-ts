/** Finite synchronous route capture; transfer its credit into the existing delivery owner. */
import { ResourceAdmissionError, ResourceLimitError, type ResourcePolicy, type ResourceReservation } from "cesr-ts";
import { cueDeliveryBudget } from "./cue-budget.ts";
import type { PreparedCueEmission } from "./cue-preparation.ts";
import type { RawCesrRoute } from "./forwarding.ts";

const { routeBytes, preparationBytes } = cueDeliveryBudget;

/** Borrow captured routing only while its independent metadata credit remains live. */
export class PreparedCueRoute {
  constructor(private value: RawCesrRoute | undefined, private readonly credit: ResourceReservation) {}
  get route(): RawCesrRoute {
    if (!this.value) throw new Error("Cue route owner is released");
    return this.value;
  }
  release(): void {
    this.value = undefined;
    this.credit.release();
  }
}

/** Strict route capture for callers whose policy is to fail on occupied capacity. */
export function prepareCueRoute(
  resources: ResourcePolicy,
  owner: PreparedCueEmission,
  resolve: () => RawCesrRoute,
  onAdmissionRefusal?: (error: ResourceAdmissionError) => void,
): PreparedCueRoute {
  const result = admitCueRoute(resources, owner, resolve);
  if (result.kind === "refuse") {
    onAdmissionRefusal?.(result.error);
    throw result.error;
  }
  return result.route;
}

/**
 * Borrow the live cue owner's exact policy under its synchronous guarded turn.
 * Admit metadata before endpoint resolution; never open replay or wait here.
 * This finite logical allowance does not qualify native/decoded row allocations.
 */
export function admitCueRoute(
  resources: ResourcePolicy,
  owner: PreparedCueEmission,
  resolve: () => RawCesrRoute,
): { kind: "route"; route: PreparedCueRoute } | { kind: "refuse"; error: ResourceAdmissionError } {
  void owner.emission;
  if (owner.resourcePolicy !== resources) throw new RangeError("Cue route requires the owner's exact policy");
  if (owner.retainedBytes + preparationBytes + routeBytes > resources.limits.bytes) {
    return {
      kind: "refuse",
      error: new ResourceAdmissionError("Cue route retention exceeds shared capacity", "limit"),
    };
  }
  const admitted = resources.reserve({ bytes: routeBytes });
  if (admitted.kind === "refuse") {
    return { kind: "refuse", error: new ResourceAdmissionError("Cue routes are busy", admitted.reason) };
  }
  try {
    const route = resolve();
    let size = 2 * (route.sender.length + route.recipient.length + route.topic.length);
    if (route.targets.length > 4096) throw new ResourceLimitError("Cue target count exceeds limit");
    for (const target of route.targets) size += 128 + 2 * (target.eid.length + target.url.length);
    if (size > routeBytes) throw new ResourceLimitError("Cue route metadata exceeds limit");
    return { kind: "route", route: new PreparedCueRoute(route, admitted.reservation) };
  } catch (error) {
    admitted.reservation.release();
    throw error;
  }
}
