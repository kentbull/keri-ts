import { DecodeError, Decoder, ExtensionCodec } from "@msgpack/msgpack";
import { codecSyntaxFailure } from "../core/codec-errors.ts";

const standard = new ExtensionCodec();
const standardDecode = standard.decode.bind(standard);
const standardEncode = standard.tryToEncode.bind(standard);
const codec = Object.freeze({ decode: standardDecode, tryToEncode: standardEncode });

/**
 * Decode with standard timestamp/ExtData semantics; global custom extensions and key caching stay outside.
 * The root guard admits a map; schema-defined keys and extension values remain
 * unknown here. Serder owns validation of named protocol fields after decode.
 */
export function decodeAdmittedMsgpack(
  raw: Uint8Array,
  boundaryFailure: boolean,
  onFailure?: (error: unknown) => void,
): Record<string, unknown> {
  const decoder = new Decoder({ extensionCodec: codec, keyDecoder: null });
  let value: unknown;
  try {
    value = decoder.decode(raw);
  } catch (error) {
    if (
      !(error instanceof DecodeError || (boundaryFailure && error instanceof RangeError))
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
