import { ShortageError } from "../core/errors.ts";
import type { CesrBody } from "../core/types.ts";
import { reapCesrNativeBody } from "./native.ts";
import { parseSerder } from "./serder.ts";
import { smell } from "./smell.ts";

/**
 * Protocol-aware serder factory, matching KERIpy's "reap one body from a
 * stream head" role.
 *
 * Maintainer note:
 * non-native bodies can still be `smell()`ed directly, but native body groups
 * cannot. This class owns the small amount of native pre-read needed to derive
 * smellage-equivalent metadata before delegating to `parseSerder`.
 *
 * Example:
 *
 * ```ts
 * const { serder } = new Serdery().reap(
 *   new TextEncoder().encode("-FA50OKERICAACAXicp...")
 * );
 * // serder.kind === "CESR"
 * // serder.ked?.t === "icp"
 * ```
 */
export class Serdery {
  /**
   * Reap one serder from the current head of `input`, consuming only its body span.
   *
   * For native bodies this means:
   * 1. detect `FixBodyGroup` / `MapBodyGroup`
   * 2. canonicalize qb2 to qb64 if needed
   * 3. pre-read version metadata from compact native fields
   * 4. delegate full hydration to `parseSerder`
   *
   * Maintainer note:
   * "candidate native body-group code" is broader than "valid protocol
   * message". For example, KERI top-level native messages must still be fixed
   * field even though `MapBodyGroup` remains a valid native framing shape in
   * the wider CESR/ACDC world. The protocol-specific decoder is responsible
   * for that final acceptance decision.
   */
  reap(input: Uint8Array): { serder: CesrBody; consumed: number } {
    const native = reapCesrNativeBody(input);
    if (native) {
      return {
        serder: parseSerder(native.raw, native.smellage),
        consumed: native.consumed,
      };
    }

    const { smellage } = smell(input);
    if (input.length < smellage.size) {
      throw new ShortageError(smellage.size, input.length);
    }
    const raw = input.slice(0, smellage.size);
    const serder = parseSerder(raw, smellage);
    return { serder, consumed: smellage.size };
  }
}

/** Convenience wrapper for one-shot `Serdery.reap()` call sites. */
export function reapSerder(
  input: Uint8Array,
): { serder: CesrBody; consumed: number } {
  return new Serdery().reap(input);
}
