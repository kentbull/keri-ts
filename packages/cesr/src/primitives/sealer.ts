import { UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import type { Versionage } from "../tables/table-types.ts";
import { SEALER_CODES } from "../tables/counter-groups.ts";
import type { CounterGroupLike } from "./primitive.ts";
import { parseStructor, Structor } from "./structor.ts";

/** True when counter code belongs to KERI seal source/digest families. */
export function isSealerCode(code: string): boolean {
  return SEALER_CODES.has(code);
}

/**
 * Seal-group structor primitive.
 *
 * KERIpy substance: `Sealer` materializes counted seal tuple groups used for
 * anchoring, seal-source references, and registrar-binding payloads.
 */
export class Sealer extends Structor {
  constructor(init: Structor | ConstructorParameters<typeof Structor>[0]) {
    const structor = init instanceof Structor ? init : new Structor(init);
    super(structor);
    if (!isSealerCode(this.code)) {
      throw new UnknownCodeError(
        `Expected sealer group code, got ${this.code}`,
      );
    }
  }

  /** Hydrate a `Sealer` from an already parsed counter-group node. */
  static override fromGroup(
    group: CounterGroupLike,
    sourceDomain: Extract<ColdCode, "txt" | "bny"> = "txt",
  ): Sealer {
    return new Sealer({ group, sourceDomain });
  }
}

/** Parse and validate seal attachment groups across v1/v2 seal families. */
export function parseSealer(
  input: Uint8Array,
  version: Versionage,
  cold: Extract<ColdCode, "txt" | "bny">,
): Sealer {
  return new Sealer(
    parseStructor(input, version, cold, SEALER_CODES, "sealer"),
  );
}
