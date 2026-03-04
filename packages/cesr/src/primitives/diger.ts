import { UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import { MATTER_CODE_NAMES } from "../tables/matter.tables.generated.ts";
import { DIGEST_CODES } from "./codex.ts";
import { Matter, type MatterInit, parseMatter } from "./matter.ts";

interface DigerOptions {
  strict?: boolean;
}

/**
 * Digest primitive family.
 *
 * KERIpy substance: `Diger` encapsulates self-addressing digest material and
 * optionally constrains codes to digest codex membership (`strict=true`).
 */
export class Diger extends Matter {
  constructor(init: Matter | MatterInit, options: DigerOptions = {}) {
    const matter = init instanceof Matter ? init : new Matter(init);
    super(matter);
    if ((options.strict ?? true) && !DIGEST_CODES.has(this.code)) {
      throw new UnknownCodeError(`Expected digest code, got ${this.code}`);
    }
  }

  get digest(): Uint8Array {
    return this.raw;
  }

  get algorithm(): string {
    return MATTER_CODE_NAMES[this.code as keyof typeof MATTER_CODE_NAMES] ??
      "UnknownDigest";
  }
}

/** Parse and hydrate `Diger` from txt/qb2 bytes. */
export function parseDiger(
  input: Uint8Array,
  cold: Extract<ColdCode, "txt" | "bny">,
): Diger {
  return new Diger(parseMatter(input, cold));
}
