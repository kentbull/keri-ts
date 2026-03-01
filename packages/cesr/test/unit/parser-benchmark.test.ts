import { assertEquals } from "jsr:@std/assert";
import {
  benchmarkCesrParser,
  parseCesrStreamOnce,
} from "../../src/bench/parser-benchmark.ts";

const TEXT_ENCODER = new TextEncoder();
const SAMPLE_FRAME = '{"v":"KERI10JSON00002e_","t":"rpy","d":"Eabc"}';

Deno.test("parseCesrStreamOnce parses repeated CESR frames without errors", () => {
  const stream = TEXT_ENCODER.encode(SAMPLE_FRAME.repeat(4));
  const summary = parseCesrStreamOnce(stream, { chunkSize: 32 });
  assertEquals(summary.errorCount, 0);
  assertEquals(summary.frameCount, 4);
});

Deno.test("benchmarkCesrParser returns stable metric envelope", () => {
  const stream = TEXT_ENCODER.encode(SAMPLE_FRAME.repeat(3));
  const result = benchmarkCesrParser(stream, {
    iterations: 2,
    warmupIterations: 0,
    chunkSize: 16,
  });

  assertEquals(result.iterations, 2);
  assertEquals(result.bytesPerIteration, stream.length);
  assertEquals(result.totalErrors, 0);
  assertEquals(result.totalFrames, 6);
});
