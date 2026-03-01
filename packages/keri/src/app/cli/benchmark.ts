import { createParser, type ParserOptions } from "cesr-ts";
import { type Operation } from "npm:effection@^3.6.0";

/**
 * Internal benchmark arguments projected from commander options.
 *
 * Boundary note:
 * - This shape is intentionally command-scoped and not exported as public API.
 */
interface BenchmarkArgs {
  inPath?: string;
  iterations?: number;
  warmupIterations?: number;
  chunkSize?: number;
  framed?: boolean;
  compat?: boolean;
  allowErrors?: boolean;
  json?: boolean;
}

interface ParseRunSummary {
  frameCount: number;
  errorCount: number;
}

/**
 * Console-facing benchmark result summary for `tufa benchmark cesr`.
 */
interface BenchmarkResult {
  iterations: number;
  warmupIterations: number;
  bytesPerIteration: number;
  chunkSize: number;
  totalFrames: number;
  totalErrors: number;
  elapsedMs: number;
  avgIterationMs: number;
  throughputMiBPerSec: number;
  framesPerSec: number;
}

/**
 * Synchronously consume stdin for CLI benchmark mode.
 *
 * Maintainer note:
 * - Synchronous read keeps CLI command implementation simple and deterministic.
 * - This function should remain isolated; parser benchmark internals themselves
 *   are IO-agnostic.
 */
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

/**
 * Validate positive integer options with explicit field-scoped errors.
 */
function asPositiveInteger(
  value: number | undefined,
  fallback: number,
  fieldName: string,
): number {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${fieldName} must be a positive integer`);
  }
  return value;
}

/**
 * Validate non-negative integer options with explicit field-scoped errors.
 */
function asNonNegativeInteger(
  value: number | undefined,
  fallback: number,
  fieldName: string,
): number {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative integer`);
  }
  return value;
}

/**
 * Normalize optional chunk sizing into a legal parse feed shape.
 */
function normalizeChunkSize(chunkSize: number, inputLength: number): number {
  if (chunkSize <= 0 || chunkSize >= inputLength) {
    return inputLength;
  }
  return chunkSize;
}

/**
 * Build ordered chunk views over the input stream.
 *
 * Invariant:
 * - uses `subarray` so benchmark execution does not add avoidable copy overhead.
 */
function createChunks(input: Uint8Array, chunkSize: number): Uint8Array[] {
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
 * Execute one complete parser pass and aggregate frame/error events.
 */
function parseStreamOnce(
  input: Uint8Array,
  chunkSize: number,
  parserOptions: ParserOptions,
): ParseRunSummary {
  const parser = createParser(parserOptions);
  let frameCount = 0;
  let errorCount = 0;

  for (const chunk of createChunks(input, chunkSize)) {
    for (const event of parser.feed(chunk)) {
      if (event.type === "frame") {
        frameCount++;
      } else {
        errorCount++;
      }
    }
  }

  for (const event of parser.flush()) {
    if (event.type === "frame") {
      frameCount++;
    } else {
      errorCount++;
    }
  }

  return { frameCount, errorCount };
}

/**
 * Run timed parser benchmark loop for `tufa benchmark cesr`.
 *
 * Boundary contract:
 * - warmup runs are excluded from timing.
 * - correctness remains first: parse errors fail the benchmark unless
 *   explicitly allowed.
 */
function benchmarkParser(
  input: Uint8Array,
  options: BenchmarkArgs,
): BenchmarkResult {
  if (input.length === 0) {
    throw new Error("Benchmark input stream must not be empty");
  }

  const iterations = asPositiveInteger(options.iterations, 50, "iterations");
  const warmupIterations = asNonNegativeInteger(
    options.warmupIterations,
    5,
    "warmup",
  );
  const parsedChunkSize = asNonNegativeInteger(
    options.chunkSize,
    0,
    "chunkSize",
  );
  const chunkSize = normalizeChunkSize(parsedChunkSize, input.length);
  const failOnParseError = !(options.allowErrors ?? false);
  const parserOptions: ParserOptions = {
    framed: options.framed ?? false,
    attachmentDispatchMode: options.compat ? "compat" : "strict",
  };

  for (let i = 0; i < warmupIterations; i++) {
    parseStreamOnce(input, chunkSize, parserOptions);
  }

  let totalFrames = 0;
  let totalErrors = 0;
  const startMs = performance.now();
  for (let i = 0; i < iterations; i++) {
    const summary = parseStreamOnce(input, chunkSize, parserOptions);
    totalFrames += summary.frameCount;
    totalErrors += summary.errorCount;
    if (failOnParseError && summary.errorCount > 0) {
      throw new Error(
        `Benchmark run produced parse errors (run=${
          i + 1
        }, errorCount=${summary.errorCount})`,
      );
    }
  }
  const elapsedMs = Math.max(performance.now() - startMs, Number.EPSILON);

  const throughputMiBPerSec = ((input.length * iterations * 1000) / elapsedMs) /
    (1024 * 1024);
  const framesPerSec = (totalFrames * 1000) / elapsedMs;

  return {
    iterations,
    warmupIterations,
    bytesPerIteration: input.length,
    chunkSize,
    totalFrames,
    totalErrors,
    elapsedMs,
    avgIterationMs: elapsedMs / iterations,
    throughputMiBPerSec,
    framesPerSec,
  };
}

/**
 * Render maintainer-oriented benchmark output for terminal use.
 */
function formatBenchmarkText(
  sourceLabel: string,
  result: BenchmarkResult,
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

// deno-lint-ignore require-yield
/**
 * Effection command handler for `tufa benchmark cesr`.
 *
 * Responsibility boundary:
 * - parse command options from dispatch args,
 * - read stream input from file/stdin,
 * - execute benchmark and emit one result payload (text or JSON).
 */
export function* benchmarkCommand(
  args: Record<string, unknown>,
): Operation<void> {
  const options: BenchmarkArgs = {
    inPath: args.inPath as string | undefined,
    iterations: args.iterations as number | undefined,
    warmupIterations: args.warmupIterations as number | undefined,
    chunkSize: args.chunkSize as number | undefined,
    framed: args.framed as boolean | undefined,
    compat: args.compat as boolean | undefined,
    allowErrors: args.allowErrors as boolean | undefined,
    json: args.json as boolean | undefined,
  };

  const sourceLabel = options.inPath ? options.inPath : "stdin";
  const inputBytes = options.inPath
    ? Deno.readFileSync(options.inPath)
    : readAllStdinSync();
  const result = benchmarkParser(inputBytes, options);

  if (options.json) {
    console.log(JSON.stringify({ source: sourceLabel, ...result }));
    return;
  }

  console.log(formatBenchmarkText(sourceLabel, result));
}
