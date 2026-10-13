import { ResourceLimitError } from "../core/errors.ts";
import { parse, type ParseOptions } from "../parser/progressive.ts";

/** Finite replay policy for the convenience benchmark, independent of protocol sizes. */
export const BENCH_INPUT_LIMIT = 64 * 1024 ** 2;

/** Controls repeated progressive parses; every run must consume valid input completely. */
export interface BenchmarkOptions {
  /** Number of measured runs; default 50. */
  iterations?: number;
  /** Unmeasured preparation runs; default 5. */
  warmupIterations?: number;
  /** Independent copied source chunks; default 64 KiB. */
  chunkSize?: number;
  /** Finite retained corpus budget; default 64 MiB. */
  maxBytes?: number;
  /** Protocol admission and cancellation passed directly to the single engine. */
  parserOptions?: ParseOptions;
}

/** Throughput over fully consumed valid input, excluding warmup iterations. */
export interface BenchmarkResult {
  /** Completed measured run count. */
  iterations: number;
  /** Completed unmeasured run count. */
  warmupIterations: number;
  /** Source chunk size used by every run. */
  chunkSize: number;
  /** Size of the retained finite corpus. */
  bytesPerIteration: number;
  /** Fully consumed bytes across measured runs. */
  totalBytes: number;
  /** Complete frames across measured runs. */
  totalFrames: number;
  /** Monotonic elapsed time for measured parsing and payload cleanup. */
  elapsedMs: number;
  /** Mean measured run duration. */
  avgIterationMs: number;
  /** Fully consumed wire bytes per second. */
  throughputBytesPerSec: number;
  /** Fully consumed mebibytes per second. */
  throughputMiBPerSec: number;
  /** Complete frames per second. */
  framesPerSec: number;
}

/** Reject invalid control values rather than silently changing the requested workload. */
function integer(value: number, name: string, minimum = 1): number {
  if (!Number.isSafeInteger(value) || value < minimum) throw new RangeError(`${name} must be an integer >= ${minimum}`);
  return value;
}

/** Consume one progressive pass, releasing ESSR on every delivered frame. */
export async function countFrames(
  input: Uint8Array,
  options: Pick<BenchmarkOptions, "chunkSize" | "parserOptions" | "maxBytes"> = {},
): Promise<number> {
  const limit = integer(options.maxBytes ?? BENCH_INPUT_LIMIT, "maxBytes");
  if (input.length > limit) throw new ResourceLimitError(`Benchmark corpus exceeds ${limit} bytes`);
  const chunkSize = integer(options.chunkSize ?? 65536, "chunkSize");
  /** Allocate only the next admitted chunk; no array of slices retains source metadata. */
  async function* source(): AsyncGenerator<Uint8Array> {
    for (let offset = 0; offset < input.length; offset += chunkSize) {
      options.parserOptions?.signal?.throwIfAborted();
      yield input.slice(offset, offset + chunkSize);
    }
  }
  let frameCount = 0;
  for await (const frame of parse(source(), options.parserOptions)) {
    try {
      frameCount++;
    } finally {
      await frame.essr?.discard();
    }
  }
  return frameCount;
}

/** Measure valid finite input repeatedly; malformed warmup or measured input rejects immediately. */
export async function benchmarkParser(
  input: Uint8Array,
  options: BenchmarkOptions = {},
): Promise<BenchmarkResult> {
  if (input.length === 0) throw new Error("Benchmark input stream must not be empty");
  const iterations = integer(options.iterations ?? 50, "iterations");
  const warmupIterations = integer(options.warmupIterations ?? 5, "warmupIterations", 0);
  const chunkSize = integer(options.chunkSize ?? 65536, "chunkSize");
  for (let index = 0; index < warmupIterations; index++) await countFrames(input, { ...options, chunkSize });
  let totalFrames = 0;
  const start = performance.now();
  for (let index = 0; index < iterations; index++) {
    totalFrames += await countFrames(input, { ...options, chunkSize });
  }
  const elapsedMs = Math.max(performance.now() - start, Number.EPSILON);
  const totalBytes = input.length * iterations;
  const throughputBytesPerSec = totalBytes * 1000 / elapsedMs;
  return {
    iterations,
    warmupIterations,
    chunkSize,
    bytesPerIteration: input.length,
    totalBytes,
    totalFrames,
    elapsedMs,
    avgIterationMs: elapsedMs / iterations,
    throughputBytesPerSec,
    throughputMiBPerSec: throughputBytesPerSec / 1024 ** 2,
    framesPerSec: totalFrames * 1000 / elapsedMs,
  };
}
