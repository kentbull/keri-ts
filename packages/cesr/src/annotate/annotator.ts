import { b } from "../core/bytes.ts";
import { discardFrame } from "../core/frame.ts";
import type { CesrFrame } from "../core/types.ts";
import { parseBytes } from "../parser/complete.ts";
import { renderAnnotatedFrames } from "./render.ts";
import type { AnnotatedFrame, AnnotateOptions, RenderOptions } from "./types.ts";

/** Presentation defaults do not change protocol parsing. */
const DEFAULT_OPTIONS: RenderOptions = Object.freeze({
  commentMode: "inline",
  indent: 2,
  pretty: false,
});

/** Release every collected payload, including siblings after one storage cleanup fails. */
async function discardFrames(frames: readonly CesrFrame[]): Promise<void> {
  const results = await Promise.allSettled(frames.map((frame) => discardFrame(frame)));
  const errors = results.filter((result) => result.status === "rejected").map((result) => result.reason);
  if (errors.length) throw new AggregateError(errors, "Annotation payload cleanup failed");
}

/**
 * Annotate finite input with the progressive engine and original wrapper wire.
 * Successful callers own the returned frame trees and release them with discardFrame.
 * A parse or rendering failure releases every payload before rejecting.
 */
export async function annotateFrames(
  input: Uint8Array | string,
  options: AnnotateOptions = {},
): Promise<AnnotatedFrame[]> {
  const bytes = typeof input === "string" ? b(input) : input;
  const frames = await parseBytes(bytes, { signal: options.signal });
  try {
    return renderAnnotatedFrames(frames, { ...DEFAULT_OPTIONS, ...options }, bytes);
  } catch (error) {
    try {
      await discardFrames(frames);
    } catch (cleanup) {
      throw new AggregateError([error, cleanup], "Annotation and payload cleanup failed", { cause: error });
    }
    throw error;
  }
}

/** Render finite annotation text, releasing every temporary ESSR payload after rendering. */
export async function annotate(input: Uint8Array | string, options: AnnotateOptions = {}): Promise<string> {
  const frames = await annotateFrames(input, options);
  try {
    return frames.map((frame) => frame.lines.join("\n")).join("\n");
  } finally {
    await discardFrames(frames.map((frame) => frame.frame));
  }
}
