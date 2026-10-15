import { DecodeError, Decoder, ExtensionCodec } from "@msgpack/msgpack";
import { codecSyntaxFailure } from "../core/codec-errors.ts";

const standard = new ExtensionCodec();
const standardDecode = standard.decode.bind(standard);
const standardEncode = standard.tryToEncode.bind(standard);
const codec = Object.freeze({ decode: standardDecode, tryToEncode: standardEncode });

/**
 * Decode with standard timestamp/ExtData semantics; global custom extensions and key caching stay outside.
 * The root guard requires a map; schema-defined keys and extension values remain
 * unknown here. Serder owns validation of named protocol fields after decode.
 */
export function decodeMsgpackBody(
  raw: Uint8Array,
  onFailure?: (error: unknown) => void,
): Record<string, unknown> {
  const decoder = new Decoder({ extensionCodec: codec, keyDecoder: null });
  let value: unknown;
  try {
    value = decoder.decode(raw);
  } catch (error) {
    if (
      !(error instanceof DecodeError || (error instanceof RangeError && msgpackBoundaryFailure(raw)))
    ) {
      onFailure?.(error);
      throw error;
    }
    throw codecSyntaxFailure("MGPK", `Failed to decode MGPK Serder: ${String(error)}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw codecSyntaxFailure("MGPK", "MGPK root must be a map/object");
  }
  return value as Record<string, unknown>;
}

/** Identify incomplete/trailing token extents; the native decoder still owns syntax and values. */
function msgpackBoundaryFailure(raw: Uint8Array): boolean {
  let pending = 1, offset = 0, shortage = false;
  while (offset < raw.length && pending > 0) {
    const token = raw[offset++];
    let width = 0, size = 0, payload = 0;
    let kind: "scalar" | "array" | "map" | "string" | "binary" | "extension" = "scalar";
    if (token < 0x80 || token >= 0xe0 || token === 0xc0 || token === 0xc2 || token === 0xc3) {
      // No following bytes belong to these immediate scalars.
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
    } else if (token >= 0xcc && token <= 0xd3) {
      payload = 2 ** ((token - 0xcc) % 4);
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
    if (kind === "string" || kind === "binary") payload = size;
    else if (kind === "extension") payload = size + 1; // Extension selector precedes its bytes.
    pending--;
    if (kind === "array" || kind === "map") pending += size * (kind === "map" ? 2 : 1);
    if (payload > raw.length - offset) {
      shortage = true;
      break;
    }
    offset += payload;
  }
  return shortage || pending > 0 || offset < raw.length;
}
