import { UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import { BLINDER_CODES } from "../tables/counter-groups.ts";
import type { Versionage } from "../tables/table-types.ts";
import type { CounterGroupLike } from "./primitive.ts";
import { parseStructor, Structor } from "./structor.ts";

/** True when counter code belongs to blinded/bound state tuple families. */
export function isBlinderCode(code: string): boolean {
  return BLINDER_CODES.has(code);
}

/**
 * Blinded-state structor primitive.
 *
 * KERIpy substance: `Blinder` materializes blinded/bound state tuple groups
 * used for blindable ACDC/TEL state disclosures.
 */
export class Blinder extends Structor {
  constructor(init: Structor | ConstructorParameters<typeof Structor>[0]) {
    const structor = init instanceof Structor ? init : new Structor(init);
    super(structor);
    if (!isBlinderCode(this.code)) {
      throw new UnknownCodeError(
        `Expected blinder group code, got ${this.code}`,
      );
    }
  }

  /** Hydrate a `Blinder` from an already parsed counter-group node. */
  static override fromGroup(
    group: CounterGroupLike,
    sourceDomain: Extract<ColdCode, "txt" | "bny"> = "txt",
  ): Blinder {
    return new Blinder({ group, sourceDomain });
  }
}

/** Parse and validate blinded-state attachment groups. */
export function parseBlinder(
  input: Uint8Array,
  version: Versionage,
  cold: Extract<ColdCode, "txt" | "bny">,
): Blinder {
  return new Blinder(
    parseStructor(input, version, cold, BLINDER_CODES, "blinder"),
  );
}
