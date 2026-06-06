import { annotate } from "cesr-ts";
import { type Operation, spawn, withResolvers } from "npm:effection@^3.6.0";
import { colorizeAnnotatedOutput } from "./annotate-color.ts";

const TEXT_DECODER = new TextDecoder();
const STDIN_CHUNK_SIZE = 64 * 1024;
const WOULD_BLOCK_RETRY_DELAY_MS = 5;

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
 * Reads bytes from stdin in chunks and returns them as a single Uint8Array.
 * Uses async reads so Node shim stdin pipes can recover from transient EAGAIN.
 * @returns All bytes read from stdin
 */
async function readAllStdinAsync(): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const chunk = new Uint8Array(STDIN_CHUNK_SIZE);
    let read: number | null;
    try {
      read = await Deno.stdin.read(chunk);
    } catch (error) {
      if (isWouldBlockError(error)) {
        await sleep(WOULD_BLOCK_RETRY_DELAY_MS);
        continue;
      }
      throw error;
    }

    if (read === null) break;

    if (read === 0) {
      await sleep(WOULD_BLOCK_RETRY_DELAY_MS);
      continue;
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

function isWouldBlockError(error: unknown): boolean {
  if (error instanceof Deno.errors.WouldBlock) return true;
  if (!(error && typeof error === "object" && "code" in error)) return false;
  const code = (error as { code?: unknown }).code;
  return code === "EAGAIN" || code === "EWOULDBLOCK";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function* readAllStdinOp(): Operation<Uint8Array> {
  const { operation, resolve, reject } = withResolvers<Uint8Array>();
  const task = yield* spawn(function*() {
    readAllStdinAsync()
      .then(resolve)
      .catch((error) => reject(error instanceof Error ? error : new Error(String(error))));
  });
  yield* task;
  return yield* operation;
}

/**
 * CLI command wrapper for CESR annotation.
 *
 * This keeps `tufa annotate` aligned with the lower-level CESR annotator while
 * handling runtime-specific stdin/stdout and optional terminal colorization.
 */
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
    : yield* readAllStdinOp();

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
