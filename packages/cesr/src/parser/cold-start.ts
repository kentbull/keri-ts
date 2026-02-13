import { ColdStartError, ShortageError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";

export function sniff(ims: Uint8Array): ColdCode {
  if (ims.length === 0) {
    throw new ShortageError(1, 0);
  }

  const tritet = ims[0] >> 5;
  if (tritet === 0o3 || tritet === 0o4 || tritet === 0o5 || tritet === 0o6) {
    return "msg";
  }
  if (tritet === 0o1 || tritet === 0o2) return "txt";
  if (tritet === 0o7) return "bny";
  if (tritet === 0o0) return "ano";
  throw new ColdStartError(`Unexpected tritet=${tritet} at stream start`);
}
