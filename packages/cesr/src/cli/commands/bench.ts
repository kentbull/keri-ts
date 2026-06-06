import { benchmarkCesrParser } from "../../bench/parser-benchmark.ts";
import type { CliIo } from "../types.ts";

/**
 * Parsed CLI configuration for CESR benchmark execution.
 *
 * Notes for maintainers:
 * - Argument parsing is intentionally strict so automation scripts do not
 *   silently drift.
 */
interface BenchmarkCliOptions {
  inPath?: string;
  iterations: number;
  warmupIterations: number;
  chunkSize: number;
  framed: boolean;
  attachmentDispatchMode: "strict" | "compat";
  allowErrors: boolean;
  json: boolean;
}

const BENCH_USAGE =
  "Usage: tephra bench [--in <path>] [--iterations <n>] [--warmup <n>] [--chunk-size <bytes>] [--framed] [--compat] [--allow-errors] [--json]";

/** Parse non-negative integer flags used for sizing and warmup controls. */
function parseNonNegativeInt(argName: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${argName} must be a non-negative integer`);
  }
  return parsed;
}

/** Parse strictly positive integer flags used for measured iteration count. */
function parsePositiveInt(argName: string, value: string): number {
  const parsed = parseNonNegativeInt(argName, value);
  if (parsed <= 0) {
    throw new Error(`${argName} must be greater than 0`);
  }
  return parsed;
}

/** Parse `tephra bench` command-line flags without performing IO. */
function parseArgs(args: string[]): BenchmarkCliOptions {
  const out: BenchmarkCliOptions = {
    iterations: 50,
    warmupIterations: 5,
    chunkSize: 0,
    framed: false,
    attachmentDispatchMode: "strict",
    allowErrors: false,
    json: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--in") {
      const next = args[i + 1];
      if (!next) throw new Error("Missing value for --in");
      out.inPath = next;
      i++;
      continue;
    }
    if (arg === "--iterations") {
      const next = args[i + 1];
      if (!next) throw new Error("Missing value for --iterations");
      out.iterations = parsePositiveInt("--iterations", next);
      i++;
      continue;
    }
    if (arg === "--warmup") {
      const next = args[i + 1];
      if (!next) throw new Error("Missing value for --warmup");
      out.warmupIterations = parseNonNegativeInt("--warmup", next);
      i++;
      continue;
    }
    if (arg === "--chunk-size") {
      const next = args[i + 1];
      if (!next) throw new Error("Missing value for --chunk-size");
      out.chunkSize = parseNonNegativeInt("--chunk-size", next);
      i++;
      continue;
    }
    if (arg === "--framed") {
      out.framed = true;
      continue;
    }
    if (arg === "--compat") {
      out.attachmentDispatchMode = "compat";
      continue;
    }
    if (arg === "--allow-errors") {
      out.allowErrors = true;
      continue;
    }
    if (arg === "--json") {
      out.json = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return out;
}

/** Render human-readable benchmark output for terminal workflows. */
function formatHumanReadable(
  sourceLabel: string,
  result: ReturnType<typeof benchmarkCesrParser>,
): string {
  const chunkLabel = result.chunkSize === result.bytesPerIteration
    ? "full stream"
    : `${result.chunkSize} bytes`;
  return [
    "CESR parser benchmark",
    `source: ${sourceLabel}`,
    `iterations: ${result.iterations} (warmup: ${result.warmupIterations})`,
    `input bytes/iteration: ${result.bytesPerIteration}`,
    `chunk size: ${chunkLabel}`,
    `frames/iteration: ${(result.totalFrames / result.iterations).toFixed(2)}`,
    `errors/iteration: ${(result.totalErrors / result.iterations).toFixed(2)}`,
    `avg iteration: ${result.avgIterationMs.toFixed(3)} ms`,
    `throughput: ${result.throughputMiBPerSec.toFixed(3)} MiB/s`,
    `frame rate: ${result.framesPerSec.toFixed(2)} frames/s`,
  ].join("\n");
}

/** Execute `tephra bench` using the existing parser benchmark engine. */
export async function benchCommand(args: string[], io: CliIo): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    await io.writeStdout(`${BENCH_USAGE}\n`);
    return 0;
  }

  try {
    const options = parseArgs(args);
    const sourceLabel = options.inPath ? options.inPath : "stdin";
    const inputBytes = options.inPath
      ? await io.readFile(options.inPath)
      : await io.readStdin();

    const result = benchmarkCesrParser(inputBytes, {
      iterations: options.iterations,
      warmupIterations: options.warmupIterations,
      chunkSize: options.chunkSize,
      parserOptions: {
        framed: options.framed,
        attachmentDispatchMode: options.attachmentDispatchMode,
      },
      failOnParseError: !options.allowErrors,
    });

    if (options.json) {
      await io.writeStdout(
        `${JSON.stringify({ source: sourceLabel, ...result })}\n`,
      );
      return 0;
    }

    const rendered = formatHumanReadable(sourceLabel, result);
    await io.writeStdout(`${rendered}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await io.writeStderr(`tephra bench error: ${message}\n`);
    return 1;
  }
}
