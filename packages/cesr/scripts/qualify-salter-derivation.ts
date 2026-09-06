/** Explicit high-memory parity qualification, isolated from ordinary unit-test processes. */
import { assertEquals } from "jsr:@std/assert";
import { MtrDex } from "../src/primitives/codex.ts";
import { Salter } from "../src/primitives/salter.ts";
import { SALTER_PWHASH_VECTORS } from "../test/fixtures/salter-pwhash-vectors.ts";

if (Deno.args.join(" ") !== "--allow-high-memory") {
  throw new Error("Run this isolated qualification with --allow-high-memory (up to 1 GiB Argon2 memory)");
}
const salt = Uint8Array.from(SALTER_PWHASH_VECTORS.salt.match(/../g)!, (n) => parseInt(n, 16));
const results = [];
for (const vector of SALTER_PWHASH_VECTORS.cases) {
  const start = performance.now();
  const output = new Salter({ raw: salt, code: MtrDex.Salt_128 }).stretch({
    size: vector.size,
    path: vector.path,
    temp: vector.mode === "temp",
    tier: vector.mode === "temp" ? "low" : vector.mode,
  });
  assertEquals(Array.from(output, (n) => n.toString(16).padStart(2, "0")).join(""), vector.hex);
  results.push({ mode: vector.mode, output_bytes: vector.size, elapsed_ms: performance.now() - start, exact: true });
}
console.log(JSON.stringify({ runtime: Deno.version, platform: Deno.build, results, memory: Deno.memoryUsage() }));
