import { DecodeError, Decoder, ExtensionCodec } from "@msgpack/msgpack";
import { DeserializeError, ResourceLimitError } from "../core/errors.ts";
import type { DecodedBodyBudget } from "./body-admission.ts";

const syntaxFailures = new WeakSet<DeserializeError>();
const nativeDecode = Decoder.prototype.decode;
const nativeTextDecode = TextDecoder.prototype.decode;
const NativeArray = Array;
const standard = new ExtensionCodec();
const standardDecode = standard.decode.bind(standard);
const standardEncode = standard.tryToEncode.bind(standard);
const codec = Object.freeze({ decode: standardDecode, tryToEncode: standardEncode });

/** Identify only this admitted codec invocation's own intrinsic refusal. */
export function isMsgpackSyntaxFailure(error: unknown): boolean {
  return error instanceof DeserializeError && syntaxFailures.has(error);
}

/** Decode with standard timestamp/ExtData semantics; global custom extensions and key caching stay outside. */
export function decodeAdmittedMsgpack(
  raw: Uint8Array,
  boundaryFailure: boolean,
  onFailure?: (error: unknown) => void,
): Record<string, unknown> {
  const decoder = new Decoder({ extensionCodec: codec, keyDecoder: null });
  const decode = decoder.decode;
  let value: unknown;
  try {
    value = decode.call(decoder, raw);
  } catch (error) {
    if (
      decode !== nativeDecode || TextDecoder.prototype.decode !== nativeTextDecode || Array !== NativeArray
      || !(error instanceof DecodeError || (boundaryFailure && error instanceof RangeError))
    ) {
      onFailure?.(error);
      throw error;
    }
    const refusal = new DeserializeError(`Failed to decode MGPK Serder: ${String(error)}`);
    syntaxFailures.add(refusal);
    throw refusal;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    const refusal = new DeserializeError("MGPK root must be a map/object");
    syntaxFailures.add(refusal);
    throw refusal;
  }
  return value as Record<string, unknown>;
}

/**
 * Scan token extents without constructing values or imposing syntax/depth limits.
 * Declared container capacity is charged before members, including truncated arrays/maps.
 * The pinned decoder remains semantic authority; trailing/invalid data stops inspection.
 */
export function admitMsgpack(raw: Uint8Array, budget: DecodedBodyBudget): boolean {
  if (!Number.isSafeInteger(budget.decodedBytes) || budget.decodedBytes < 0) {
    throw new RangeError("Decoded credit must be a non-negative safe integer");
  }
  budget.admitStage?.(64); // Constant scalar scanner workspace precedes inspection.
  let remaining = budget.decodedBytes;
  let pending = 1, offset = 0, states = 0, extensions = 0, shortString = 0, shortage = false;
  while (offset < raw.length && pending > 0) {
    const token = raw[offset++];
    let width = 0, size = 0, payload = 0, charge = 16;
    let kind: "scalar" | "array" | "map" | "string" | "binary" | "extension" = "scalar";
    if (token < 0x80 || token >= 0xe0 || token === 0xc0 || token === 0xc2 || token === 0xc3) {
      // Scalars may become map labels: sign +17 digits +dot/e/exponent sign +3 exponent digits.
      charge += 8 + 2 * 24;
    } else if (token < 0x90) {
      kind = "map";
      size = token & 15;
    } else if (token < 0xa0) {
      kind = "array";
      size = token & 15;
    } else if (token < 0xc0) {
      kind = "string";
      size = token & 31;
    } else if (token >= 0xc4 && token <= 0xc9) {
      width = 2 ** ((token - 0xc4) % 3);
      kind = token <= 0xc6 ? "binary" : "extension";
    } else if (token === 0xca || token === 0xcb) {
      payload = token === 0xca ? 4 : 8;
      charge += 8 + 2 * 24;
    } else if (token >= 0xcc && token <= 0xd3) {
      payload = 2 ** ((token - 0xcc) % 4);
      charge += 8 + 2 * 24;
    } else if (token >= 0xd4 && token <= 0xd8) {
      kind = "extension";
      size = 2 ** (token - 0xd4);
    } else if (token >= 0xd9 && token <= 0xdb) {
      kind = "string";
      width = 2 ** (token - 0xd9);
    } else if (token >= 0xdc && token <= 0xdf) {
      kind = token <= 0xdd ? "array" : "map";
      width = token % 2 === 0 ? 2 : 4;
    } else break; // Reserved 0xc1 is left to the codec.
    if (width > raw.length - offset) {
      shortage = true;
      break;
    }
    for (let index = 0; index < width; index++) size = size * 256 + raw[offset++];
    if (kind === "array" || kind === "map") {
      charge += 64 + size * (kind === "array" ? 16 : 48);
      if (size > 0) states++;
    } else if (kind === "string") {
      charge += 2 * size;
      payload = size;
      shortString = Math.max(shortString, Math.min(size, 200));
    } else if (kind === "binary") {
      charge += 64 + size;
      payload = size;
    } else if (kind === "extension") {
      charge += 64 + 2 * 16 + 8 + 64 + size; // ExtData/type/view (also bounds timestamp Date).
      payload = size + 1; // Signed extension selector precedes its bytes.
      extensions++;
    }
    if (charge > remaining) throw new ResourceLimitError("MGPK exceeds decoded tree credit");
    remaining -= charge;
    pending--;
    if (kind === "array" || kind === "map") pending += size * (kind === "map" ? 2 : 1);
    if (payload > raw.length - offset) {
      shortage = true;
      break;
    }
    offset += payload;
  }
  // Pinned 3.1.3: 18-field Decoder, StackPool/array/view; seven-field pooled state per container.
  // Short UTF8 paths use an array of scalar units (<=200), plus a temporary string.
  // Timestamp decoding has a two-field timespec/DataView; copy credit stays conservative on reuse.
  const working = 64 + 18 * 16 + 64 + 2 * 16 + 64 + 64 + 64 + 26 * shortString
    + 64 + 2 * 16 + states * (64 + 7 * 16 + 16) + extensions * (64 + 2 * 16 + 2 * 8 + 64) + raw.length;
  const charge = budget.decodedBytes - remaining;
  if (!Number.isSafeInteger(working)) throw new ResourceLimitError("MGPK working extent exceeds safe accounting");
  budget.admitStage?.(working);
  budget.admitStage?.(charge);
  budget.decodedBytes = remaining;
  return shortage || pending > 0 || offset < raw.length;
}
