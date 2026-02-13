import { smell } from "./smell.ts";
import { parseSerder } from "./serder.ts";
import type { SerderEnvelope } from "../core/types.ts";
import { ShortageError } from "../core/errors.ts";

export function reapSerder(
  input: Uint8Array,
): { serder: SerderEnvelope; consumed: number } {
  const { smellage } = smell(input);
  if (input.length < smellage.size) {
    throw new ShortageError(smellage.size, input.length);
  }
  const raw = input.slice(0, smellage.size);
  const serder = parseSerder(raw, smellage);
  return { serder, consumed: smellage.size };
}
