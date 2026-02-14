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
import type { ColdCode } from "../core/types.ts";
import { INDEXER_HARDS, INDEXER_SIZES } from "../tables/indexer.tables.ts";

export interface Indexer {
  code: string;
  raw: Uint8Array;
  qb64: string;
  fullSize: number;
  fullSizeB2: number;
}

const INDEXER_BARDS = new Map<string, number>(
  [...INDEXER_HARDS.entries()].map(([code, hs]) => [
    String.fromCharCode(codeB64ToB2(code)[0]),
    hs,
  ]),
);

function parseIndexerCodeFromText(txt: string): { code: string } {
  const hs = INDEXER_HARDS.get(txt[0]);
  if (!hs) {
    throw new UnknownCodeError(`Unknown indexer hard selector ${txt[0]}`);
  }

  const code = txt.slice(0, hs);
  if (!INDEXER_SIZES.has(code)) {
    throw new UnknownCodeError(`Unknown indexer code ${code}`);
  }

  return { code };
}

export function parseIndexerFromText(input: Uint8Array): Indexer {
  const txt = String.fromCharCode(...input);
  if (txt.length === 0) {
    throw new DeserializeError("Empty indexer input");
  }

  const { code } = parseIndexerCodeFromText(txt);
  const sizage = INDEXER_SIZES.get(code)!;
  const cs = sizage.hs + sizage.ss;
  const soft = txt.slice(sizage.hs, cs);
  const fullSize = sizage.fs ?? (cs + b64ToInt(soft) * 4);

  if (txt.length < fullSize) {
    throw new ShortageError(fullSize, txt.length);
  }

  const raw = decodeB64(txt.slice(cs, fullSize)).slice(sizage.ls);

  return {
    code,
    raw,
    qb64: txt.slice(0, fullSize),
    fullSize,
    fullSizeB2: sceil((fullSize * 3) / 4),
  };
}

export function parseIndexerFromBinary(input: Uint8Array): Indexer {
  if (input.length === 0) {
    throw new ShortageError(1, 0);
  }

  const first = nabSextets(input, 1);
  const hs = INDEXER_BARDS.get(String.fromCharCode(first[0]));
  if (!hs) {
    throw new UnknownCodeError(
      `Unsupported qb2 indexer start sextet=0x${first[0].toString(16)}`,
    );
  }

  const bhs = sceil((hs * 3) / 4);
  if (input.length < bhs) {
    throw new ShortageError(bhs, input.length);
  }

  const hard = codeB2ToB64(input, hs);
  const sizage = INDEXER_SIZES.get(hard);
  if (!sizage) {
    throw new UnknownCodeError(`Unknown indexer code ${hard}`);
  }

  const cs = sizage.hs + sizage.ss;
  const bcs = sceil((cs * 3) / 4);
  if (input.length < bcs) {
    throw new ShortageError(bcs, input.length);
  }

  const qb64cs = codeB2ToB64(input, cs);
  const soft = qb64cs.slice(sizage.hs, cs);
  const fs = sizage.fs ?? ((b64ToInt(soft) * 4) + cs);
  const bfs = sceil((fs * 3) / 4);
  if (input.length < bfs) {
    throw new ShortageError(bfs, input.length);
  }

  const qb2 = input.slice(0, bfs);
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

export function parseIndexer(
  input: Uint8Array,
  cold: Extract<ColdCode, "txt" | "bny">,
): Indexer {
  return cold === "bny"
    ? parseIndexerFromBinary(input)
    : parseIndexerFromText(input);
}
