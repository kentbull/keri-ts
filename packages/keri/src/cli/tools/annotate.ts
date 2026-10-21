import { annotate } from "cesr-ts";
import type { Operation } from "npm:effection@^3.6.0";
import { abortable } from "../../app/runtime/abortable.ts";
import { collectBytes, fileBytes, streamBytes } from "../../app/transport/byte-source.ts";
import { parseBooleanOption, parseStringOption } from "../common/parsing.ts";
import { writeStdout } from "../output.ts";
import { colorizeAnnotatedOutput } from "./annotate-color.ts";

/** CLI presentation flags. */
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
  const options: AnnotateArgs = {
    inPath: parseStringOption(args.inPath, "inPath"),
    outPath: parseStringOption(args.outPath, "outPath"),
    pretty: parseBooleanOption(args.pretty, "pretty"),
    colored: parseBooleanOption(args.colored, "colored"),
  };
  const bytes = yield* abortable((signal) =>
    collectBytes(options.inPath ? fileBytes(options.inPath, { signal }) : streamBytes(Deno.stdin.readable, { signal }))
  );
  const text = annotate(bytes, { pretty: options.pretty });
  if (options.outPath) {
    yield* abortable((signal) => Deno.writeTextFile(options.outPath!, text, { signal }));
  } else {
    const output = options.colored ? colorizeAnnotatedOutput(text) : text;
    yield* abortable((signal) => writeStdout(`${output}\n`, signal));
  }
}
