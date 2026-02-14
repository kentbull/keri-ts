import { parseBytes } from "../core/parser-engine.ts";
import type { ParseEmission } from "../core/types.ts";
import { renderAnnotatedFrames } from "./render.ts";
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

function framesOrThrow(emissions: ParseEmission[]) {
  const frames = [];
  for (const emission of emissions) {
    if (emission.type === "error") {
      throw emission.error;
    }
    frames.push(emission.frame);
  }
  return frames;
}

export function annotateFrames(
  input: Uint8Array | string,
  options?: AnnotateOptions,
): AnnotatedFrame[] {
  const opts = resolveOptions(options);
  const bytes = typeof input === "string"
    ? new TextEncoder().encode(input)
    : input;
  const frames = framesOrThrow(parseBytes(bytes));
  return renderAnnotatedFrames(frames, opts);
}

export function annotate(
  input: Uint8Array | string,
  options?: AnnotateOptions,
): string {
  const frames = annotateFrames(input, options);
  return frames.map((frame) => frame.lines.join("\n")).join("\n");
}
