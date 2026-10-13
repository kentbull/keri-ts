import { assertEquals, assertRejects } from "jsr:@std/assert";
import { benchmarkCesrParser, parseCesrStreamOnce } from "../../src/bench/parser-benchmark.ts";

const TEXT_ENCODER = new TextEncoder();
const SAMPLE_FRAME = "{\"v\":\"KERI10JSON00002e_\",\"t\":\"rpy\",\"d\":\"Eabc\"}";

Deno.test("parseCesrStreamOnce parses repeated CESR frames without errors", async () => {
  const stream = TEXT_ENCODER.encode(SAMPLE_FRAME.repeat(4));
  const summary = await parseCesrStreamOnce(stream, { chunkSize: 32 });
  assertEquals(summary.frameCount, 4);
});

Deno.test("benchmarkCesrParser returns stable metric envelope", async () => {
  const stream = TEXT_ENCODER.encode(SAMPLE_FRAME.repeat(3));
  const result = await benchmarkCesrParser(stream, {
    iterations: 2,
    warmupIterations: 0,
    chunkSize: 16,
  });

  assertEquals(result.iterations, 2);
  assertEquals(result.bytesPerIteration, stream.length);
  assertEquals(result.totalFrames, 6);
});

Deno.test("benchmark rejects malformed input and enforces a configurable finite corpus budget", async () => {
  const stream = TEXT_ENCODER.encode(SAMPLE_FRAME);
  await assertRejects(() =>
    benchmarkCesrParser(stream, { maxBytes: stream.length - 1, iterations: 1, warmupIterations: 0 })
  );
  await assertRejects(() => benchmarkCesrParser(stream.subarray(0, 20), { iterations: 1, warmupIterations: 0 }));
  // Exact admission succeeds; the cap is caller policy rather than a wire-format restriction.
  assertEquals(
    (await benchmarkCesrParser(stream, { maxBytes: stream.length, iterations: 1, warmupIterations: 0 })).totalFrames,
    1,
  );
});
