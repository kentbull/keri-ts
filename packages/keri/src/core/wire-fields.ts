/**
 * Guarded readers for the field values of remote messages.
 *
 * A remote message can parse and verify its SAID while a field value is still not a valid value for its type: a
 * non-hex or over-wide sequence number, a key that is not a verification key, a next-key digest that is not a digest,
 * a prefix that is not a prefix. The cesr accessors and primitive constructors throw on such values, and a throw out
 * of a processor ends its loop (the mailbox poller, the escrow doer, HTTP ingress). Processor boundaries therefore read
 * remote field values through these readers and turn a null into their own typed refusal (ADR-0005) before any escrow
 * decision or store write: `Kevery.decideEvent` and `processReceipt`, the reply route handlers and `Revery`'s
 * datetime read, `Exchanger` admission and `queryEnvelopeFromDispatch`. Accepted KEL events are remote-authored too:
 * their raw `a` seals are read through `readEventSeal` wherever an anchor is searched.
 *
 * Only the cesr codec's own malformed-input taxonomy (`ParserError` and its subclasses) is read as malformed input, and
 * only while constructing a primitive from a string the message carried. That construction reads no store, so a
 * `ParserError` there cannot be corrupt durable state or I/O; every other error propagates. Numbers are checked as
 * text before any `BigInt` conversion, so cesr's `SyntaxError`/`RangeError` for bad hex is never relied on.
 */
import {
  Dater,
  Diger,
  Ilks,
  type MatterInit,
  NumberPrimitive,
  ParserError,
  Prefixer,
  SealEvent,
  type SerderKERI,
  Verfer,
} from "cesr-ts";
import { encodeDateTimeToDater } from "../time/mod.ts";

/** A cesr primitive class built from qualified text; its constructor reads nothing but its input. */
type QualifiedPrimitive<T> = new(init: MatterInit) => T;

/** Construct `Type` from qualified text, or null when the text is not a valid value of that type. */
function readQualified<T>(Type: QualifiedPrimitive<T>, value: unknown): T | null {
  if (typeof value !== "string" || !value) return null;
  try {
    return new Type({ qb64: value });
  } catch (error) {
    if (error instanceof ParserError) return null;
    throw error;
  }
}

/** Read an identifier prefix (`i`, `di`, `cid`, `eid`, ...), or null when it is not one. */
export function readPrefixer(value: unknown): Prefixer | null {
  return readQualified(Prefixer, value);
}

/** Read a digest (`d` of a key state notice, a next-key digest), or null when it is not one. */
export function readDiger(value: unknown): Diger | null {
  return readQualified(Diger, value);
}

/** Read a verification key (a current key, a witness), or null when it is not one. */
export function readVerfer(value: unknown): Verfer | null {
  return readQualified(Verfer, value);
}

/** Read a datetime (`dt`) as a Dater, or null when it does not encode as one. */
export function readDater(value: unknown): Dater | null {
  return typeof value === "string" ? readQualified(Dater, encodeDateTimeToDater(value)) : null;
}

/** Read a URL, or null when it does not parse. */
export function readUrl(value: string): URL | null {
  return URL.canParse(value) ? new URL(value) : null;
}

/**
 * Read a KERI ordinal: lower- or upper-case hex text, or a non-negative integer number or bigint, as cesr's numeric
 * ladder accepts them. Null when it is none of those or exceeds `Number.MAX_SAFE_INTEGER`, the largest value the KEL
 * processors can compare exactly as a number.
 */
export function readOrdinal(value: unknown): number | null {
  let ordinal: bigint;
  if (typeof value === "string") {
    if (!/^[0-9a-f]+$/iu.test(value)) return null;
    ordinal = BigInt(`0x${value}`);
  } else if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) return null;
    ordinal = BigInt(value);
  } else if (typeof value === "bigint") {
    ordinal = value;
  } else {
    return null;
  }
  return ordinal >= 0n && ordinal <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(ordinal) : null;
}

/** Read a message's `s`, which cesr's `sner` reads only as hex text; null when absent or malformed. */
export function readSequenceNumber(serder: SerderKERI): number | null {
  const sn = serder.ked?.s;
  return typeof sn === "string" ? readOrdinal(sn) : null;
}

/**
 * Name the first field of a KEL event whose value the key-state machine would fail to decode, or null when all decode.
 *
 * Covers what `Kever` and escrow persistence decode beyond `i` and `s` (which `decideEvent` reads first): current keys
 * `k` and next-key digests `n` of establishment events, witnesses `b` and witness changes `br`/`ba`, the witness
 * threshold `bt`, and the delegator `di` of a delegated inception. Thresholds (`kt`, `nt`) already decode to null and are
 * rejected by `Kever`; raw seals in `a` are not decoded here.
 */
export function kelEventFieldDefect(serder: SerderKERI): string | null {
  const ked = serder.ked ?? {};
  const ilk = serder.ilk;
  const bad = (label: string, values: readonly string[], read: (value: string) => unknown) => {
    const value = values.find((entry) => read(entry) === null);
    return value === undefined ? null : `${label} ${JSON.stringify(value)}`;
  };
  return bad("key", serder.keys, readVerfer)
    ?? bad("next key digest", serder.ndigs, readDiger)
    ?? bad("witness", serder.backs, readVerfer)
    ?? bad("witness cut", serder.cuts, readVerfer)
    ?? bad("witness add", serder.adds, readVerfer)
    ?? (ked.bt !== undefined && ked.bt !== null && readOrdinal(ked.bt) === null
      ? `witness threshold ${JSON.stringify(ked.bt)}`
      : null)
    ?? (ilk === Ilks.dip && serder.delpre !== null && !readPrefixer(serder.delpre)
      ? `delegator ${JSON.stringify(serder.delpre)}`
      : null);
}

/**
 * Read one raw `a` entry as an event seal `{i, s, d}`, or null when it is another seal shape or carries a value that
 * does not decode.
 *
 * An accepted event's seals are not value-checked at acceptance (KERIpy keeps them as raw dicts), so any identifier can
 * anchor junk in its own KEL. Anchor searches (delegation approval, sealing-event lookup) therefore read each entry
 * through this reader and skip a null instead of throwing. KERIpy filters by the same field shape
 * (`tuple(seal) == SealEvent._fields`) and compares raw strings, so a malformed value can never match a real event.
 */
export function readEventSeal(value: unknown): SealEvent | null {
  if (!SealEvent.isSad(value)) return null;
  const pre = readPrefixer(value.i);
  const sn = readOrdinal(value.s);
  const said = readDiger(value.d);
  return pre && sn !== null && said ? SealEvent.fromTuple([pre, NumberPrimitive.fromNum(BigInt(sn)), said]) : null;
}
