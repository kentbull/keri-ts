import {
  b64ToInt,
  codeB2ToB64,
  codeB64ToB2,
  decodeB64,
  nabSextets,
  sceil,
} from "../core/bytes.ts";
import {
  DeserializeError,
  ShortageError,
  UnknownCodeError,
} from "../core/errors.ts";
import {
  MATTER_HARDS,
  MATTER_SIZES,
} from "../tables/matter.tables.generated.ts";
import type { ColdCode } from "../core/types.ts";

export interface Matter {
  code: string;
  raw: Uint8Array;
  qb64: string;
  fullSize: number; // qb64 char length
  fullSizeB2: number; // qb2 byte length
}

const MATTER_BARDS = new Map<string, number>(
  [...MATTER_HARDS.entries()].map(([code, hs]) => [
    String.fromCharCode(codeB64ToB2(code)[0]),
    hs,
  ]),
);

function parseMatterCodeFromText(txt: string): { code: string; hs: number } {
  const hs = MATTER_HARDS.get(txt[0]);
  if (!hs) {
    throw new UnknownCodeError(`Unknown matter hard selector ${txt[0]}`);
  }

  let code = txt.slice(0, hs);
  let sizage = MATTER_SIZES.get(code);
  if (!sizage && hs < txt.length) {
    const fallback = txt.slice(0, Math.min(4, txt.length));
    sizage = MATTER_SIZES.get(fallback);
    if (sizage) code = fallback;
  }

  if (!sizage) {
    throw new UnknownCodeError(`Unknown matter code ${code}`);
  }

  return { code, hs: sizage.hs };
}

export function parseMatterFromText(input: Uint8Array): Matter {
  const txt = String.fromCharCode(...input);
  if (txt.length === 0) {
    throw new DeserializeError("Empty matter input");
  }

  const { code } = parseMatterCodeFromText(txt);
  const sizage = MATTER_SIZES.get(code)!;
  const cs = sizage.hs + sizage.ss;
  const soft = sizage.ss > 0 ? txt.slice(sizage.hs, cs).slice(sizage.xs) : "";
  const fullSize = sizage.fs ?? (cs + b64ToInt(soft) * 4);
  if (txt.length < fullSize) {
    throw new ShortageError(fullSize, txt.length);
  }

  const ps = cs % 4;
  const body = txt.slice(cs, fullSize);
  const paw = decodeB64("A".repeat(ps) + body);
  const raw = paw.slice(ps + sizage.ls);

  return {
    code,
    raw,
    qb64: txt.slice(0, fullSize),
    fullSize,
    fullSizeB2: sceil((fullSize * 3) / 4),
  };
}

export function parseMatterFromBinary(input: Uint8Array): Matter {
  if (input.length === 0) {
    throw new ShortageError(1, 0);
  }

  const first = nabSextets(input, 1);
  const hs = MATTER_BARDS.get(String.fromCharCode(first[0]));
  if (!hs) {
    throw new UnknownCodeError(
      `Unsupported qb2 code start sextet=0x${first[0].toString(16)}`,
    );
  }

  const bhs = sceil((hs * 3) / 4);
  if (input.length < bhs) {
    throw new ShortageError(bhs, input.length);
  }

  const hard = codeB2ToB64(input, hs);
  const sizage = MATTER_SIZES.get(hard);
  if (!sizage) {
    throw new UnknownCodeError(`Unknown matter code ${hard}`);
  }

  const cs = sizage.hs + sizage.ss;
  const bcs = sceil((cs * 3) / 4);
  if (input.length < bcs) {
    throw new ShortageError(bcs, input.length);
  }

  const both = codeB2ToB64(input, cs);
  const softWithXtra = both.slice(sizage.hs, sizage.hs + sizage.ss);
  const xtra = softWithXtra.slice(0, sizage.xs);
  if (xtra !== "_".repeat(sizage.xs)) {
    throw new UnknownCodeError(`Invalid prepad xtra=${xtra}`);
  }

  const soft = softWithXtra.slice(sizage.xs);
  const fs = sizage.fs ?? ((b64ToInt(soft) * 4) + cs);
  const bfs = sceil((fs * 3) / 4);
  if (input.length < bfs) {
    throw new ShortageError(bfs, input.length);
  }

  const qb2 = input.slice(0, bfs);

  const ps = cs % 4;
  const pbs = 2 * ps;
  if (pbs > 0) {
    const pi = qb2[bcs - 1] & ((2 ** pbs) - 1);
    if (pi !== 0) {
      throw new DeserializeError(
        `Nonzero code mid pad bits=0b${pi.toString(2).padStart(pbs, "0")}`,
      );
    }
  }

  const qb64 = codeB2ToB64(qb2, fs);
  const raw = decodeB64(qb64.slice(cs)).slice(sizage.ls);

  return {
    code: hard,
    raw,
    qb64,
    fullSize: fs,
    fullSizeB2: bfs,
  };
}

export function parseMatter(
  input: Uint8Array,
  cold: Extract<ColdCode, "txt" | "bny">,
): Matter {
  return cold === "bny"
    ? parseMatterFromBinary(input)
    : parseMatterFromText(input);
}
