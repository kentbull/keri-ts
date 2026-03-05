import {
  b64ToInt,
  codeB2ToB64,
  codeB64ToB2,
  intToB64,
  nabSextets,
  sceil,
} from "../core/bytes.ts";
import {
  DeserializeError,
  ShortageError,
  UnknownCodeError,
} from "../core/errors.ts";
import { COUNTER_HARDS } from "../tables/counter.tables.generated.ts";
import type { Versionage } from "../tables/table-types.ts";
import type { ColdCode } from "../core/types.ts";
import {
  resolveCounterCodeNameTable,
  resolveCounterSizeTable,
} from "../tables/counter-version-registry.ts";
import type { GroupEntry } from "./primitive.ts";

/**
 * Supported initialization forms for Counter primitives.
 *
 * Counters are version-sensitive and may be initialized from explicit code/count
 * fields or from qualified encodings (`qb64`, `qb64b`, `qb2`).
 */
export interface CounterInit {
  code?: string;
  count?: number;
  countB64?: string;
  qb64b?: Uint8Array;
  qb64?: string;
  qb2?: Uint8Array;
  version?: Versionage;
}

interface CounterData {
  code: string;
  count: number;
  fullSize: number;
  fullSizeB2: number;
  qb64: string;
  name: string;
  version: Versionage;
}

const COUNTER_BARDS = new Map<string, number>(
  [...COUNTER_HARDS.entries()].map(([code, hs]) => [
    String.fromCharCode(codeB64ToB2(code)[0]) +
    String.fromCharCode(codeB64ToB2(code)[1] ?? 0),
    hs,
  ]),
);

function isCounterData(value: unknown): value is CounterData {
  return typeof value === "object" && value !== null &&
    "code" in value && "count" in value && "fullSize" in value &&
    "fullSizeB2" in value && "qb64" in value && "name" in value &&
    "version" in value;
}

function getTables(version: Versionage) {
  const sizeTable = resolveCounterSizeTable(version);
  const nameTable = resolveCounterCodeNameTable(version);
  return { sizeTable, nameTable };
}

function parseCounterFromTextData(
  input: Uint8Array,
  version: Versionage,
): CounterData {
  const txt = String.fromCharCode(...input);
  if (txt.length === 0) {
    throw new ShortageError(1, 0);
  }
  if (txt[0] !== "-") {
    throw new DeserializeError("Invalid counter text input");
  }
  if (txt.length < 2) {
    throw new ShortageError(2, txt.length);
  }

  const { sizeTable, nameTable } = getTables(version);

  const hard2 = txt.slice(0, 2);
  const hs = COUNTER_HARDS.get(hard2);
  if (!hs && txt.length < 4) {
    throw new ShortageError(4, txt.length);
  }
  if (!hs) {
    throw new UnknownCodeError(
      `Unsupported counter hard code at stream: ${hard2}`,
    );
  }
  if (txt.length < hs) {
    throw new ShortageError(hs, txt.length);
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
  const name = nameTable[code] ?? "UnknownCounter";
  const qb64 = txt.slice(0, sizage.fs);

  return {
    code,
    count,
    fullSize: sizage.fs,
    fullSizeB2: sceil((sizage.fs * 3) / 4),
    qb64,
    name,
    version,
  };
}

function parseCounterFromBinaryData(
  input: Uint8Array,
  version: Versionage,
): CounterData {
  if (input.length < 2) {
    throw new ShortageError(2, input.length);
  }

  const { sizeTable, nameTable } = getTables(version);

  const firstTwo = nabSextets(input, 2);
  const key = String.fromCharCode(firstTwo[0]) +
    String.fromCharCode(firstTwo[1] ?? 0);
  const hs = COUNTER_BARDS.get(key);
  if (!hs) {
    throw new UnknownCodeError("Unsupported qb2 counter start sextets");
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
  const count = b64ToInt(qb64.slice(sizage.hs, sizage.hs + sizage.ss));
  const name = nameTable[code] ?? "UnknownCounter";

  return {
    code,
    count,
    fullSize: sizage.fs,
    fullSizeB2: bcs,
    qb64,
    name,
    version,
  };
}

function encodeCounterFromFields(
  code: string,
  count: number,
  version: Versionage,
): CounterData {
  const { sizeTable, nameTable } = getTables(version);
  const sizage = sizeTable.get(code);
  if (!sizage) {
    throw new UnknownCodeError(`Unsupported counter code for version: ${code}`);
  }

  if (!Number.isInteger(count) || count < 0 || count > 64 ** sizage.ss - 1) {
    throw new DeserializeError(`Invalid count=${count} for code=${code}`);
  }

  const qb64 = `${code}${intToB64(count, sizage.ss)}`;
  if (qb64.length !== sizage.fs) {
    throw new DeserializeError(
      `Encoded counter size mismatch for ${code}: expected=${sizage.fs} got=${qb64.length}`,
    );
  }

  return {
    code,
    count,
    fullSize: sizage.fs,
    fullSizeB2: sceil((sizage.fs * 3) / 4),
    qb64,
    name: nameTable[code] ?? "UnknownCounter",
    version,
  };
}

function parseCounterInit(init: CounterInit): CounterData {
  const version = init.version ?? { major: 2, minor: 0 };

  if (init.code !== undefined) {
    const count = init.count ??
      (init.countB64 ? b64ToInt(init.countB64) : 0);
    return encodeCounterFromFields(init.code, count, version);
  }

  if (init.qb64b) {
    return parseCounterFromTextData(init.qb64b, version);
  }
  if (init.qb64) {
    return parseCounterFromTextData(
      new TextEncoder().encode(init.qb64),
      version,
    );
  }
  if (init.qb2) {
    return parseCounterFromBinaryData(init.qb2, version);
  }

  throw new DeserializeError(
    "Counter requires code/count or qb64/qb64b/qb2 initialization",
  );
}

/**
 * Base CESR counter primitive.
 *
 * KERIpy substance: counters are first-class primitives that frame counted
 * payload groups and carry versioned code-name semantics.
 */
export class Counter {
  protected readonly _code: string;
  protected readonly _count: number;
  protected readonly _fullSize: number;
  protected readonly _fullSizeB2: number;
  protected readonly _qb64: string;
  protected readonly _name: string;
  protected readonly _version: Versionage;

  constructor(init: Counter | CounterData | CounterInit) {
    const data = init instanceof Counter
      ? init.toCounterData()
      : isCounterData(init)
      ? init
      : parseCounterInit(init);

    this._code = data.code;
    this._count = data.count;
    this._fullSize = data.fullSize;
    this._fullSizeB2 = data.fullSizeB2;
    this._qb64 = data.qb64;
    this._name = data.name;
    this._version = { ...data.version };
  }

  protected toCounterData(): CounterData {
    return {
      code: this._code,
      count: this._count,
      fullSize: this._fullSize,
      fullSizeB2: this._fullSizeB2,
      qb64: this._qb64,
      name: this._name,
      version: { ...this._version },
    };
  }

  get code(): string {
    return this._code;
  }

  get count(): number {
    return this._count;
  }

  get fullSize(): number {
    return this._fullSize;
  }

  get fullSizeB2(): number {
    return this._fullSizeB2;
  }

  get qb64(): string {
    return this._qb64;
  }

  get qb64b(): Uint8Array {
    return new TextEncoder().encode(this._qb64);
  }

  get qb2(): Uint8Array {
    return codeB64ToB2(this._qb64);
  }

  get name(): string {
    return this._name;
  }

  get version(): Versionage {
    return { ...this._version };
  }

  equals(other: { qb64: string }): boolean {
    return this._qb64 === other.qb64;
  }

  toString(): string {
    return this._qb64;
  }
}

/**
 * Parsed counter-group container with raw counted payload and hydrated entries.
 *
 * This is parser-facing structure used for primitive-graph attachment outputs.
 */
export class CounterGroup extends Counter {
  readonly raw: Uint8Array;
  readonly items: readonly GroupEntry[];

  constructor(counter: Counter, raw: Uint8Array, items: readonly GroupEntry[]) {
    super(counter);
    this.raw = raw.slice();
    this.items = items;
  }
}

/** Parse counter from text-domain CESR bytes using provided version context. */
export function parseCounterFromText(
  input: Uint8Array,
  version: Versionage,
): Counter {
  return new Counter(parseCounterFromTextData(input, version));
}

/** Parse counter from binary-domain CESR bytes using provided version context. */
export function parseCounterFromBinary(
  input: Uint8Array,
  version: Versionage,
): Counter {
  return new Counter(parseCounterFromBinaryData(input, version));
}

/** Parse counter using domain hint (`txt` or `bny`) and versioned codex tables. */
export function parseCounter(
  input: Uint8Array,
  version: Versionage,
  cold: Extract<ColdCode, "txt" | "bny">,
): Counter {
  return cold === "bny"
    ? parseCounterFromBinary(input, version)
    : parseCounterFromText(input, version);
}
