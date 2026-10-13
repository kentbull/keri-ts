import {
  BENCH_INPUT_LIMIT,
  benchmarkCesrParser,
  type CesrParserBenchmarkOptions,
  type CesrParserBenchmarkResult,
} from "cesr-ts";
import type { Operation } from "npm:effection@^3.6.0";
import { abortable } from "../abortable.ts";
import { collectBytes, fileBytes, streamBytes } from "../byte-source.ts";
import { writeStdout } from "./output.ts";

/** CLI transport choices extend the shared benchmark controls without a second parser loop. */
interface BenchmarkArgs extends Omit<CesrParserBenchmarkOptions, "parserOptions"> {
  /** Corpus file; omission reads stdin. */
  inPath?: string;
  /** Emit machine-readable metrics instead of terminal text. */
  json?: boolean;
}

/** Present complete-run metrics using the shared benchmark's measured values. */
function formatBenchmarkText(source: string, result: CesrParserBenchmarkResult): string {
  return [
    "CESR parser benchmark",
    `source: ${source}`,
    `iterations: ${result.iterations} (warmup: ${result.warmupIterations})`,
    `input bytes/iteration: ${result.bytesPerIteration}`,
    `chunk size: ${result.chunkSize} bytes`,
    `frames/iteration: ${(result.totalFrames / result.iterations).toFixed(2)}`,
    `avg iteration: ${result.avgIterationMs.toFixed(3)} ms`,
    `throughput: ${result.throughputMiBPerSec.toFixed(3)} MiB/s`,
    `frame rate: ${result.framesPerSec.toFixed(2)} frames/s`,
  ].join("\n");
}

/** Retain one admitted corpus and own every input, parse, and output leaf in this operation. */
export function* benchmarkCommand(args: Record<string, unknown>): Operation<void> {
  const options = args as BenchmarkArgs;
  const limit = options.maxBytes ?? BENCH_INPUT_LIMIT;
  const source = options.inPath ?? "stdin";
  const bytes = yield* abortable((signal) =>
    collectBytes(
      options.inPath ? fileBytes(options.inPath, { signal }) : streamBytes(Deno.stdin.readable, { signal }),
      limit,
    )
  );
  const result = yield* abortable((signal) =>
    benchmarkCesrParser(bytes, {
      ...options,
      maxBytes: limit,
      parserOptions: { signal },
    })
  );
  const text = options.json ? JSON.stringify({ source, ...result }) : formatBenchmarkText(source, result);
  yield* abortable((signal) => writeStdout(`${text}\n`, signal));
}
