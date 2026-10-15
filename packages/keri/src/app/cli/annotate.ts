import { annotate } from "cesr-ts";
import type { Operation } from "npm:effection@^3.6.0";
import { abortable } from "../abortable.ts";
import { collectBytes, fileBytes, streamBytes } from "../byte-source.ts";
import { colorizeAnnotatedOutput } from "./annotate-color.ts";
import { writeStdout } from "./output.ts";

/** CLI presentation flags and an explicit finite annotation admission policy. */
interface AnnotateArgs {
  /** File input; omitted input reads stdin. */
  inPath?: string;
  /** File output; omitted output writes stdout. */
  outPath?: string;
  /** Format embedded JSON for human inspection. */
  pretty?: boolean;
  /** Apply terminal colors to stdout only. */
  colored?: boolean;
}

/** Annotate bounded file/stdin input with every I/O leaf owned by this operation. */
export function* annotateCommand(args: Record<string, unknown>): Operation<void> {
  const options = args as AnnotateArgs;
  const bytes = yield* abortable((signal) =>
    collectBytes(options.inPath ? fileBytes(options.inPath, { signal }) : streamBytes(Deno.stdin.readable, { signal }))
  );
  const text = yield* abortable((signal) =>
    annotate(bytes, {
      pretty: options.pretty,
      signal,
    })
  );
  if (options.outPath) {
    yield* abortable((signal) => Deno.writeTextFile(options.outPath!, text, { signal }));
  } else {
    const output = options.colored ? colorizeAnnotatedOutput(text) : text;
    yield* abortable((signal) => writeStdout(`${output}\n`, signal));
  }
}
