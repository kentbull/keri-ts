import { b64ToInt, decodeB64 } from "../core/bytes.ts";
import { DeserializeError, UnknownCodeError } from "../core/errors.ts";
import {
  MATTER_HARDS,
  MATTER_SIZES,
} from "../tables/matter.tables.generated.ts";

export interface Matter {
  code: string;
  raw: Uint8Array;
  qb64: string;
  fullSize: number;
}

export function parseMatterFromText(input: Uint8Array): Matter {
  const txt = String.fromCharCode(...input);
  if (txt.length === 0) {
    throw new DeserializeError("Empty matter input");
  }

  const hs = MATTER_HARDS.get(txt[0]);
  if (!hs) {
    throw new UnknownCodeError(`Unknown matter hard selector ${txt[0]}`);
  }

  const hard = txt.slice(0, hs);
  let sizage = MATTER_SIZES.get(hard);
  let code = hard;
  if (!sizage && hs < txt.length) {
    const fallback = txt.slice(0, Math.min(4, txt.length));
    sizage = MATTER_SIZES.get(fallback);
    if (sizage) code = fallback;
  }
  if (!sizage) {
    throw new UnknownCodeError(`Unknown matter code ${hard}`);
  }

  const cs = sizage.hs + sizage.ss;
  const soft = sizage.ss > 0 ? txt.slice(sizage.hs, cs).slice(sizage.xs) : "";
  const fullSize = sizage.fs ?? (cs + b64ToInt(soft) * 4);
  if (txt.length < fullSize) {
    throw new DeserializeError(
      `Need ${fullSize} chars for matter but got ${txt.length}`,
    );
  }

  const ps = cs % 4;
  const body = txt.slice(cs, fullSize);
  const paw = decodeB64("A".repeat(ps) + body);
  const raw = paw.slice(ps + sizage.ls);

  return { code, raw, qb64: txt.slice(0, fullSize), fullSize };
}
