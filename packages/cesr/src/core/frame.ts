import type { CesrFrame } from "./types.ts";
/** Fail explicitly until a consumer implements nested-message evidence and ownership. */
export function requireFlatFrame(frame: CesrFrame, consumer: string): void {
  if (frame.nests?.length) throw new Error(`${consumer} does not yet support nested message trees`);
}
