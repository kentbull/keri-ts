import { createHash } from "node:crypto";
import { cpuUsage } from "node:process";
import type { CesrFrame } from "../../packages/cesr/src/core/types.ts";
import { parse } from "../../packages/cesr/src/parser/progressive.ts";
import { Texter } from "../../packages/cesr/src/primitives/texter.ts";
import { corpus, type CorpusOptions } from "./cesr-corpus.ts";

const options: CorpusOptions = JSON.parse(Deno.args[0]);
const { manifest, chunks } = corpus(options);
const wireHash = createHash("sha256");
let frames = 0;
let received = 0;
let payloadBytes = 0;
let firstFrameMs: number | null = null;
let firstFrameBytes: number | null = null;
let peakRss = Deno.memoryUsage().rss;
let peakHeap = Deno.memoryUsage().heapUsed;
let peakExternal = Deno.memoryUsage().external;
const start = performance.now();
const cpuStart = cpuUsage();

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
  const values = frame.attachments.flatMap((group) => group.items);
  if (values.length !== 1 || !(values[0] instanceof Texter)) throw new Error("Unexpected ESSR graph");
  const raw = values[0].raw;
  if (new DataView(raw.buffer, raw.byteOffset, 8).getBigUint64(0) !== BigInt(frames)) {
    throw new Error("Wrong frame order");
  }
  // Check the sequence ID above, then restore the common hash template.
  for (let i = 0; i < 8; i++) raw[i] = i;
  if (createHash("sha256").update(raw).digest("hex") !== manifest.itemSha256) throw new Error("Wrong payload digest");
  payloadBytes += raw.length;
  frames++;
}

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
  // One next() is one output credit; no array of sibling frames is retained.
  for await (const frame of parse(source())) consume(frame);
  if (frames !== manifest.items || payloadBytes !== options.payloadBytes) throw new Error("Incomplete parse output");
} catch (cause) {
  error = cause instanceof Error
    ? { name: cause.name, message: cause.message }
    : { name: "Error", message: String(cause) };
}
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
