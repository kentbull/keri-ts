/** Compare Argon2id13 backends against pysodium/KERIpy vectors with timings.
 *
 * Usage: deno run -A packages/cesr/scripts/qualify-argon2-backends.ts --allow-high-memory [--modes temp,low,med,high] [--backends pwhash,noble,hashwasm]
 */
import { argon2id as wasmArgon2id } from "npm:@keri-ts/hash-wasm@4.14.0";
import { argon2id as nobleArgon2id } from "npm:@noble/hashes@1.8.0/argon2";
import { deriveArgon2id } from "../src/primitives/crypto/pwhash.ts";
import { SALTER_PWHASH_VECTORS } from "../test/fixtures/salter-pwhash-vectors.ts";
import parity from "../test/fixtures/sodium-parity-vectors.json" with { type: "json" };

if (!Deno.args.includes("--allow-high-memory")) {
  throw new Error("Run this isolated qualification with --allow-high-memory (up to 1 GiB Argon2 memory)");
}
const arg = (name: string, fallback: string) => {
  const i = Deno.args.indexOf(name);
  return (i >= 0 ? Deno.args[i + 1] : fallback).split(",");
};
const modes = arg("--modes", "temp,low,med,high");
const backendNames = arg("--backends", "pwhash,noble,hashwasm");
const hex = (t: string) => Uint8Array.from(t.match(/../g)!, (n) => parseInt(n, 16));
const toHex = (b: Uint8Array) => Array.from(b, (n) => n.toString(16).padStart(2, "0")).join("");
const params: Record<string, { t: number; m: number }> = {
  temp: { t: 1, m: 8 },
  low: { t: 2, m: 65536 },
  med: { t: 3, m: 262144 },
  high: { t: 4, m: 1048576 },
};
type Backend = (password: Uint8Array, salt: Uint8Array, size: number, t: number, mKiB: number) => Promise<Uint8Array>;
const backends: Record<string, Backend> = {
  pwhash: (pw, salt, size, t, m) => Promise.resolve(deriveArgon2id(pw, salt, size, t, m * 1024)),
  noble: (pw, salt, size, t, m) => Promise.resolve(nobleArgon2id(pw, salt, { t, m, p: 1, dkLen: size })),
  hashwasm: (pw, salt, size, t, m) =>
    wasmArgon2id({
      password: pw,
      salt,
      parallelism: 1,
      iterations: t,
      memorySize: m,
      hashLength: size,
      outputType: "binary",
    }),
};
const results = [];
for (const { salt: saltHex, cases } of [SALTER_PWHASH_VECTORS, parity.argon2id]) {
  for (const vector of cases.filter((c) => modes.includes(c.mode))) {
    for (const name of backendNames) {
      const { t, m } = params[vector.mode];
      const start = performance.now();
      let output: string, error: string | undefined;
      try {
        output = toHex(await backends[name](new TextEncoder().encode(vector.path), hex(saltHex), vector.size, t, m));
      } catch (e) {
        output = "";
        error = e instanceof Error ? e.message : String(e);
      }
      const row = {
        backend: name,
        mode: vector.mode,
        size: vector.size,
        elapsed_ms: Math.round(performance.now() - start),
        exact: output === vector.hex,
        error,
      };
      console.error(JSON.stringify(row));
      results.push(row);
    }
  }
}
console.log(JSON.stringify({ runtime: Deno.version, platform: Deno.build, results }));
