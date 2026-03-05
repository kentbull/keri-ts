import { UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import { BEXTER_CODES, isAttLabel, LABELER_CODES, TAG_CODES } from "./codex.ts";
import { Bexter } from "./bexter.ts";
import { Matter, type MatterInit, parseMatter } from "./matter.ts";
import { Tagger } from "./tagger.ts";

const TEXT_DECODER = new TextDecoder();

/** True when code belongs to KERIpy `LabelCodex` accepted by native map labels. */
export function isLabelerCode(code: string): boolean {
  return LABELER_CODES.has(code);
}

/**
 * Decode a label/text token according to LabelCodex encoding rules.
 *
 * Tag/Bext encodings require specialized decoding logic; all other label forms
 * project directly from raw bytes.
 */
function decodeLabelText(matter: Matter): string {
  if (TAG_CODES.has(matter.code)) {
    return new Tagger(matter).tag;
  }
  if (BEXTER_CODES.has(matter.code)) {
    const bext = Bexter.derawify(matter.raw, matter.code);
    return bext.startsWith("-") && isAttLabel(bext.slice(1))
      ? bext.slice(1)
      : bext;
  }
  return TEXT_DECODER.decode(matter.raw);
}

/**
 * Label/text primitive used for native map keys and textual field values.
 *
 * KERIpy semantics: `Labeler` accepts Tag/Bext/Bytes families (plus compact
 * label codes) and provides both strict attribute-label projection (`label`)
 * and generic text projection (`text`).
 */
export class Labeler extends Matter {
  constructor(init: Matter | MatterInit) {
    const matter = init instanceof Matter ? init : new Matter(init);
    super(matter);
    if (!isLabelerCode(this.code)) {
      throw new UnknownCodeError(`Expected labeler code, got ${this.code}`);
    }
  }

  /** Canonical qb64 token for emit/roundtrip paths. */
  get token(): string {
    return this.qb64;
  }

  /** Attribute-safe label projection used for map key semantics. */
  get label(): string {
    const label = decodeLabelText(this);
    if (!isAttLabel(label)) {
      throw new UnknownCodeError(`Invalid label text: ${label}`);
    }
    return label;
  }

  /** Raw text projection without attribute-name validation. */
  get text(): string {
    return decodeLabelText(this);
  }

  /** Numeric projection helper used for compact fixed-width label values. */
  get index(): number {
    let index = 0;
    for (const b of this.raw) {
      index = (index << 8) | b;
    }
    return index;
  }

  /** Raw decoded bytes backing the label/text token. */
  get bytes(): Uint8Array {
    return this.raw;
  }
}

/**
 * Parse and hydrate a `Labeler` from txt/qb2 bytes.
 *
 * Boundary contract: parsing is syntactic; semantic label validity is enforced
 * when `label` accessor is read.
 */
export function parseLabeler(
  input: Uint8Array,
  cold: Extract<ColdCode, "txt" | "bny">,
): Labeler {
  return new Labeler(parseMatter(input, cold));
}
