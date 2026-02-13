import type { SerderEnvelope } from "../core/types.ts";
import type { Smellage } from "../core/types.ts";
import { DeserializeError } from "../core/errors.ts";

export function parseSerder(
  raw: Uint8Array,
  smellage: Smellage,
): SerderEnvelope {
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
      throw new DeserializeError(
        `Failed to decode JSON Serder: ${String(error)}`,
      );
    }
  }

  return { raw, ked, proto, kind, size, pvrsn, gvrsn, ilk, said };
}
