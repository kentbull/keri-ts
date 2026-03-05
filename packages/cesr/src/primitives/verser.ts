import { b64ToInt } from "../core/bytes.ts";
import { DeserializeError, UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import type { Versionage } from "../tables/table-types.ts";
import type { Protocol } from "../tables/versions.ts";
import { VERSER_CODES, VERSER_PROTOCOLS } from "./codex.ts";
import { Matter, type MatterInit, parseMatter } from "./matter.ts";
import { Tagger } from "./tagger.ts";

/** Decode 3-char CESR version token (`Mmm`) into major/minor version tuple. */
function parseVersion(text: string): Versionage {
  if (text.length !== 3) {
    throw new DeserializeError(`Invalid version text length=${text.length}`);
  }
  const major = b64ToInt(text[0]);
  if (major !== 1 && major !== 2) {
    throw new DeserializeError(`Unsupported version major=${major}`);
  }
  return {
    major,
    minor: b64ToInt(text.slice(1)),
  };
}

/**
 * Compact version primitive for protocol/genus version metadata.
 *
 * KERIpy semantics: payload tag is `proto + pvrsn (+ gvrsn optional)` where
 * proto is `KERI|ACDC`, `pvrsn` is always present, and `gvrsn` is present only
 * for 10-char tags.
 */
export class Verser extends Tagger {
  constructor(init: Matter | MatterInit) {
    const tagger = init instanceof Matter ? init : new Matter(init);
    super(tagger);
    if (!VERSER_CODES.has(this.code)) {
      throw new UnknownCodeError(
        `Expected verser code (Y/0O), got ${this.code}`,
      );
    }
    const body = this.tag;
    if (body.length !== 7 && body.length !== 10) {
      throw new DeserializeError(`Invalid verser tag length=${body.length}`);
    }
    if (!VERSER_PROTOCOLS.has(body.slice(0, 4))) {
      throw new DeserializeError(
        `Unsupported verser proto=${body.slice(0, 4)}`,
      );
    }
    parseVersion(body.slice(4, 7));
    if (body.length === 10) parseVersion(body.slice(7, 10));
  }

  /** Protocol namespace extracted from verser tag payload. */
  get proto(): Protocol {
    return this.tag.slice(0, 4) as Protocol;
  }

  /** Protocol-version tuple (`major`, `minor`) decoded from tag payload. */
  get pvrsn(): Versionage {
    return parseVersion(this.tag.slice(4, 7));
  }

  /** Optional genus-version tuple decoded when 10-char verser payload is present. */
  get gvrsn(): Versionage | null {
    return this.tag.length === 10 ? parseVersion(this.tag.slice(7, 10)) : null;
  }
}

/** Parse and hydrate `Verser` from txt/qb2 bytes. */
export function parseVerser(
  input: Uint8Array,
  cold: Extract<ColdCode, "txt" | "bny">,
): Verser {
  return new Verser(parseMatter(input, cold));
}
