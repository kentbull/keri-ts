import {
  b,
  b64ToInt,
  codeB2ToB64,
  codeB64ToB2,
  concatBytes,
  decodeB64,
  encodeB64,
  intToB64,
  nabSextets,
  sceil,
} from "../core/bytes.ts";
import { DeserializeError, ShortageError, UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import { INDEXER_HARDS, INDEXER_SIZES } from "../tables/indexer.tables.generated.ts";
import { INDEXED_BOTH_SIG_CODES } from "./codex.ts";

/**
 * Supported initialization forms for Indexer-derived primitives.
 *
 * Includes index metadata (`index`, `ondex`) in addition to Matter-style
 * qualified material forms.
 */
export interface IndexerInit {
  raw?: Uint8Array;
  code?: string;
  index?: number;
  ondex?: number;
  qb64b?: Uint8Array;
  qb64?: string;
  qb2?: Uint8Array;
}

interface IndexerData {
  code: string;
  raw: Uint8Array;
  qb64: string;
  fullSize: number;
  fullSizeB2: number;
  index: number;
  ondex: number | undefined;
}

const INDEXER_BARDS = new Map<string, number>(
  [...INDEXER_HARDS.entries()].map(([code, hs]) => [
    String.fromCharCode(codeB64ToB2(code)[0]),
    hs,
  ]),
);

function isIndexerData(value: unknown): value is IndexerData {
  return typeof value === "object" && value !== null
    && "code" in value && "raw" in value && "qb64" in value
    && "fullSize" in value && "fullSizeB2" in value && "index" in value;
}

/** Resolve the effective indexer code from the text-domain hard-selector prefix. */
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

/** Decode index and optional ondex soft fields from a fully qualified indexer token. */
function parseIndexFields(
  code: string,
  qb64: string,
): { index: number; ondex: number | undefined } {
  const sizage = INDEXER_SIZES.get(code);
  if (!sizage) {
    throw new UnknownCodeError(`Unknown indexer code ${code}`);
  }

  const cs = sizage.hs + sizage.ss;
  const soft = qb64.slice(sizage.hs, cs);
  const ms = sizage.ss - sizage.os;
  const index = ms > 0 ? b64ToInt(soft.slice(0, ms)) : 0;
  const ondex = sizage.os > 0
    ? b64ToInt(soft.slice(ms, sizage.ss))
    : (INDEXED_BOTH_SIG_CODES.has(code) ? index : undefined);
  return { index, ondex };
}

/** Inhale one text-domain indexer token into normalized indexer data fields. */
function parseIndexerFromTextData(input: Uint8Array): IndexerData {
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

  const qb64 = txt.slice(0, fullSize);
  const ps = cs % 4;
  const raw = decodeB64("A".repeat(ps) + qb64.slice(cs)).slice(ps + sizage.ls);
  const { index, ondex } = parseIndexFields(code, qb64);

  return {
    code,
    raw,
    qb64,
    fullSize,
    fullSizeB2: sceil((fullSize * 3) / 4),
    index,
    ondex,
  };
}

/** Inhale one qb2 indexer token into the canonical text-oriented indexer shape. */
function parseIndexerFromBinaryData(input: Uint8Array): IndexerData {
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
  const ps = cs % 4;
  const raw = decodeB64("A".repeat(ps) + qb64.slice(cs)).slice(ps + sizage.ls);
  const { index, ondex } = parseIndexFields(hard, qb64);

  return {
    code: hard,
    raw,
    qb64,
    fullSize: fs,
    fullSizeB2: bfs,
    index,
    ondex,
  };
}

/** Exhale raw bytes plus index metadata into fully qualified indexer encodings. */
function encodeIndexerFromRaw(
  code: string,
  raw: Uint8Array,
  index: number,
  ondex?: number,
): IndexerData {
  const sizage = INDEXER_SIZES.get(code);
  if (!sizage) {
    throw new UnknownCodeError(`Unknown indexer code ${code}`);
  }

  const ms = sizage.ss - sizage.os;
  if (ms < 0) {
    throw new DeserializeError(`Invalid indexer sizage for ${code}`);
  }

  if (!Number.isInteger(index) || index < 0) {
    throw new DeserializeError(`Invalid index ${index} for ${code}`);
  }

  const ondexValue = sizage.os > 0
    ? (ondex ?? index)
    : (INDEXED_BOTH_SIG_CODES.has(code) ? index : undefined);
  if (sizage.os > 0 && (ondexValue === undefined || ondexValue < 0)) {
    throw new DeserializeError(`Invalid ondex ${ondexValue} for ${code}`);
  }
  if (
    sizage.os === 0 && INDEXED_BOTH_SIG_CODES.has(code)
    && typeof ondex === "number" && ondex !== index
  ) {
    throw new DeserializeError(
      `Invalid ondex ${ondex} for both-signature code ${code} with index ${index}`,
    );
  }

  const cs = sizage.hs + sizage.ss;
  const ps = cs % 4;
  const paw = concatBytes(new Uint8Array(ps + sizage.ls), raw);
  const body = encodeB64(paw).slice(ps);

  const soft = `${intToB64(index, ms)}${sizage.os > 0 ? intToB64(ondexValue ?? 0, sizage.os) : ""}`;
  const qb64 = `${code}${soft}${body}`;

  const fullSize = qb64.length;
  if (sizage.fs !== null && fullSize !== sizage.fs) {
    throw new DeserializeError(
      `Encoded indexer size mismatch for ${code}: expected=${sizage.fs} got=${fullSize}`,
    );
  }

  return {
    code,
    raw: raw.slice(),
    qb64,
    fullSize,
    fullSizeB2: sceil((fullSize * 3) / 4),
    index,
    ondex: ondexValue,
  };
}

/** Normalize the supported constructor variants into one shared indexer payload. */
function parseIndexerInit(init: IndexerInit): IndexerData {
  if (init.raw && init.code) {
    return encodeIndexerFromRaw(
      init.code,
      init.raw,
      init.index ?? 0,
      init.ondex,
    );
  }
  if (init.qb64b) {
    return parseIndexerFromTextData(init.qb64b);
  }
  if (init.qb64) {
    return parseIndexerFromTextData(b(init.qb64));
  }
  if (init.qb2) {
    return parseIndexerFromBinaryData(init.qb2);
  }

  throw new DeserializeError(
    "Indexer requires (raw + code) or qb64/qb64b/qb2 initialization",
  );
}

/**
 * Base indexed CESR primitive.
 *
 * KERIpy substance: `Indexer` extends matter semantics with index/ondex fields
 * used by indexed signatures and other attachment-indexed material families.
 */
export class Indexer {
  protected readonly _code: string;
  protected readonly _raw: Uint8Array;
  protected readonly _qb64: string;
  protected readonly _fullSize: number;
  protected readonly _fullSizeB2: number;
  protected readonly _index: number;
  protected readonly _ondex: number | undefined;

  constructor(init: Indexer | IndexerData | IndexerInit) {
    const data = init instanceof Indexer
      ? init.toIndexerData()
      : isIndexerData(init)
      ? init
      : parseIndexerInit(init);

    this._code = data.code;
    this._raw = data.raw.slice();
    this._qb64 = data.qb64;
    this._fullSize = data.fullSize;
    this._fullSizeB2 = data.fullSizeB2;
    this._index = data.index;
    this._ondex = data.ondex;
  }

  protected toIndexerData(): IndexerData {
    return {
      code: this._code,
      raw: this._raw.slice(),
      qb64: this._qb64,
      fullSize: this._fullSize,
      fullSizeB2: this._fullSizeB2,
      index: this._index,
      ondex: this._ondex,
    };
  }

  get code(): string {
    return this._code;
  }

  get raw(): Uint8Array {
    return this._raw;
  }

  get qb64(): string {
    return this._qb64;
  }

  get qb64b(): Uint8Array {
    return b(this._qb64);
  }

  get qb2(): Uint8Array {
    return codeB64ToB2(this._qb64);
  }

  get fullSize(): number {
    return this._fullSize;
  }

  get fullSizeB2(): number {
    return this._fullSizeB2;
  }

  get index(): number {
    return this._index;
  }

  get ondex(): number | undefined {
    return this._ondex;
  }

  equals(other: { qb64: string }): boolean {
    return this._qb64 === other.qb64;
  }

  toString(): string {
    return this._qb64;
  }
}

/** Parse indexer material from text-domain CESR bytes. */
export function parseIndexerFromText(input: Uint8Array): Indexer {
  return new Indexer(parseIndexerFromTextData(input));
}

/** Parse indexer material from binary-domain CESR bytes. */
export function parseIndexerFromBinary(input: Uint8Array): Indexer {
  return new Indexer(parseIndexerFromBinaryData(input));
}

/** Parse indexer using caller-provided cold-start domain hint (`txt` or `bny`). */
export function parseIndexer(
  input: Uint8Array,
  cold: Extract<ColdCode, "txt" | "bny">,
): Indexer {
  return cold === "bny"
    ? parseIndexerFromBinary(input)
    : parseIndexerFromText(input);
}
