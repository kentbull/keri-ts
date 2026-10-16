import { assertEquals, assertThrows } from "jsr:@std/assert";
import { b, codeB64ToB2, concatBytes } from "../../../src/core/bytes.ts";
import { SerializeError } from "../../../src/core/errors.ts";
import { parseBytes } from "../../../src/parser/complete.ts";
import { Counter } from "../../../src/primitives/counter.ts";
import type { MapperMap } from "../../../src/primitives/mapper.ts";
import { Noncer } from "../../../src/primitives/noncer.ts";
import { NumberPrimitive } from "../../../src/primitives/number.ts";
import { dumpCesrNativeSad } from "../../../src/serder/native.ts";
import { SerderKERI } from "../../../src/serder/serder.ts";
import { Serdery } from "../../../src/serder/serdery.ts";
import { Vrsn_1_0, Vrsn_2_0 } from "../../../src/tables/versions.ts";
import vectors from "../../fixtures/native-seal-vectors.json" with { type: "json" };
import { emitNativeSealVectors, nativeSealBinary } from "../../fixtures/native-seal-vectors.ts";

Deno.test("native seal SADs: checked construction matches frozen Python families, runs and event contexts", () => {
  const emitted = emitNativeSealVectors();
  assertEquals(emitted.events, vectors.events);
  assertEquals(emitted.jsonEvents, vectors.jsonEvents);
  assertEquals(emitted.numbers, vectors.numbers);
  assertThrows(() => NumberPrimitive.fromNum(-1n), RangeError);
  assertThrows(() => NumberPrimitive.fromNum(1n << 136n), RangeError);
  for (const row of vectors.events) {
    assertEquals(dumpCesrNativeSad(row.sad as unknown as MapperMap), b(row.qb64), row.name);
  }
});

Deno.test("native seal SADs: checked readers restore typed records and exact body extents in qb64/qb2", () => {
  for (const row of vectors.events) {
    for (const raw of [b(row.qb64), nativeSealBinary(row.qb2)]) {
      const event = new SerderKERI({ raw });
      assertEquals(event.ked, row.sad, row.name);
      assertEquals(event.raw, b(row.qb64));
      if (event.snh !== null) {
        // The public numeric projection must select the same code as the wire writer.
        assertEquals(event.sner?.qb64, vectors.numbers.find((number) => number.numh === event.snh)?.qb64);
      }
      const reaped = new Serdery().reap(concatBytes(raw, b("TAIL")));
      assertEquals(reaped.consumed, raw.length);
      assertEquals(reaped.serder.ked, row.sad);
    }
  }
  const typed = vectors.events.find((row) => row.name === "typed-nonce-run")!;
  const records = new SerderKERI({ raw: b(typed.qb64) }).sealRecords;
  assertEquals(records.map((record) => "d" in record && record.d instanceof Noncer), [true, true, true, true]);
  assertEquals(records.map((record) => "d" in record && record.d.code), ["1AAP", "0A", "a", "E"]);
});

Deno.test("native seal SADs: reject wrong roles, incomplete tuples, foreign counters and lists outside events", () => {
  for (const row of vectors.rejections) {
    for (const raw of [b(row.qb64), nativeSealBinary(row.qb2)]) {
      // Even the unchecked path must enforce the field contract before SAID verification.
      assertThrows(() => new SerderKERI({ raw, verify: false }), Error, "", row.name);
      assertThrows(() => new SerderKERI({ raw }), Error, "", row.name);
    }
  }
});

Deno.test("native seal SADs: reject lossy maps, reordered fields, nonce seals and oversized homogeneous groups", () => {
  const typed = vectors.events.find((row) => row.name === "SealKind")!.sad;
  const digest = vectors.events.find((row) => row.name === "SealDigest")!.sad.a as { d: string }[];
  for (
    const a of [
      [{ note: "opaque" }],
      [digest[0], { note: "opaque" }, digest[0]],
      [{ d: "1AAP", t: "0OKERICAACAA" }],
      [{ nd: "1AAP" }],
      // A digest is 11 quadlets; 373 entries exceed the small counter's 4095-unit capacity.
      Array.from({ length: 373 }, () => digest[0]),
    ]
  ) {
    assertThrows(() => dumpCesrNativeSad({ ...typed, a } as unknown as MapperMap), SerializeError);
  }
  const reply = vectors.events.find((row) => row.name === "rpy-mapper")!.sad;
  assertThrows(() => dumpCesrNativeSad({ ...reply, a: [] } as unknown as MapperMap), SerializeError);
});

Deno.test("native seals: stream genus stays independent of protocol 1/2 JSON and native protocol 2", async () => {
  const typed = vectors.events.find((row) => row.name === "SealKind")!;
  for (const binary of [false, true]) {
    const encode = binary ? codeB64ToB2 : b;
    const selector2 = binary
      ? codeB64ToB2(new TextDecoder().decode(Counter.makeGVC(Vrsn_2_0)))
      : Counter.makeGVC(Vrsn_2_0);
    const selector1 = binary
      ? codeB64ToB2(new TextDecoder().decode(Counter.makeGVC(Vrsn_1_0)))
      : Counter.makeGVC(Vrsn_1_0);
    const frames = await parseBytes(concatBytes(selector2, encode(typed.qb64)));
    assertEquals(frames.length, 1);
    assertEquals(frames[0].body.ked, typed.sad);
    assertThrows(() => parseBytes(concatBytes(selector1, encode(typed.qb64))));
    for (const row of vectors.jsonEvents) {
      assertEquals((await parseBytes(concatBytes(selector2, b(row.raw))))[0].body.ked, row.sad);
      if (row.name === "json-1") {
        assertEquals((await parseBytes(concatBytes(selector1, b(row.raw))))[0].body.ked, row.sad);
      } else {
        assertThrows(() => parseBytes(concatBytes(selector1, b(row.raw))));
      }
    }
  }
});
