import { concatBytes, decodeB64, encodeB64 } from "../core/bytes.ts";
import { UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import { MATTER_SIZES } from "../tables/matter.tables.generated.ts";
import { DECIMAL_CODES } from "./codex.ts";
import { Matter, type MatterInit, parseMatter } from "./matter.ts";

/** Decode variable-sized decimal payload bytes into decimal-string form. */
function derawifyDns(raw: Uint8Array, code: string): string {
  const sizage = MATTER_SIZES.get(code);
  if (!sizage) {
    throw new UnknownCodeError(`Unknown decimer code ${code}`);
  }
  const body = encodeB64(concatBytes(new Uint8Array(sizage.ls), raw));
  const ws = sizage.ls === 0 && body.startsWith("A") ? 1 : (sizage.ls + 1) % 4;
  return body.slice(ws).replaceAll("p", ".");
}

/** Encode decimal-string form into CESR raw bytes for decimal codes. */
function rawifyDns(dns: string): Uint8Array {
  const encoded = dns.replaceAll(".", "p");
  const ts = encoded.length % 4;
  const ws = (4 - ts) % 4;
  const ls = (3 - ts) % 3;
  return decodeB64("A".repeat(ws) + encoded).slice(ls);
}

interface DecimerInit extends MatterInit {
  dns?: string;
  decimal?: number;
}

/**
 * CESR decimal primitive aligned with KERIpy `Decimer`.
 *
 * Supports hydration from existing qualified material or direct decimal input
 * (`dns`/`decimal`) when raw material is not provided.
 */
export class Decimer extends Matter {
  constructor(init: Matter | DecimerInit) {
    const matter = (
        !(init instanceof Matter)
        && !init.raw
        && !init.qb64
        && !init.qb64b
        && !init.qb2
        && (init.dns !== undefined || init.decimal !== undefined)
      )
      ? {
        ...init,
        raw: rawifyDns(init.dns ?? `${init.decimal}`),
        code: init.code ?? "4H",
      }
      : init instanceof Matter
      ? init
      : new Matter(init);

    super(matter);

    if (!DECIMAL_CODES.has(this.code)) {
      throw new UnknownCodeError(`Expected decimal code, got ${this.code}`);
    }
  }

  /** Decimal string form (roundtrippable CESR decimal representation). */
  get dns(): string {
    return derawifyDns(this.raw, this.code);
  }

  /** Convenience numeric projection of `.dns` for consumer-side arithmetic. */
  get decimal(): number {
    return Number(this.dns);
  }
}

/** Parse and hydrate a `Decimer` from txt or qb2 stream bytes. */
export function parseDecimer(
  input: Uint8Array,
  cold: Extract<ColdCode, "txt" | "bny">,
): Decimer {
  return new Decimer(parseMatter(input, cold));
}
