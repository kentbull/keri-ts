import { intToB64 } from "../../src/core/bytes.ts";
import {
  COUNTER_SIZES_V1,
  COUNTER_SIZES_V2,
} from "../../src/tables/counter.tables.generated.ts";
import { MATTER_SIZES } from "../../src/tables/matter.tables.generated.ts";

/** Build a v1 counter token with code-specific size encoding. */
export function counterV1(code: string, count: number): string {
  const sizage = COUNTER_SIZES_V1.get(code);
  if (!sizage) throw new Error(`Unknown v1 counter code ${code}`);
  return `${code}${intToB64(count, sizage.ss)}`;
}

/** Build a v2 counter token with code-specific size encoding. */
export function counterV2(code: string, count: number): string {
  const sizage = COUNTER_SIZES_V2.get(code);
  if (!sizage) throw new Error(`Unknown v2 counter code ${code}`);
  return `${code}${intToB64(count, sizage.ss)}`;
}

/** Deterministic fixed-size indexer token used in attachment fixtures. */
export function sigerToken(): string {
  return `A${"A".repeat(87)}`;
}

/** Deterministic fixed-size matter token for primitive tests. */
export function token(code: string): string {
  const sizage = MATTER_SIZES.get(code);
  if (!sizage || sizage.fs === null) {
    throw new Error(`Need fixed-size code for token, got ${code}`);
  }
  return code + "A".repeat(sizage.fs - code.length);
}
