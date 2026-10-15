/** Finite logical allowances shared by cue interpretation, routing and delivery; not native heap bounds. */
const wireBytes = 8 * 1024 ** 2;
const preparationBytes = 3 * wireBytes;
const routeBytes = 1024 ** 2;

/** Preparation may coexist with retained wire and routing; all callers use the same cost knowledge. */
export const cueDeliveryBudget = {
  wireBytes,
  preparationBytes,
  routeBytes,
  preparationFloorBytes: wireBytes + preparationBytes,
} as const;
