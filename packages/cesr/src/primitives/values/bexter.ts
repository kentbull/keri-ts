import { decodeB64, encodeB64 } from "../../core/bytes.ts";
import { UnknownCodeError } from "../../core/errors.ts";
import type { CesrDomain } from "../../core/types.ts";
import { MATTER_SIZES } from "../../tables/matter.tables.generated.ts";
import { BEXTER_CODES } from "../base/codex.ts";
import { Matter, type MatterInit, parseMatter } from "../base/matter.ts";

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
 * - escape a leading `-`, or a leading `A` when padding would be ambiguous
 * - callers owning another escape convention (Pather) disable `escapive`
 */
export class Bexter extends Matter {
  /** Whether semantic text uses KERIpy's leading-hyphen escape convention. */
  readonly escapive: boolean;

  /** Convert Base64-safe text to raw bytes, escaping before calculating padding. */
  static rawify(bext: string, escapive = true): Uint8Array {
    // Wrap to 0..3 leading sextets; already aligned text needs zero padding.
    let ws = (4 - bext.length % 4) % 4;
    if (escapive && (bext.startsWith("-") || (bext.startsWith("A") && (ws === 0 || ws === 1)))) {
      bext = `-${bext}`;
      ws = (4 - bext.length % 4) % 4;
    }
    const ts = bext.length % 4;
    // Discard the 0..2 whole bytes introduced by those leading zero sextets.
    const ls = (3 - ts) % 3;
    return decodeB64("A".repeat(ws) + bext).slice(ls);
  }

  /** Restore text by removing CESR padding first, then at most one escape. */
  static derawify(raw: Uint8Array, code: string, escapive = true): string {
    const ls = getLeadSize(code);
    const padded = new Uint8Array(ls + raw.length);
    padded.set(raw, ls);
    let bext = encodeB64(padded);
    // The code records byte padding; recover its sextet count before unescaping.
    const ws = ls === 0 ? (bext.startsWith("A") ? 1 : 0) : (ls + 1) % 4;
    bext = bext.slice(ws);
    return escapive && bext.startsWith("-") ? bext.slice(1) : bext;
  }

  /** Hydrate a StrB64 token; escape interpretation is a semantic caller choice. */
  constructor(init: Matter | MatterInit, escapive = true) {
    super(init);
    this.escapive = escapive;
    if (!isBexterCode(this.code)) {
      throw new UnknownCodeError(
        `Expected bexter strb64 code, got ${this.code}`,
      );
    }
  }

  /** Base64 text payload with the configured escape convention removed. */
  get bext(): string {
    return Bexter.derawify(this.raw, this.code, this.escapive);
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
  cold: CesrDomain,
): Bexter {
  return new Bexter(parseMatter(input, cold));
}
