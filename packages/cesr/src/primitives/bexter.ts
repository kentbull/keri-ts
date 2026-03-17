import { decodeB64, encodeB64 } from "../core/bytes.ts";
import { UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import { MATTER_SIZES } from "../tables/matter.tables.generated.ts";
import { BEXTER_CODES } from "./codex.ts";
import { Matter, type MatterInit, parseMatter } from "./matter.ts";

/** Resolve lead-byte width (`ls`) used by StrB64 code family conversions. */
function getLeadSize(code: string): number {
  const sizage = MATTER_SIZES.get(code);
  if (!sizage) {
    throw new UnknownCodeError(`Unknown bexter code ${code}`);
  }
  return sizage.ls;
}

/** True when code belongs to KERIpy `BextCodex`/StrB64 family. */
export function isBexterCode(code: string): boolean {
  return BEXTER_CODES.has(code);
}

/**
 * CESR Base64-text primitive (`bext`) with compact StrB64 encoding.
 *
 * KERIpy correspondence:
 * - mirrors the `Bexter`/StrB64 family contract: payload text is already
 *   restricted to Base64 URL-safe characters, so the qualified form can be more
 *   compact than generic UTF-8 text primitives
 *
 * Invariant:
 * - `code` must belong to the StrB64/Bexter codex family
 */
export class Bexter extends Matter {
  /** Convert bext text into CESR raw payload bytes. */
  static rawify(bext: string): Uint8Array {
    const ts = bext.length % 4;
    const ws = (4 - ts) % 4;
    const ls = (3 - ts) % 3;
    return decodeB64("A".repeat(ws) + bext).slice(ls);
  }

  /** Decode CESR raw payload bytes back into bext text. */
  static derawify(raw: Uint8Array, code: string): string {
    const ls = getLeadSize(code);
    const bext = encodeB64(new Uint8Array([...new Uint8Array(ls), ...raw]));
    const ws = ls === 0 && bext.startsWith("A") ? 1 : (ls + 1) % 4;
    return bext.slice(ws);
  }

  constructor(init: Matter | MatterInit) {
    const matter = init instanceof Matter ? init : new Matter(init);
    super(matter);
    if (!isBexterCode(this.code)) {
      throw new UnknownCodeError(
        `Expected bexter strb64 code, got ${this.code}`,
      );
    }
  }

  /** Base64 text payload value without CESR code prefix. */
  get bext(): string {
    return Bexter.derawify(this.raw, this.code);
  }
}

/**
 * Parse and hydrate a `Bexter` from txt/qb2 bytes.
 *
 * Boundary contract: parser chooses domain from `cold`, while this constructor
 * enforces codex membership and exposes semantic `bext` accessors.
 */
export function parseBexter(
  input: Uint8Array,
  cold: Extract<ColdCode, "txt" | "bny">,
): Bexter {
  return new Bexter(parseMatter(input, cold));
}
