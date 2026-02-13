import type { CesrFrame } from "../core/types.ts";

export interface AnnotateOptions {
  commentMode?: "inline" | "above";
  indent?: number;
  showOffsets?: boolean;
  showRawHex?: boolean;
  domainHint?: "txt" | "bny" | "auto";
}

export interface AnnotatedFrame {
  index: number;
  frame: CesrFrame;
  lines: string[];
}
