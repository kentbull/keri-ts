import { annotate } from "../../annotate/annotator.ts";
import { collectInput } from "../input.ts";
import type { CliIo } from "../types.ts";

/** Parsed finite annotation input and presentation choices. */
interface AnnotateCliOptions {
  /** File source; omission selects stdin. */
  inPath?: string;
  /** Output file; omission selects stdout. */
  outPath?: string;
  /** Render embedded JSON with indentation. */
  pretty: boolean;
}

/** Supported annotation flags shown by help and usage errors. */
const ANNOTATE_USAGE = "Usage: tephra annotate [--in <path>] [--out <path>] [--pretty]";

/** Parse `tephra annotate` command-line flags without performing IO. */
function parseArgs(args: string[]): AnnotateCliOptions {
  const out: AnnotateCliOptions = { pretty: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
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

/** Render admitted finite input after complete progressive validation. */
export async function annotateCommand(args: string[], io: CliIo): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    await io.writeStdout(`${ANNOTATE_USAGE}\n`);
    return 0;
  }

  try {
    const options = parseArgs(args);
    const inputBytes = await collectInput(io.read(options.inPath));
    const annotated = await annotate(inputBytes, {
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
    await io.writeStderr(`tephra annotate error: ${message}\n`);
    return 1;
  }
}
