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

Deno.test("benchmark rejects malformed input", async () => {
  const stream = TEXT_ENCODER.encode(SAMPLE_FRAME);
  await assertRejects(() => benchmarkParser(stream.subarray(0, 20), { iterations: 1, warmupIterations: 0 }));
  assertEquals(
    (await benchmarkParser(stream, { iterations: 1, warmupIterations: 0 })).totalFrames,
    1,
  );
});
