import { UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import { PREFIX_CODES } from "./codex.ts";
import { Matter, type MatterInit, parseMatter } from "./matter.ts";

/**
 * Identifier-prefix primitive.
 *
 * KERIpy substance: `Prefixer` represents AID prefix material and accepts the
 * full KERI prefix derivation codex (`PreDex`), including transferable and
 * self-addressing derivation families.
 */
export class Prefixer extends Matter {
  constructor(init: Matter | MatterInit) {
    super(init);
    if (!PREFIX_CODES.has(this.code)) {
      throw new UnknownCodeError(`Expected prefix code, got ${this.code}`);
    }
  }

  get prefix(): string {
    return this.qb64;
  }
}

/** Parse and hydrate `Prefixer` from txt/qb2 bytes. */
export function parsePrefixer(
  input: Uint8Array,
  cold: Extract<ColdCode, "txt" | "bny">,
): Prefixer {
  return new Prefixer(parseMatter(input, cold));
}
