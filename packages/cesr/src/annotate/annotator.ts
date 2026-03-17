import { b } from "../core/bytes.ts";
import { parseBytes } from "../core/parser-engine.ts";
import type { CesrFrame } from "../core/types.ts";
import { renderAnnotatedFrames, renderWrapperAnnotatedStream } from "./render.ts";
import type { AnnotatedFrame, AnnotateOptions } from "./types.ts";

const DEFAULT_OPTIONS: Required<AnnotateOptions> = Object.freeze({
  commentMode: "inline",
  indent: 2,
  showOffsets: false,
  showRawHex: false,
  domainHint: "auto",
  pretty: false,
});

function resolveOptions(options?: AnnotateOptions): Required<AnnotateOptions> {
  return {
    ...DEFAULT_OPTIONS,
    ...options,
  };
}

function parsedFramesOrThrow(frames: CesrFrame[]) {
  const parsedFrames = [];
  for (const frame of frames) {
    if (frame.type === "error") {
      throw frame.error;
    }
    parsedFrames.push(frame.frame);
  }
  return parsedFrames;
}

/**
 * Parse input and return one annotation structure per emitted frame.
 *
 * Use this when callers want to inspect annotation lines programmatically
 * instead of flattening the whole stream to one rendered string.
 */
export function annotateFrames(
  input: Uint8Array | string,
  options?: AnnotateOptions,
): AnnotatedFrame[] {
  const opts = resolveOptions(options);
  const bytes = typeof input === "string" ? b(input) : input;
  const frames = parsedFramesOrThrow(parseBytes(bytes));
  return renderAnnotatedFrames(frames, opts);
}

/**
 * Render one CESR stream into maintainer-oriented annotated text.
 *
 * Wrapper-aware rendering is attempted first so opaque wrapper payloads can be
 * preserved faithfully before falling back to frame-by-frame annotation.
 */
export function annotate(
  input: Uint8Array | string,
  options?: AnnotateOptions,
): string {
  const opts = resolveOptions(options);
  const bytes = typeof input === "string" ? b(input) : input;
  const wrapperAnnotated = renderWrapperAnnotatedStream(bytes, opts);
  if (wrapperAnnotated !== null) {
    return wrapperAnnotated;
  }
  const frames = annotateFrames(bytes, opts);
  return frames.map((frame) => frame.lines.join("\n")).join("\n");
}
