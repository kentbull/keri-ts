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
import { MATTER_HARDS, MATTER_SIZES } from "../tables/matter.tables.generated.ts";

/**
 * Supported initialization forms for Matter-derived primitives.
 *
 * Mirrors KERIpy behavior: construct from raw+code or from any qualified form
 * (`qb64`, `qb64b`, `qb2`).
 */
export interface MatterInit {
  raw?: Uint8Array;
  code?: string;
  qb64b?: Uint8Array;
  qb64?: string;
  qb2?: Uint8Array;
}

interface MatterData {
  code: string;
  raw: Uint8Array;
  qb64: string;
  fullSize: number;
  fullSizeB2: number;
}

const SMALL_VAR_SELECTORS = ["4", "5", "6"] as const;
const LARGE_VAR_SELECTORS = ["7", "8", "9"] as const;

const MATTER_BARDS = new Map<string, number>(
  [...MATTER_HARDS.entries()].map(([code, hs]) => [
    String.fromCharCode(codeB64ToB2(code)[0]),
    hs,
  ]),
);

function isMatterData(value: unknown): value is MatterData {
  return typeof value === "object"
    && value !== null
    && "code" in value
    && "raw" in value
    && "qb64" in value
    && "fullSize" in value
    && "fullSizeB2" in value;
}

function rawSizeForCode(code: string): number {
  const sizage = MATTER_SIZES.get(code);
  if (!sizage || sizage.fs === null) {
    throw new DeserializeError(`Non-fixed raw size for code ${code}.`);
  }
  const cs = sizage.hs + sizage.ss;
  return Math.floor(((sizage.fs - cs) * 3) / 4) - sizage.ls;
}

function normalizeVariableMatterCode(code: string, raw: Uint8Array): string {
  const sizage = MATTER_SIZES.get(code);
  if (!sizage || sizage.fs !== null) {
    return code;
  }

  const selector = code[0];
  const leadSize = (3 - (raw.length % 3)) % 3;
  const size = (raw.length + leadSize) / 3;

  if (SMALL_VAR_SELECTORS.includes(selector as (typeof SMALL_VAR_SELECTORS)[number])) {
    if (size <= (64 ** 2) - 1) {
      return `${SMALL_VAR_SELECTORS[leadSize]}${code.slice(1, 2)}`;
    }
    if (size <= (64 ** 4) - 1) {
      return `${LARGE_VAR_SELECTORS[leadSize]}AA${code.slice(1, 2)}`;
    }
    throw new DeserializeError(
      `Unsupported variable raw size for ${code}: ${raw.length}.`,
    );
  }

  if (LARGE_VAR_SELECTORS.includes(selector as (typeof LARGE_VAR_SELECTORS)[number])) {
    if (size <= (64 ** 4) - 1) {
      return `${LARGE_VAR_SELECTORS[leadSize]}${code.slice(1, 4)}`;
    }
    throw new DeserializeError(
      `Unsupported variable raw size for large ${code}: ${raw.length}.`,
    );
  }

  throw new DeserializeError(`Unsupported variable raw-size family for ${code}.`);
}

/** Resolve the effective matter code from the text-domain hard-selector prefix. */
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

/** Inhale one text-domain CESR primitive into normalized matter data fields. */
function parseMatterFromTextData(input: Uint8Array): MatterData {
  const txt = String.fromCharCode(...input);
  if (txt.length === 0) {
    throw new ShortageError(1, 0);
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

/** Inhale one qb2 CESR primitive into the canonical text-oriented matter shape. */
function parseMatterFromBinaryData(input: Uint8Array): MatterData {
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
  const paw = decodeB64("A".repeat(ps) + qb64.slice(cs));
  const raw = paw.slice(ps + sizage.ls);

  return {
    code: hard,
    raw,
    qb64,
    fullSize: fs,
    fullSizeB2: bfs,
  };
}

/** Exhale raw bytes plus code into fully qualified CESR matter encodings. */
function encodeMatterFromRaw(code: string, raw: Uint8Array): MatterData {
  code = normalizeVariableMatterCode(code, raw);
  const sizage = MATTER_SIZES.get(code);
  if (!sizage) {
    throw new UnknownCodeError(`Unknown matter code ${code}`);
  }

  const cs = sizage.hs + sizage.ss;
  const ps = cs % 4;
  const paw = concatBytes(new Uint8Array(ps + sizage.ls), raw);
  const body = encodeB64(paw).slice(ps);

  let soft = "";
  if (sizage.ss > 0) {
    const softLen = sizage.ss - sizage.xs;
    if (softLen < 0) {
      throw new DeserializeError(`Invalid sizage soft width for code ${code}`);
    }
    const count = sizage.fs === null ? body.length / 4 : (sizage.fs - cs) / 4;
    if (!Number.isInteger(count) || count < 0) {
      throw new DeserializeError(`Invalid computed count for code ${code}`);
    }
    soft = "_".repeat(sizage.xs) + intToB64(count, softLen);
  }

  const qb64 = `${code}${soft}${body}`;
  const fullSize = qb64.length;
  if (sizage.fs !== null && fullSize !== sizage.fs) {
    throw new DeserializeError(
      `Encoded size mismatch for ${code}: expected=${sizage.fs} got=${fullSize}`,
    );
  }

  return {
    code,
    raw: raw.slice(),
    qb64,
    fullSize,
    fullSizeB2: sceil((fullSize * 3) / 4),
  };
}

/** Normalize the supported constructor variants into one shared matter payload. */
function parseMatterInit(init: MatterInit): MatterData {
  if (init.raw && init.code) {
    return encodeMatterFromRaw(init.code, init.raw);
  }
  if (init.qb64b) {
    return parseMatterFromTextData(init.qb64b);
  }
  if (init.qb64) {
    return parseMatterFromTextData(b(init.qb64));
  }
  if (init.qb2) {
    return parseMatterFromBinaryData(init.qb2);
  }

  throw new DeserializeError(
    "Matter requires (raw + code) or qb64/qb64b/qb2 initialization",
  );
}

/**
 * Base CESR primitive carrying qualified matter material.
 *
 * KERIpy substance: `Matter` is the foundational primitive abstraction that
 * handles exfil/infil between raw bytes and qualified CESR encodings.
 */
export class Matter {
  protected readonly _code: string;
  protected readonly _raw: Uint8Array;
  protected readonly _qb64: string;
  protected readonly _fullSize: number;
  protected readonly _fullSizeB2: number;

  constructor(init: Matter | MatterData | MatterInit) {
    const data = init instanceof Matter
      ? init.toMatterData()
      : isMatterData(init)
      ? init
      : parseMatterInit(init);

    this._code = data.code;
    this._raw = data.raw.slice();
    this._qb64 = data.qb64;
    this._fullSize = data.fullSize;
    this._fullSizeB2 = data.fullSizeB2;
  }

  protected toMatterData(): MatterData {
    return {
      code: this._code,
      raw: this._raw.slice(),
      qb64: this._qb64,
      fullSize: this._fullSize,
      fullSizeB2: this._fullSizeB2,
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

  equals(other: { qb64: string }): boolean {
    return this._qb64 === other.qb64;
  }

  toString(): string {
    return this._qb64;
  }

  /** KERIpy parity helper: fixed raw size for one code. */
  static rawSizeForCode(code: string): number {
    return rawSizeForCode(code);
  }

  /** KERIpy parity helper: fixed full qb64 size for one code. */
  static fullSizeForCode(code: string): number {
    const sizage = MATTER_SIZES.get(code);
    if (!sizage || sizage.fs === null) {
      throw new DeserializeError(`Non-fixed full size for code ${code}.`);
    }
    return sizage.fs;
  }

  /** KERIpy parity helper: lead-byte size for one code. */
  static leadSizeForCode(code: string): number {
    const sizage = MATTER_SIZES.get(code);
    if (!sizage) {
      throw new UnknownCodeError(`Unknown matter code ${code}`);
    }
    return sizage.ls;
  }
}

/** Parse matter from text-domain CESR bytes. */
export function parseMatterFromText(input: Uint8Array): Matter {
  return new Matter(parseMatterFromTextData(input));
}

/** Parse matter from binary-domain CESR bytes. */
export function parseMatterFromBinary(input: Uint8Array): Matter {
  return new Matter(parseMatterFromBinaryData(input));
}

/** Parse matter using caller-provided cold-start domain hint (`txt` or `bny`). */
export function parseMatter(
  input: Uint8Array,
  cold: Extract<ColdCode, "txt" | "bny">,
): Matter {
  return cold === "bny"
    ? parseMatterFromBinary(input)
    : parseMatterFromText(input);
}
