import type { CesrMessage } from "../core/types.ts";

export interface AnnotateOptions {
  commentMode?: "inline" | "above";
  indent?: number;
  showOffsets?: boolean;
  showRawHex?: boolean;
  domainHint?: "txt" | "bny" | "auto";
  pretty?: boolean;
}

export interface AnnotatedFrame {
  index: number;
  frame: CesrMessage;
  lines: string[];
}
