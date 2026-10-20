import { createHash } from "node:crypto";
import { cpuUsage } from "node:process";
import type { CesrFrame } from "../../packages/cesr/src/core/types.ts";
import { parse } from "../../packages/cesr/src/parser/parser.ts";
import { corpus, type CorpusOptions } from "./cesr-corpus.ts";

/** One isolated benchmark case supplied by the supervising process. */
const options: CorpusOptions = JSON.parse(Deno.args[0]);
/** Independent corpus oracle and bounded chunk producer for this case. */
const { manifest, chunks } = corpus(options);
/** Digest only the wire bytes actually admitted by the parser. */
const wireHash = createHash("sha256");
/** Completed output and input counters; no frame history is retained. */
let frames = 0;
let received = 0;
let payloadBytes = 0;
/** First complete child latency and source admission at that instant. */
let firstFrameMs: number | null = null;
let firstFrameBytes: number | null = null;
/** In-process sampled high-water marks, complemented by supervisor RSS sampling. */
let peakRss = Deno.memoryUsage().rss;
let peakHeap = Deno.memoryUsage().heapUsed;
let peakExternal = Deno.memoryUsage().external;
/** Timed work includes source generation and correctness verification, excluding startup. */
const start = performance.now();
const cpuStart = cpuUsage();

/** Sample between parser calls; the supervisor also samples during blocking work. */
function sampleMemory() {
  const memory = Deno.memoryUsage();
  peakRss = Math.max(peakRss, memory.rss);
  peakHeap = Math.max(peakHeap, memory.heapUsed);
  peakExternal = Math.max(peakExternal, memory.external);
}

/** Check each delivered frame before counting it as a usable result. */
function consume(frame: CesrFrame) {
  sampleMemory();
  if (firstFrameMs === null) {
    firstFrameMs = performance.now() - start;
    firstFrameBytes = received;
  }
  const essr = frame.essrs;
  if (!essr || essr.length !== 1 || frame.attachments.length) throw new Error("Unexpected ESSR graph");
  // Only the sequence prefix is retained; every decoded block goes straight into the oracle hash.
  const prefix = new Uint8Array(8);
  const hash = createHash("sha256");
  let size = 0;
  {
    for (const part of essr) {
      const chunk = part.raw;
      const take = Math.min(chunk.length, Math.max(0, 8 - size));
      if (take) {
        prefix.set(chunk.subarray(0, take), size);
        if (size + take === 8) {
          if (new DataView(prefix.buffer).getBigUint64(0) !== BigInt(frames)) throw new Error("Wrong frame order");
          // Restore the corpus template only after verifying the actual frame sequence.
          for (let i = 0; i < 8; i++) prefix[i] = i;
          hash.update(prefix);
        }
      }
      hash.update(chunk.subarray(take));
      size += chunk.length;
    }
    if (size < 8 || hash.digest("hex") !== manifest.itemSha256) throw new Error("Wrong payload digest");
    payloadBytes += size;
    frames++;
  }
}

/** Report parser failures as structured results without claiming successful throughput. */
let error: { name: string; message: string } | null = null;
/** Pulling input updates admission counters before the parser can yield a child. */
async function* source(): AsyncGenerator<Uint8Array> {
  for (const chunk of chunks()) {
    received += chunk.length;
    wireHash.update(chunk);
    yield chunk;
    sampleMemory();
  }
}

try {
  // Consume each result without retaining an output history.
  for await (const frame of parse(source())) consume(frame);
  if (frames !== manifest.items || payloadBytes !== options.payloadBytes) throw new Error("Incomplete parse output");
} catch (cause) {
  error = cause instanceof Error
    ? { name: cause.name, message: cause.message }
    : { name: "Error", message: String(cause) };
}
// Finish timing before formatting the report so output serialization is excluded.
const elapsedMs = performance.now() - start;
sampleMemory();
console.log(JSON.stringify({
  manifest,
  runtime: Deno.version,
  status: error ? "error" : "ok",
  error,
  elapsedMs,
  cpuMicroseconds: cpuUsage(cpuStart),
  frames,
  received,
  payloadBytes,
  firstFrameMs,
  firstFrameBytes,
  peakRss,
  peakHeap,
  peakExternal,
  receivedSha256: wireHash.digest("hex"),
  throughputMiBPerSec: error ? null : payloadBytes / 1048576 / (elapsedMs / 1000),
}));
Deno.exit(error ? 1 : 0);
