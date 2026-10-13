import type { CesrDomain, CesrFrame } from "../core/types.ts";

/** Rendering options for maintainer-facing CESR annotation output. */
export interface AnnotateOptions {
  commentMode?: "inline" | "above";
  indent?: number;
  showOffsets?: boolean;
  showRawHex?: boolean;
  domainHint?: CesrDomain | "auto";
  pretty?: boolean;
}

/** Annotated line set for one parsed frame. */
export interface AnnotatedFrame {
  index: number;
  frame: CesrFrame;
  lines: string[];
}
