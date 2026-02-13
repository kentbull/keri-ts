import {
  b64ToInt,
  codeB2ToB64,
  codeB64ToB2,
  nabSextets,
  sceil,
} from "../core/bytes.ts";
import {
  DeserializeError,
  ShortageError,
  UnknownCodeError,
} from "../core/errors.ts";
import {
  COUNTER_CODE_NAMES_V1,
  COUNTER_CODE_NAMES_V2,
  COUNTER_HARDS,
  COUNTER_SIZES_V1,
  COUNTER_SIZES_V2,
} from "../tables/counter.tables.generated.ts";
import type { Versionage } from "../tables/table-types.ts";
import type { ColdCode } from "../core/types.ts";

export interface Counter {
  code: string;
  count: number;
  fullSize: number; // qb64 chars
  fullSizeB2: number; // qb2 bytes
  qb64: string;
  name: string;
}

const COUNTER_BARDS = new Map<string, number>(
  [...COUNTER_HARDS.entries()].map(([code, hs]) => [
    String.fromCharCode(codeB64ToB2(code)[0]) +
    String.fromCharCode(codeB64ToB2(code)[1] ?? 0),
    hs,
  ]),
);

function getTables(version: Versionage) {
  const sizeTable = version.major >= 2 ? COUNTER_SIZES_V2 : COUNTER_SIZES_V1;
  const nameTable = version.major >= 2
    ? COUNTER_CODE_NAMES_V2
    : COUNTER_CODE_NAMES_V1;
  return { sizeTable, nameTable };
}

export function parseCounterFromText(
  input: Uint8Array,
  version: Versionage,
): Counter {
  const txt = String.fromCharCode(...input);
  if (txt.length < 4 || txt[0] !== "-") {
    throw new DeserializeError("Invalid counter text input");
  }

  const { sizeTable, nameTable } = getTables(version);

  const hard2 = txt.slice(0, 2);
  const hs = COUNTER_HARDS.get(hard2);
  if (!hs) {
    throw new UnknownCodeError(
      `Unsupported counter hard code at stream: ${hard2}`,
    );
  }

  const code = txt.slice(0, hs);
  const sizage = sizeTable.get(code);
  if (!sizage) {
    throw new UnknownCodeError(`Unsupported counter code at stream: ${code}`);
  }

  if (txt.length < sizage.fs) {
    throw new ShortageError(sizage.fs, txt.length);
  }

  const count = b64ToInt(txt.slice(sizage.hs, sizage.hs + sizage.ss));
  const name = nameTable[code as keyof typeof nameTable] ?? "UnknownCounter";

  return {
    code,
    count,
    fullSize: sizage.fs,
    fullSizeB2: sceil((sizage.fs * 3) / 4),
    qb64: txt.slice(0, sizage.fs),
    name,
  };
}

export function parseCounterFromBinary(
  input: Uint8Array,
  version: Versionage,
): Counter {
  if (input.length < 2) {
    throw new ShortageError(2, input.length);
  }

  const { sizeTable, nameTable } = getTables(version);

  const firstTwo = nabSextets(input, 2);
  const key = String.fromCharCode(firstTwo[0]) +
    String.fromCharCode(firstTwo[1] ?? 0);
  const hs = COUNTER_BARDS.get(key);
  if (!hs) {
    throw new UnknownCodeError(`Unsupported qb2 counter start sextets`);
  }

  const bhs = sceil((hs * 3) / 4);
  if (input.length < bhs) {
    throw new ShortageError(bhs, input.length);
  }

  const code = codeB2ToB64(input, hs);
  const sizage = sizeTable.get(code);
  if (!sizage) {
    throw new UnknownCodeError(`Unsupported counter code at stream: ${code}`);
  }

  const bcs = sceil((sizage.fs * 3) / 4);
  if (input.length < bcs) {
    throw new ShortageError(bcs, input.length);
  }

  const qb64 = codeB2ToB64(input, sizage.fs);
  const count = b64ToInt(qb64.slice(sizage.hs, sizage.fs));
  const name = nameTable[code as keyof typeof nameTable] ?? "UnknownCounter";

  return {
    code,
    count,
    fullSize: sizage.fs,
    fullSizeB2: bcs,
    qb64,
    name,
  };
}

export function parseCounter(
  input: Uint8Array,
  version: Versionage,
  cold: Extract<ColdCode, "txt" | "bny">,
): Counter {
  return cold === "bny"
    ? parseCounterFromBinary(input, version)
    : parseCounterFromText(input, version);
}
