import { UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import { CIGAR_CODES, matterCodexName } from "./codex.ts";
import { Matter, type MatterInit, parseMatter } from "./matter.ts";
import type { Verfer } from "./verfer.ts";

/**
 * Non-indexed signature primitive.
 *
 * KERIpy substance: `Cigar` wraps detached signature material where code
 * determines signature suite and payload holds raw signature bytes.
 *
 * Runtime note:
 * - `.verfer` is contextual verifier metadata attached by signing, dispatch,
 *   or DB-rehydration code
 * - it is not encoded inside the cigar bytes themselves
 */
export class Cigar extends Matter {
  /** Optional verifier context for the key that created this detached signature. */
  readonly verfer?: Verfer;

  constructor(init: Matter | MatterInit, verfer?: Verfer) {
    super(init);
    if (!CIGAR_CODES.has(this.code)) {
      throw new UnknownCodeError(
        `Expected non-indexed signature code, got ${this.code}`,
      );
    }
    this.verfer = verfer;
  }

  /** Raw detached signature bytes. */
  get sig(): Uint8Array {
    return this.raw;
  }

  /** Human-oriented generated codex member name for diagnostics and tooling. */
  get algorithm(): string {
    return matterCodexName(this.code) ?? "UnknownSig";
  }
}

/** Parse and hydrate `Cigar` from txt/qb2 bytes. */
export function parseCigar(
  input: Uint8Array,
  cold: Extract<ColdCode, "txt" | "bny">,
): Cigar {
  return new Cigar(parseMatter(input, cold));
}
