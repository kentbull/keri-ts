/** Finite synchronous route capture; transfer its credit into the existing delivery owner. */
import { ResourceAdmissionError, ResourceLimitError, type ResourcePolicy, type ResourceReservation } from "cesr-ts";
import type { PreparedCueEmission } from "./cue-preparation.ts";
import type { RawCesrRoute } from "./forwarding.ts";

const routeBytes = 1024 ** 2, interpretationBytes = 24 * 1024 ** 2;

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

/**
 * Borrow the live cue owner's exact policy under its synchronous guarded turn.
 * Admit metadata before endpoint resolution; never open replay or wait here.
 * This finite logical allowance does not qualify native/decoded row allocations.
 */
export function prepareCueRoute(
  resources: ResourcePolicy,
  owner: PreparedCueEmission,
  resolve: () => RawCesrRoute,
  onAdmissionRefusal?: (error: ResourceAdmissionError) => void,
): PreparedCueRoute {
  const refuse: (error: ResourceAdmissionError) => never = (error) => {
    onAdmissionRefusal?.(error);
    throw error;
  };
  void owner.emission;
  if (owner.resourcePolicy !== resources) throw new RangeError("Cue route requires the owner's exact policy");
  if (owner.retainedBytes + interpretationBytes + routeBytes > resources.limits.bytes) {
    refuse(new ResourceAdmissionError("Cue route retention exceeds shared capacity", "limit"));
  }
  const admitted = resources.reserve({ bytes: routeBytes });
  if (admitted.kind === "refuse") refuse(new ResourceAdmissionError("Cue routes are busy", admitted.reason));
  try {
    const route = resolve();
    let size = 2 * (route.sender.length + route.recipient.length + route.topic.length);
    if (route.targets.length > 4096) throw new ResourceLimitError("Cue target count exceeds limit");
    for (const target of route.targets) size += 128 + 2 * (target.eid.length + target.url.length);
    if (size > routeBytes) throw new ResourceLimitError("Cue route metadata exceeds limit");
    return new PreparedCueRoute(route, admitted.reservation);
  } catch (error) {
    admitted.reservation.release();
    throw error;
  }
}
