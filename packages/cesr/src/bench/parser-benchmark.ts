import { parse } from "../parser/parser.ts";

/** Controls repeated buffered parses; every run must consume valid input completely. */
export interface BenchmarkOptions {
  /** Number of measured runs; default 50. */
  iterations?: number;
  /** Unmeasured preparation runs; default 5. */
  warmupIterations?: number;
  /** Independent copied source chunks; default 64 KiB. */
  chunkSize?: number;
  /** Cancel the benchmark operation between pulls and measured runs. */
  signal?: AbortSignal;
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
/** Consume one valid pass; benchmark cancellation stays outside decoding. */
export async function countFrames(
  input: Uint8Array,
  options: Pick<BenchmarkOptions, "chunkSize" | "signal"> = {},
): Promise<number> {
  const chunkSize = integer(options.chunkSize ?? 65536, "chunkSize");
  /** Allocate only the next chunk; no array of slices retains source metadata. */
  async function* source(): AsyncGenerator<Uint8Array> {
    for (let offset = 0; offset < input.length; offset += chunkSize) {
      yield input.slice(offset, offset + chunkSize);
    }
  }
  let frameCount = 0;
  options.signal?.throwIfAborted();
  const frames = parse(source());
  try {
    while (true) {
      options.signal?.throwIfAborted();
      const result = await frames.next();
      options.signal?.throwIfAborted();
      if (result.done) break;
      frameCount++;
    }
  } finally {
    await frames.return();
  }
  return frameCount;
}
/** Measure valid finite input repeatedly; malformed warmup or measured input rejects immediately. */
export async function benchmarkParser(input: Uint8Array, options: BenchmarkOptions = {}): Promise<BenchmarkResult> {
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
