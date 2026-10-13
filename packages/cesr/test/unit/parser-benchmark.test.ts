import { assertEquals, assertRejects } from "jsr:@std/assert";
import { benchmarkParser, countFrames } from "../../src/bench/parser-benchmark.ts";

const TEXT_ENCODER = new TextEncoder();
const SAMPLE_FRAME = "{\"v\":\"KERI10JSON00002e_\",\"t\":\"rpy\",\"d\":\"Eabc\"}";

Deno.test("countFrames parses repeated CESR frames without errors", async () => {
  const stream = TEXT_ENCODER.encode(SAMPLE_FRAME.repeat(4));
  const count = await countFrames(stream, { chunkSize: 32 });
  assertEquals(count, 4);
});

Deno.test("benchmarkParser returns stable metric envelope", async () => {
  const stream = TEXT_ENCODER.encode(SAMPLE_FRAME.repeat(3));
  const result = await benchmarkParser(stream, {
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
    benchmarkParser(stream, { maxBytes: stream.length - 1, iterations: 1, warmupIterations: 0 })
  );
  await assertRejects(() => benchmarkParser(stream.subarray(0, 20), { iterations: 1, warmupIterations: 0 }));
  // Exact admission succeeds; the cap is caller policy rather than a wire-format restriction.
  assertEquals(
    (await benchmarkParser(stream, { maxBytes: stream.length, iterations: 1, warmupIterations: 0 })).totalFrames,
    1,
  );
});
