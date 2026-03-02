import { annotate } from "cesr-ts";
import { type Operation } from "npm:effection@^3.6.0";
import { colorizeAnnotatedOutput } from "./annotate-color.ts";

const TEXT_DECODER = new TextDecoder();

interface AnnotateArgs {
  /**
   * Path to CESR stream to be annotated
   */
  inPath?: string;
  /**
   * Path to write annotated CESR stream
   */
  outPath?: string;
  /**
   * Whether to treat input as binary domain bytes
   */
  qb2?: boolean;
  /**
   * Whether to pretty-print JSON objects in annotation output
   */
  pretty?: boolean;
  /**
   * Whether to colorize stdout annotation output
   */
  colored?: boolean;
}

/**
 * Reads bytes from stdin in chunks of 64KB and returns them as a single Uint8Array
 * @returns All bytes read from stdin
 */
function readAllStdinSync(): Uint8Array {
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const chunk = new Uint8Array(64 * 1024); // 64KB chunk size
    const read = Deno.stdin.readSync(chunk); // reads up to 64KB chunk, returns num bytes
    if (read === null) {
      // read until EOF (null)
      break;
    }

    const used = chunk.subarray(0, read);
    chunks.push(used);
    total += read;
  }

  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }

  return output;
}

// deno-lint-ignore require-yield
export function* annotateCommand(
  args: Record<string, unknown>,
): Operation<void> {
  const options: AnnotateArgs = {
    inPath: args.inPath as string | undefined,
    outPath: args.outPath as string | undefined,
    qb2: args.qb2 as boolean | undefined,
    pretty: args.pretty as boolean | undefined,
    colored: args.colored as boolean | undefined,
  };

  const inputBytes = options.inPath
    ? Deno.readFileSync(options.inPath)
    : readAllStdinSync();

  const annotated = options.qb2
    ? annotate(inputBytes, { domainHint: "bny", pretty: options.pretty })
    : annotate(TEXT_DECODER.decode(inputBytes), {
      domainHint: "txt",
      pretty: options.pretty,
    });

  if (options.outPath) {
    Deno.writeTextFileSync(options.outPath, annotated);
    return;
  }

  const output = options.colored
    ? colorizeAnnotatedOutput(annotated)
    : annotated;
  console.log(output);
}
