import type { CesrBody } from "../core/types.ts";
import type { Smellage } from "../core/types.ts";
import { DeserializeError } from "../core/errors.ts";
import { decode as decodeMsgpack } from "@msgpack/msgpack";
import { decode as decodeCbor } from "cbor-x/decode";

function normalizeDecodedMap(
  value: unknown,
  kind: "JSON" | "CBOR" | "MGPK" | "CESR",
): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (value instanceof Map) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of value.entries()) {
        if (typeof k !== "string") {
          throw new DeserializeError(`${kind} map key must be a string`);
        }
        out[k] = v;
      }
      return out;
    }
    return value as Record<string, unknown>;
  }
  throw new DeserializeError(`${kind} root must be a map/object`);
}

// TODO should this be called parseBody?
//   If we're going to say parseSerder then it should doo a full deserialization
//   and the CesrBody should be a Serder with subclasses for SerderKERI and SerderACDC
export function parseSerder(
  raw: Uint8Array,
  smellage: Smellage,
): CesrBody {
  const { proto, kind, pvrsn, gvrsn, size } = smellage;
  let ked: Record<string, unknown> | null = null;
  let ilk: string | null = null;
  let said: string | null = null;

  try {
    if (kind === "JSON") {
      const text = new TextDecoder().decode(raw);
      ked = JSON.parse(text) as Record<string, unknown>;
    } else if (kind === "MGPK") {
      ked = normalizeDecodedMap(decodeMsgpack(raw), kind);
    } else if (kind === "CBOR") {
      ked = normalizeDecodedMap(decodeCbor(raw), kind);
    }
    if (ked) {
      ilk = typeof ked.t === "string" ? ked.t : null;
      said = typeof ked.d === "string" ? ked.d : null;
    }
  } catch (error) {
    if (error instanceof DeserializeError) {
      throw new DeserializeError(
        `Failed to decode ${kind} Serder: ${String(error.message)}`,
      );
    }
    if (kind === "JSON" && error instanceof SyntaxError) {
      throw new DeserializeError(
        `Failed to decode JSON Serder: ${String(error)}`,
      );
    }
    if (kind === "MGPK" || kind === "CBOR") {
      throw new DeserializeError(
        `Failed to decode ${kind} Serder: ${String(error)}`,
      );
    }
    throw error;
  }

  // TODO support SerderKERI and SerderACDC.
  //   Is that done at this level or the next level up?

  return { raw, ked, proto, kind, size, pvrsn, gvrsn, ilk, said };
}
