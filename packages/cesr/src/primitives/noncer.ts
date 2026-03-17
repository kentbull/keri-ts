import { UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import { NONCE_CODES, NonceDex } from "./codex.ts";
import { Diger } from "./diger.ts";
import { Matter, type MatterInit, parseMatter } from "./matter.ts";

/**
 * Nonce primitive for UUID/salt-or-digest nonce representations.
 *
 * KERIpy semantics: `Noncer` subclasses `Diger` with relaxed digest-code
 * enforcement and validates membership in `NonceCodex` (including `Empty`).
 */
export class Noncer extends Diger {
  constructor(init: Matter | MatterInit) {
    super(init, { strict: false });
    if (!NONCE_CODES.has(this.code)) {
      throw new UnknownCodeError(`Expected nonce code, got ${this.code}`);
    }
  }

  /**
   * Roundtrippable nonce text.
   *
   * Mirrors KERIpy behavior: empty nonce is represented as empty string when
   * code is `Empty`; otherwise returns qualified qb64 nonce token.
   */
  get nonce(): string {
    return this.code === NonceDex.Empty ? "" : this.qb64;
  }

  /** Binary companion to `.nonce` with empty-bytes behavior for `Empty` code. */
  get nonceb(): Uint8Array {
    return this.code === NonceDex.Empty ? new Uint8Array() : this.qb64b;
  }
}

/** Parse and hydrate `Noncer` from txt/qb2 bytes. */
export function parseNoncer(
  input: Uint8Array,
  cold: Extract<ColdCode, "txt" | "bny">,
): Noncer {
  return new Noncer(parseMatter(input, cold));
}
