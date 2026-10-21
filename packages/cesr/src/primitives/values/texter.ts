import { decodeB64, t } from "../../core/bytes.ts";
import { DeserializeError, UnknownCodeError } from "../../core/errors.ts";
import type { CesrDomain } from "../../core/types.ts";
import { TEXTER_CODES } from "../base/codex.ts";
import { Matter, type MatterInit, parseMatter } from "../base/matter.ts";

function isTexterCode(code: string): boolean {
  return TEXTER_CODES.has(code);
}

/**
 * Raw-bytes text primitive.
 *
 * KERIpy substance: `Texter` carries variable-length byte-string text (UTF-8
 * friendly) with Bytes codex families.
 */
export class Texter extends Matter {
  constructor(init: Matter | MatterInit) {
    super(init);
    if (!isTexterCode(this.code)) {
      throw new UnknownCodeError(
        `Expected texter bytes code, got ${this.code}`,
      );
    }
  }

  get text(): string {
    return t(this.raw);
  }
}

/** Parse and hydrate `Texter` from txt/qb2 bytes. */
export function parseTexter(
  input: Uint8Array,
  cold: CesrDomain,
): Texter {
  const texter = new Texter(parseMatter(input, cold));
  const wire = texter.qb64;
  if (!/^[A-Za-z0-9_-]+$/.test(wire)) throw new DeserializeError("Invalid Texter base64 payload");
  const lead = Matter.leadSizeForCode(texter.code);
  const headerSize = texter.code.length * 2;
  const padding = decodeB64(wire.slice(headerSize, headerSize + 4));
  for (let index = 0; index < lead; index++) {
    if (padding[index] !== 0) throw new DeserializeError("Nonzero Texter lead padding");
  }
  return texter;
}
