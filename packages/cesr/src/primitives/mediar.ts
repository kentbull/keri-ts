import { UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import type { Versionage } from "../tables/table-types.ts";
import { MEDIAR_CODES } from "../tables/counter-groups.ts";
import type { CounterGroupLike } from "./primitive.ts";
import { parseStructor, Structor } from "./structor.ts";

/** True when counter code belongs to typed-media tuple families. */
export function isMediarCode(code: string): boolean {
  return MEDIAR_CODES.has(code);
}

/**
 * Typed-media structor primitive.
 *
 * KERIpy substance: `Mediar` materializes media metadata/value tuple groups
 * used in blinded media attachments and related CESR payload envelopes.
 */
export class Mediar extends Structor {
  constructor(init: Structor | ConstructorParameters<typeof Structor>[0]) {
    const structor = init instanceof Structor ? init : new Structor(init);
    super(structor);
    if (!isMediarCode(this.code)) {
      throw new UnknownCodeError(
        `Expected mediar group code, got ${this.code}`,
      );
    }
  }

  /** Hydrate a `Mediar` from an already parsed counter-group node. */
  static override fromGroup(
    group: CounterGroupLike,
    sourceDomain: Extract<ColdCode, "txt" | "bny"> = "txt",
  ): Mediar {
    return new Mediar({ group, sourceDomain });
  }
}

/** Parse and validate typed-media attachment groups. */
export function parseMediar(
  input: Uint8Array,
  version: Versionage,
  cold: Extract<ColdCode, "txt" | "bny">,
): Mediar {
  return new Mediar(
    parseStructor(input, version, cold, MEDIAR_CODES, "mediar"),
  );
}
