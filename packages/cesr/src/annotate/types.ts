import type { CesrMessage } from "../core/types.ts";

/** Rendering options for maintainer-facing CESR annotation output. */
export interface AnnotateOptions {
  commentMode?: "inline" | "above";
  indent?: number;
  showOffsets?: boolean;
  showRawHex?: boolean;
  domainHint?: "txt" | "bny" | "auto";
  pretty?: boolean;
}

/** Annotated line set for one parsed frame. */
export interface AnnotatedFrame {
  index: number;
  frame: CesrMessage;
  lines: string[];
}
