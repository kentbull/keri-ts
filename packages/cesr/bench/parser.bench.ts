import { parseCesrStreamOnce } from "../src/bench/parser-benchmark.ts";

const TEXT_ENCODER = new TextEncoder();
const SAMPLE_FRAME = "{\"v\":\"KERI10JSON00002e_\",\"t\":\"rpy\",\"d\":\"Eabc\"}";
const SAMPLE_STREAM = TEXT_ENCODER.encode(SAMPLE_FRAME.repeat(200));

Deno.bench("cesr parser benchmark - 64 KiB source chunks", async () => {
  await parseCesrStreamOnce(SAMPLE_STREAM);
});

Deno.bench("cesr parser benchmark - 64 byte source chunks", async () => {
  await parseCesrStreamOnce(SAMPLE_STREAM, { chunkSize: 64 });
});
