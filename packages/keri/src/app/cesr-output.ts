/** Metadata admission shared by HTTP and TCP serializers of already admitted frame trees. */
import type { CesrFrame } from "cesr-ts";

/** Count finite ordinary metadata without qualifying bytes or opening any ESSR owner. */
export function cesrOutputMetadataBytes(root: CesrFrame): number {
  let size = root.body.raw.length;
  for (const group of root.attachments) size += group.raw.length;
  for (const child of root.nests ?? []) size += cesrOutputMetadataBytes(child);
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new RangeError("output metadata bytes must be a non-negative safe integer");
  }
  return size;
}
