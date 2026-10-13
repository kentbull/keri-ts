import { assertEquals, assertThrows } from "jsr:@std/assert";
import { Buffer } from "node:buffer";
import { b, byteString, concatBytes, decodeB64, encodeB64 } from "../../src/core/bytes.ts";
import { ShortageError } from "../../src/core/errors.ts";
import { MtrDex } from "../../src/primitives/codex.ts";
import { Counter, parseCounter } from "../../src/primitives/counter.ts";
import { Indexer, parseIndexer } from "../../src/primitives/indexer.ts";
import { Matter, parseMatter } from "../../src/primitives/matter.ts";
import { Texter } from "../../src/primitives/texter.ts";
import { KERIPY_INDEXER_VECTORS, KERIPY_MATTER_VECTORS } from "../fixtures/keripy-primitive-vectors.ts";

const V2 = { major: 2, minor: 0 } as const;

Deno.test("large input: base64 encoding matches an independent encoder across chunk boundaries", () => {
  const data = Uint8Array.from({ length: 1024 * 1024 + 2 }, (_, i) => i % 256);
  for (const length of [0, 1, 2, 3, 24575, 24576, 24577, data.length - 2, data.length - 1, data.length]) {
    const raw = data.subarray(0, length);
    const encoded = encodeB64(raw);
    assertEquals(encoded, Buffer.from(raw).toString("base64url"));
    assertEquals(decodeB64(encoded), raw);
  }
});

Deno.test("large input: byte conversion preserves every byte without Unicode substitution", () => {
  const raw = Uint8Array.from({ length: 1024 * 1024 }, (_, i) => i % 256);
  const text = byteString(raw);
  assertEquals(text.length, raw.length);
  assertEquals(Uint8Array.from(text, (char) => char.charCodeAt(0)), raw);
});

Deno.test("large input: 1 MiB and 4 MiB Texters roundtrip in both CESR domains", () => {
  for (const size of [1024 * 1024, 4 * 1024 * 1024 + 2]) {
    const raw = Uint8Array.from({ length: size }, (_, i) => i % 256);
    const texter = new Texter({ raw, code: MtrDex.Bytes_L0 });
    for (const parsed of [new Texter({ qb64b: texter.qb64b }), new Texter({ qb2: texter.qb2 })]) {
      assertEquals(parsed.raw, raw);
      assertEquals(parsed.qb64, texter.qb64);
    }
  }
});

Deno.test("large input: primitive readers ignore an 8 MiB non-text stream tail", () => {
  const tail = new Uint8Array(8 * 1024 * 1024).fill(0xff);
  const primitives = [
    { value: new Matter({ qb64: KERIPY_MATTER_VECTORS.prefixerEd25519N }), parse: parseMatter },
    { value: new Indexer({ qb64: KERIPY_INDEXER_VECTORS.ed25519SigIdx5 }), parse: parseIndexer },
    {
      value: new Counter({ code: "--A", count: 1024, version: V2 }),
      parse: (input: Uint8Array, domain: "txt" | "bny") => parseCounter(input, V2, domain),
    },
  ];
  for (const { value, parse } of primitives) {
    assertEquals(parse(concatBytes(value.qb64b, tail), "txt").qb64, value.qb64);
    assertEquals(parse(concatBytes(value.qb2, tail), "bny").qb64, value.qb64);
  }
});

Deno.test("large input: incomplete hard and soft headers remain shortages in both domains", () => {
  const cases = [
    { qb64: "1___YWJj", header: 4, parse: parseMatter },
    { qb64: "7AABAAABdGVz", header: 8, parse: parseMatter },
    { qb64: KERIPY_INDEXER_VECTORS.ed25519BigSigIdx67, header: 6, parse: parseIndexer },
    { qb64: KERIPY_INDEXER_VECTORS.tbd0Label, header: 4, parse: parseIndexer },
    {
      qb64: "-_AAACAA",
      header: 8,
      parse: (input: Uint8Array, domain: "txt" | "bny") => parseCounter(input, V2, domain),
    },
  ];
  for (const { qb64, header, parse } of cases) {
    for (const domain of ["txt", "bny"] as const) {
      const encoded = domain === "txt" ? b(qb64) : decodeB64(qb64);
      const headerSize = domain === "txt" ? header : Math.ceil(header * 3 / 4);
      for (let split = 0; split < headerSize; split++) {
        const error = assertThrows(() => parse(encoded.subarray(0, split), domain), ShortageError);
        assertEquals(error.available, split);
        assertEquals(error.needed > error.available, true);
      }
      assertEquals(parse(encoded, domain).qb64, qb64);
    }
  }
});

Deno.test("large input: invalid high bytes inside a token are not replaced during decoding", () => {
  const matter = b(KERIPY_MATTER_VECTORS.prefixerEd25519N);
  const indexer = b(KERIPY_INDEXER_VECTORS.ed25519SigIdx5);
  const counter = b("--AAAQAA");
  matter[10] = 0xff;
  indexer[10] = 0xff;
  counter[5] = 0xff;
  assertThrows(() => parseMatter(matter, "txt"));
  assertThrows(() => parseIndexer(indexer, "txt"));
  assertThrows(() => parseCounter(counter, V2, "txt"));
});
