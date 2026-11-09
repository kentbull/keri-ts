import { assertEquals, assertThrows } from "jsr:@std/assert";
import { deriveArgon2id } from "../../../../src/primitives/crypto/pwhash.ts";
import vectors from "../../../fixtures/sodium-parity-vectors.json" with { type: "json" };

const hex = (text: string) => Uint8Array.from(text.match(/../g) ?? [], (n) => parseInt(n, 16));
const salt = hex(vectors.argon2id.salt);
const tiers: Record<string, { t: number; m: number }> = { temp: { t: 1, m: 8192 }, low: { t: 2, m: 65536 * 1024 } };
const cases = vectors.argon2id.cases.filter((c) => c.mode in tiers);
const derive = (c: (typeof cases)[number]) =>
  deriveArgon2id(new TextEncoder().encode(c.path), salt, c.size, tiers[c.mode].t, tiers[c.mode].m);

Deno.test("pwhash: matches pysodium, in either memory-size order on the shared hasher", () => {
  for (const c of [...cases, ...cases.toReversed()]) assertEquals(derive(c), hex(c.hex), `${c.mode} ${c.path}`);
});

Deno.test("pwhash: output size is an integer from 16 through 2147483647", () => {
  for (const size of [-1, 0, 4, 15, 16.5, NaN, Infinity, 0x80000000]) {
    assertThrows(() => deriveArgon2id(new Uint8Array(0), salt, size, 1, 8192), RangeError);
  }
  assertEquals(deriveArgon2id(new Uint8Array(0), salt, 16, 1, 8192).length, 16);
});

Deno.test("pwhash: invalid inputs reject before derivation", () => {
  const empty = new Uint8Array(0);
  const invalid: Array<[Uint8Array, Uint8Array, number, number]> = [
    ["x" as unknown as Uint8Array, salt, 1, 8192],
    [empty, new Uint8Array(15), 1, 8192],
    [empty, new Uint8Array(17), 1, 8192],
    [empty, salt, 0, 8192],
    [empty, salt, 1.5, 8192],
    [empty, salt, 1, 8191],
    [empty, salt, 1, 0x80000000],
  ];
  for (const [password, inputSalt, operations, memory] of invalid) {
    assertThrows(() => deriveArgon2id(password, inputSalt, 32, operations, memory), RangeError);
  }
});

Deno.test("pwhash: a backend failure propagates and leaves derivation usable", () => {
  const empty = new Uint8Array(0);
  // Within this seam's input bounds but above the WebAssembly module's maximum memory.
  assertThrows(() => deriveArgon2id(empty, salt, 32, 1, 0x7fffffff));
  assertEquals(derive(cases[0]), hex(cases[0].hex));
});

Deno.test("pwhash: returned bytes are owned by the caller", () => {
  const first = derive(cases[0]);
  assertEquals(first.buffer.byteLength, first.length);
  first.fill(0);
  assertEquals(derive(cases[0]), hex(cases[0].hex));
});
