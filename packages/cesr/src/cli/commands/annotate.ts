import { annotate } from "../../annotate/annotator.ts";
import type { CliIo } from "../types.ts";

interface AnnotateCliOptions {
  inPath?: string;
  outPath?: string;
  qb2: boolean;
  pretty: boolean;
}

const TEXT_DECODER = new TextDecoder();
const ANNOTATE_USAGE = "Usage: cesr annotate [--in <path>] [--out <path>] [--qb2] [--pretty]";

/** Parse `cesr annotate` command-line flags without performing IO. */
function parseArgs(args: string[]): AnnotateCliOptions {
  const out: AnnotateCliOptions = { qb2: false, pretty: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--qb2") {
      out.qb2 = true;
      continue;
    }
    if (arg === "--pretty") {
      out.pretty = true;
      continue;
    }
    if (arg === "--in") {
      const next = args[i + 1];
      if (!next) throw new Error("Missing value for --in");
      out.inPath = next;
      i++;
      continue;
    }
    if (arg === "--out") {
      const next = args[i + 1];
      if (!next) throw new Error("Missing value for --out");
      out.outPath = next;
      i++;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

/**
 * Execute `cesr annotate`.
 *
 * The command preserves the old `cesr-annotate` behavior while moving it under
 * the package-level dispatcher.
 */
export async function annotateCommand(args: string[], io: CliIo): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    await io.writeStdout(`${ANNOTATE_USAGE}\n`);
    return 0;
  }

  try {
    const options = parseArgs(args);
    const inputBytes = options.inPath
      ? await io.readFile(options.inPath)
      : await io.readStdin();

    const annotated = options.qb2
      ? annotate(inputBytes, { domainHint: "bny", pretty: options.pretty })
      : annotate(TEXT_DECODER.decode(inputBytes), {
        domainHint: "txt",
        pretty: options.pretty,
      });

    if (options.outPath) {
      await io.writeTextFile(options.outPath, annotated);
    } else {
      await io.writeStdout(`${annotated}\n`);
    }

    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await io.writeStderr(`cesr annotate error: ${message}\n`);
    return 1;
  }
}
