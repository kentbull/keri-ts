import { createParser, type ParserOptions } from "../core/parser-engine.ts";
import type { CesrFrame } from "../core/types.ts";

/**
 * Benchmark configuration for parser throughput measurements.
 *
 * Boundary contract:
 * - This configuration only controls execution shape (iterations/chunking/parser mode).
 * - It must not mutate parser behavior beyond explicit `parserOptions`.
 */
export interface CesrParserBenchmarkOptions {
  /** Number of measured parser runs. */
  iterations?: number;
  /** Number of warmup runs before measured runs. */
  warmupIterations?: number;
  /**
   * Optional chunk size for simulated streaming.
   *
   * When unset or <= 0, the full stream is fed in one chunk.
   */
  chunkSize?: number;
  /** Parser behavior options to benchmark. */
  parserOptions?: ParserOptions;
  /**
   * Whether any parse error frame should fail the benchmark run.
   * Default: true.
   */
  failOnParseError?: boolean;
}

export interface CesrParseRunSummary {
  frameCount: number;
  errorCount: number;
}

/**
 * Stable benchmark result envelope consumed by CLI and maintainers.
 *
 * Invariants:
 * - `totalBytes === bytesPerIteration * iterations`
 * - rate metrics are derived from `elapsedMs` and must remain monotonic with work size.
 */
export interface CesrParserBenchmarkResult {
  iterations: number;
  warmupIterations: number;
  chunkSize: number;
  bytesPerIteration: number;
  totalBytes: number;
  totalFrames: number;
  totalErrors: number;
  elapsedMs: number;
  avgIterationMs: number;
  throughputBytesPerSec: number;
  throughputMiBPerSec: number;
  framesPerSec: number;
}

function asPositiveInteger(
  value: number | undefined,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.trunc(value));
}

/**
 * Normalize chunking to a legal parser-feed size.
 *
 * Boundary rules:
 * - `<= 0` means full-stream feed for each iteration.
 * - values larger than stream size collapse to full-stream feed.
 */
function normalizeChunkSize(
  chunkSize: number | undefined,
  totalBytes: number,
): number {
  const normalized = asPositiveInteger(chunkSize, 0);
  if (normalized <= 0 || normalized >= totalBytes) {
    return totalBytes;
  }
  return normalized;
}

/**
 * Produce deterministic feed slices for one parse run.
 *
 * Invariant:
 * - slices preserve original stream ordering.
 * - slices are view-backed (`subarray`) to avoid benchmark-side copy noise.
 */
function buildChunks(input: Uint8Array, chunkSize: number): Uint8Array[] {
  if (chunkSize >= input.length) {
    return [input];
  }

  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < input.length; offset += chunkSize) {
    chunks.push(
      input.subarray(offset, Math.min(offset + chunkSize, input.length)),
    );
  }
  return chunks;
}

/**
 * Count parser frame/error events for one parser emission batch.
 */
function countFrames(events: CesrFrame[]): CesrParseRunSummary {
  let frameCount = 0;
  let errorCount = 0;
  for (const event of events) {
    if (event.type === "frame") {
      frameCount++;
      continue;
    }
    errorCount++;
  }
  return { frameCount, errorCount };
}

/**
 * Execute one complete parser pass over the provided stream.
 *
 * Boundary contract:
 * - Always feeds configured chunks and then flushes once.
 * - Returns event counts only; callers own timing and aggregation.
 */
export function parseCesrStreamOnce(
  input: Uint8Array,
  options: Pick<CesrParserBenchmarkOptions, "chunkSize" | "parserOptions"> = {},
): CesrParseRunSummary {
  const chunkSize = normalizeChunkSize(options.chunkSize, input.length);
  const parser = createParser(options.parserOptions);
  let frameCount = 0;
  let errorCount = 0;
  for (const chunk of buildChunks(input, chunkSize)) {
    const summary = countFrames(parser.feed(chunk));
    frameCount += summary.frameCount;
    errorCount += summary.errorCount;
  }
  const flushSummary = countFrames(parser.flush());
  frameCount += flushSummary.frameCount;
  errorCount += flushSummary.errorCount;
  return { frameCount, errorCount };
}

/**
 * Benchmark parser throughput across warmup + measured iterations.
 *
 * Invariants:
 * - warmup runs are excluded from final metrics.
 * - when `failOnParseError` is true, any parse error fails fast to prevent
 *   silently benchmarking degraded correctness.
 */
export function benchmarkCesrParser(
  input: Uint8Array,
  options: CesrParserBenchmarkOptions = {},
): CesrParserBenchmarkResult {
  if (input.length === 0) {
    throw new Error("Benchmark input stream must not be empty");
  }

  const iterations = asPositiveInteger(options.iterations, 50);
  if (iterations <= 0) {
    throw new Error("iterations must be greater than 0");
  }

  const warmupIterations = asPositiveInteger(options.warmupIterations, 5);
  const chunkSize = normalizeChunkSize(options.chunkSize, input.length);
  const failOnParseError = options.failOnParseError ?? true;

  for (let i = 0; i < warmupIterations; i++) {
    parseCesrStreamOnce(input, {
      chunkSize,
      parserOptions: options.parserOptions,
    });
  }

  let totalFrames = 0;
  let totalErrors = 0;
  const startMs = performance.now();
  for (let i = 0; i < iterations; i++) {
    const run = parseCesrStreamOnce(input, {
      chunkSize,
      parserOptions: options.parserOptions,
    });
    totalFrames += run.frameCount;
    totalErrors += run.errorCount;
    if (failOnParseError && run.errorCount > 0) {
      throw new Error(
        `Benchmark run produced parse errors (run=${i + 1}, errorCount=${run.errorCount})`,
      );
    }
  }
  const elapsedMs = Math.max(performance.now() - startMs, Number.EPSILON);

  const totalBytes = input.length * iterations;
  const throughputBytesPerSec = (totalBytes * 1000) / elapsedMs;
  const throughputMiBPerSec = throughputBytesPerSec / (1024 * 1024);
  const framesPerSec = (totalFrames * 1000) / elapsedMs;

  return {
    iterations,
    warmupIterations,
    chunkSize,
    bytesPerIteration: input.length,
    totalBytes,
    totalFrames,
    totalErrors,
    elapsedMs,
    avgIterationMs: elapsedMs / iterations,
    throughputBytesPerSec,
    throughputMiBPerSec,
    framesPerSec,
  };
}
