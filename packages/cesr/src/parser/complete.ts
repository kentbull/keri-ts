import type { CesrFrame } from "../core/types.ts";
import type { Versionage } from "../tables/table-types.ts";
import { decodeNext } from "./decoder.ts";

/** Decode complete input synchronously through the same finite engine used for network fragments. */
export function parseBytes(bytes: Uint8Array): CesrFrame[] {
  const frames: CesrFrame[] = [];
  let offset = 0;
  let selected: Versionage | null = null;
  while (offset < bytes.length) {
    const unit = decodeNext(bytes.subarray(offset), selected, true, () => {});
    let step = unit.next();
    while (!step.done) {
      frames.push(step.value);
      step = unit.next();
    }
    offset += step.value.consumed;
    selected = step.value.selected;
  }
  return frames;
}
