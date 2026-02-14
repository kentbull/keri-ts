import { type Operation } from "npm:effection@^3.6.0";
import { annotate } from "../../../packages/cesr/src/annotate/annotator.ts";

const TEXT_DECODER = new TextDecoder();

interface AnnotateArgs {
  inPath?: string;
  outPath?: string;
  qb2?: boolean;
  pretty?: boolean;
}

function readAllStdinSync(): Uint8Array {
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const chunk = new Uint8Array(64 * 1024);
    const read = Deno.stdin.readSync(chunk);
    if (read === null) {
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

  console.log(annotated);
}
