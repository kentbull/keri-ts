import type { CesrBody } from "../core/types.ts";
import type { Smellage } from "../core/types.ts";
import { DeserializeError } from "../core/errors.ts";

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

  if (kind === "JSON") {
    const text = new TextDecoder().decode(raw);
    try {
      ked = JSON.parse(text) as Record<string, unknown>;
      ilk = typeof ked.t === "string" ? ked.t : null;
      said = typeof ked.d === "string" ? ked.d : null;
    } catch (error) {
      if (!(error instanceof SyntaxError)) {
        throw error;
      }
      throw new DeserializeError(
        `Failed to decode JSON Serder: ${String(error)}`,
      );
    }
  }

  // TODO support SerderKERI and SerderACDC.
  //   Is that done at this level or the next level up?

  return { raw, ked, proto, kind, size, pvrsn, gvrsn, ilk, said };
}
