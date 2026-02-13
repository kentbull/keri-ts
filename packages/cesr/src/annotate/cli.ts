import { annotate } from "./annotator.ts";

interface CliOptions {
  inPath?: string;
  outPath?: string;
  qb2: boolean;
}

export interface CliIo {
  readFile(path: string): Promise<Uint8Array>;
  writeTextFile(path: string, text: string): Promise<void>;
  readStdin(): Promise<Uint8Array>;
  writeStdout(text: string): Promise<void>;
  writeStderr(text: string): Promise<void>;
}

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

function parseArgs(args: string[]): CliOptions {
  const out: CliOptions = { qb2: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--qb2") {
      out.qb2 = true;
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
    if (arg === "--help" || arg === "-h") {
      throw new Error(
        "Usage: cesr-annotate [--in <path>] [--out <path>] [--qb2]",
      );
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

async function readAllReadable(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.length;
      }
    }
  } finally {
    reader.releaseLock();
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

const DEFAULT_IO: CliIo = {
  readFile: (path: string) => Deno.readFile(path),
  writeTextFile: (path: string, text: string) => Deno.writeTextFile(path, text),
  readStdin: () => readAllReadable(Deno.stdin.readable),
  writeStdout: async (text: string) => {
    await Deno.stdout.write(TEXT_ENCODER.encode(text));
  },
  writeStderr: async (text: string) => {
    await Deno.stderr.write(TEXT_ENCODER.encode(text));
  },
};

export async function annotateCli(args: string[], io: CliIo = DEFAULT_IO): Promise<number> {
  try {
    const options = parseArgs(args);
    const inputBytes = options.inPath
      ? await io.readFile(options.inPath)
      : await io.readStdin();

    const annotated = options.qb2
      ? annotate(inputBytes, { domainHint: "bny" })
      : annotate(TEXT_DECODER.decode(inputBytes), { domainHint: "txt" });

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

if (import.meta.main) {
  const code = await annotateCli(Deno.args);
  Deno.exit(code);
}
