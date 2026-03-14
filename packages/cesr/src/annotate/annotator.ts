import { parseBytes } from "../core/parser-engine.ts";
import type { CesrFrame } from "../core/types.ts";
import {
  renderAnnotatedFrames,
  renderWrapperAnnotatedStream,
} from "./render.ts";
import type { AnnotatedFrame, AnnotateOptions } from "./types.ts";
import { b } from '../core/bytes.ts'

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

export function annotateFrames(
  input: Uint8Array | string,
  options?: AnnotateOptions,
): AnnotatedFrame[] {
  const opts = resolveOptions(options);
  const bytes = typeof input === "string"
    ? b(input)
    : input;
  const frames = parsedFramesOrThrow(parseBytes(bytes));
  return renderAnnotatedFrames(frames, opts);
}

export function annotate(
  input: Uint8Array | string,
  options?: AnnotateOptions,
): string {
  const opts = resolveOptions(options);
  const bytes = typeof input === "string"
    ? b(input)
    : input;
  const wrapperAnnotated = renderWrapperAnnotatedStream(bytes, opts);
  if (wrapperAnnotated !== null) {
    return wrapperAnnotated;
  }
  const frames = annotateFrames(bytes, opts);
  return frames.map((frame) => frame.lines.join("\n")).join("\n");
}
