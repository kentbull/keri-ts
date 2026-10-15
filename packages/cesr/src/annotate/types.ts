import type { CesrFrame } from "../core/types.ts";

/** Rendering options for maintainer-facing CESR annotation output. */
export interface AnnotateOptions {
  /** Cancel parsing and release annotation-owned ESSR stages. */
  signal?: AbortSignal;
  /** Place comments beside or above each rendered token. */
  commentMode?: "inline" | "above";
  /** Spaces added by each presentation nesting level. */
  indent?: number;
  /** Pretty-print JSON bodies instead of preserving their compact whitespace. */
  pretty?: boolean;
}

/** Resolved presentation options, separate from parsing and cancellation. */
export type RenderOptions = Required<Omit<AnnotateOptions, "signal">>;

/** Annotated line set for one independently delivered root and its owned descendants. */
export interface AnnotatedFrame {
  /** One-based root ordinal in parser delivery order. */
  index: number;
  /** Parsed root; the caller owns the complete tree and releases it with discardFrame. */
  frame: CesrFrame;
  /** Rendered original wire, including wrapper headers and all descendant lines. */
  lines: string[];
}
