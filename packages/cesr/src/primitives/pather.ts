import { UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import { BEXTER_CODES, TEXTER_CODES } from "./codex.ts";
import { Bexter } from "./bexter.ts";
import { Matter, type MatterInit, parseMatter } from "./matter.ts";
import { t } from "../core/bytes.ts";

function isPatherCode(code: string): boolean {
  return BEXTER_CODES.has(code) || TEXTER_CODES.has(code);
}

/**
 * CESR path primitive for SAD traversal routes.
 *
 * KERIpy semantics: path strings may be compactly encoded via StrB64 family
 * (`-` separators, optional `--` escape prefix) or carried as raw bytes.
 */
export class Pather extends Matter {
  constructor(init: Matter | MatterInit) {
    const matter = init instanceof Matter ? init : new Matter(init);
    super(matter);
    if (!isPatherCode(this.code)) {
      throw new UnknownCodeError(
        `Expected pather-compatible code, got ${this.code}`,
      );
    }
  }

  /** Decoded `/`-separated path form regardless of underlying CESR code family. */
  get path(): string {
    if (BEXTER_CODES.has(this.code)) {
      const bext = Bexter.derawify(this.raw, this.code).replace(/^--/, "");
      return bext.split("-").join("/");
    }
    return t(this.raw);
  }
}

/** Parse and hydrate a `Pather` from txt/qb2 bytes. */
export function parsePather(
  input: Uint8Array,
  cold: Extract<ColdCode, "txt" | "bny">,
): Pather {
  return new Pather(parseMatter(input, cold));
}
