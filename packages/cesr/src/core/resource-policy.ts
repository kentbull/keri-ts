/** Framework-neutral shared admission; callers retain credit until their owners finish cleanup. */

/** Independently bounded runtime resources. Byte credit includes copies charged by each integration. */
export interface ResourceLimits {
  bytes: number;
  streams: number;
  decryptions: number;
}

/** Explicit credit held by one owner; releasing twice is harmless. */
export interface ResourceReservation {
  release(): void;
}

/** Oversize work cannot fit this configuration; occupied capacity may become available later. */
export type ResourceDecision =
  | { kind: "reserve"; reservation: ResourceReservation }
  | { kind: "refuse"; reason: "limit" | "busy"; resource: keyof ResourceLimits };

const dimensions = ["bytes", "streams", "decryptions"] as const;
const defaults: Readonly<ResourceLimits> = { bytes: 256 * 1024 ** 2, streams: 2, decryptions: 1 };

/**
 * One synchronous reservation ledger shared by cooperating runtime components.
 * Admission is atomic across dimensions and never queues work. It does not itself
 * allocate, cancel, dispose, or authenticate anything; integrations own those steps.
 */
export class ResourcePolicy {
  readonly limits: Readonly<ResourceLimits>;
  private readonly held: ResourceLimits = { bytes: 0, streams: 0, decryptions: 0 };

  constructor(limits: Partial<ResourceLimits> = {}) {
    const selected = { ...defaults, ...limits };
    for (const dimension of dimensions) {
      if (!Number.isSafeInteger(selected[dimension]) || selected[dimension] < 0) {
        throw new RangeError(`Invalid resource capacity: ${dimension}`);
      }
    }
    this.limits = Object.freeze(selected);
  }

  /** Return a detached observation; callers cannot mutate the live accounting. */
  get used(): Readonly<ResourceLimits> {
    return Object.freeze({ ...this.held });
  }

  /** Reserve before reading/allocating; invalid or empty requests are caller-contract errors. */
  reserve(request: Partial<ResourceLimits>): ResourceDecision {
    const charge = { bytes: 0, streams: 0, decryptions: 0, ...request };
    for (const dimension of dimensions) {
      if (!Number.isSafeInteger(charge[dimension]) || charge[dimension] < 0) {
        throw new RangeError(`Invalid resource charge: ${dimension}`);
      }
    }
    if (dimensions.every((dimension) => charge[dimension] === 0)) {
      throw new RangeError("A resource reservation must hold credit");
    }
    // Configuration refusal takes precedence over temporary contention in another dimension.
    for (const dimension of dimensions) {
      if (charge[dimension] > this.limits[dimension]) {
        return { kind: "refuse", reason: "limit", resource: dimension };
      }
    }
    for (const dimension of dimensions) {
      if (charge[dimension] > this.limits[dimension] - this.held[dimension]) {
        return { kind: "refuse", reason: "busy", resource: dimension };
      }
    }
    for (const dimension of dimensions) this.held[dimension] += charge[dimension];
    let released = false;
    return {
      kind: "reserve",
      reservation: {
        release: () => {
          if (released) return;
          released = true;
          for (const dimension of dimensions) this.held[dimension] -= charge[dimension];
        },
      },
    };
  }
}
