import { assertEquals, assertInstanceOf, assertStrictEquals, assertThrows } from "jsr:@std/assert";
import { b, concatBytes, decodeB64 } from "../../../src/core/bytes.ts";
import { GroupSizeError, ShortageError, UnknownCodeError } from "../../../src/core/errors.ts";
import { parseAttachmentGroup } from "../../../src/parser/attachments.ts";
import { parse } from "../../../src/parser/parser.ts";
import { Counter } from "../../../src/primitives/counter.ts";
import { Dater } from "../../../src/primitives/dater.ts";
import { Noncer } from "../../../src/primitives/noncer.ts";
import { NumberPrimitive } from "../../../src/primitives/number.ts";
import { isGroupTuple } from "../../../src/primitives/primitive.ts";
import { parseSealer } from "../../../src/primitives/sealer.ts";
import { ACastDom, AClanDom, FirstSeen, FSCastDom, FSClanDom, SealKind } from "../../../src/primitives/structing.ts";
import { parseStructor } from "../../../src/primitives/structor.ts";
import { Verser } from "../../../src/primitives/verser.ts";
import { Vrsn_1_0 as V1, Vrsn_2_0 as V2 } from "../../../src/tables/versions.ts";
import { hexWire, wireHex } from "../../fixtures/current-reference-vectors.ts";
import vectors from "../../fixtures/current-structing-vectors.json" with { type: "json" };
import { currentStructingVectors } from "../../fixtures/current-structing-vectors.ts";
import { KERIPY_NATIVE_V2_ICP_FIX_BODY } from "../../fixtures/external-vectors.ts";
import { v1ify } from "../../fixtures/versioned-body-fixtures.ts";

Deno.test("fixed-field TS constructors match frozen Python tuple and group wire exactly", () => {
  assertEquals(currentStructingVectors(), vectors);
  assertStrictEquals(FSClanDom.FirstSeen, FirstSeen);
  assertStrictEquals(FSCastDom.FirstSeen, FirstSeen.cast);
  assertStrictEquals(AClanDom.FirstSeen, FirstSeen);
  assertStrictEquals(ACastDom.FirstSeen, FirstSeen.cast);
  assertStrictEquals(SealKind.cast.d.kls, Noncer);
  assertEquals(SealKind.cast.d.ipn, null);
});

Deno.test("fixed-field crew projections preserve qualified empty nonce and ISO first-seen datetime", () => {
  for (const row of vectors.records) {
    const parts = row.parts.map((part) => b(part.qb64)) as [Uint8Array, Uint8Array];
    if (row.clan === "SealKind") {
      const value = SealKind.fromQb64bTuple(parts);
      assertInstanceOf(value.d, Noncer);
      assertEquals<unknown>(SealKind.toSad(value), row.sad);
      assertEquals(SealKind.qb64(SealKind.fromSad(row.sad as { t: string; d: string })), row.qb64);
      assertEquals(wireHex(SealKind.qb2(value)), row.qb2);
    } else {
      const value = FirstSeen.fromQb64bTuple(parts);
      assertEquals<unknown>(FirstSeen.toSad(value), row.sad);
      assertEquals<unknown>(FirstSeen.toSad(FirstSeen.fromSad(row.sad as { f: string; dt: string })), row.sad);
      assertEquals(FirstSeen.qb64(value), row.qb64);
      assertEquals(wireHex(FirstSeen.qb2(value)), row.qb2);
      assertStrictEquals(FirstSeen.toTuple(value)[0], value.f);
      assertStrictEquals(FirstSeen.toTuple(value)[1], value.dt);
      assertEquals(value.dt.dts, row.inputs.dts);
      assertEquals(Object.isFrozen(value), true);
    }
  }
  assertEquals(vectors.records[0].qb64, "0OKERICAACAA1AAP");
  assertThrows(() => SealKind.fromSad({ t: "0OKERICAACAA", d: "" }));
  assertThrows(() => FirstSeen.fromSad({ f: "not-hex", dt: "2026-10-13T01:02:03.000004+00:00" }));
  assertThrows(() => FirstSeen.fromSad({ f: "0", dt: "short" }));
});

Deno.test("first-seen and typed-seal groups preserve small/big counts, roles and exact extent in both domains", () => {
  for (const row of vectors.groups) {
    const version = row.version === 1 ? V1 : V2;
    const expected = vectors.records.filter((record) => record.clan === row.clan);
    for (const domain of ["txt", "bny"] as const) {
      const wire = domain === "txt" ? b(row.qb64) : hexWire(row.qb2);
      const { group, consumed } = parseAttachmentGroup(concatBytes(wire, b("TAIL")), version, domain);
      assertEquals(consumed, wire.length);
      assertEquals([group.code, group.count, group.items.length], [row.code, row.count, expected.length]);
      const structor = row.clan === "SealKind"
        ? parseSealer(concatBytes(wire, b("TAIL")), version, domain)
        : parseStructor(concatBytes(wire, b("TAIL")), version, domain);
      assertEquals(structor.consumed, wire.length);
      assertEquals(structor.qb64g, row.qb64);
      assertEquals(wireHex(structor.qb2g), row.qb2);
      for (const [index, item] of group.items.entries()) {
        if (!isGroupTuple(item)) throw new Error("Expected fixed-field tuple");
        assertEquals(item.length, 2);
        if (row.clan === "SealKind") {
          assertInstanceOf(item[0], Verser);
          assertInstanceOf(item[1], Noncer);
          assertEquals<unknown>(SealKind.toSad(SealKind.fromTuple([item[0], item[1]])), expected[index].sad);
        } else {
          assertInstanceOf(item[0], NumberPrimitive);
          assertInstanceOf(item[1], Dater);
          assertEquals<unknown>(FirstSeen.toSad(FirstSeen.fromTuple([item[0], item[1]])), expected[index].sad);
        }
      }
      for (let end = 0; end < wire.length; end++) {
        assertThrows(() => parseAttachmentGroup(wire.subarray(0, end), version, domain), ShortageError);
      }
    }
  }
});

Deno.test("fixed-field readers reject wrong roles and complete groups missing the second field", () => {
  for (const row of vectors.rejections) {
    const parts = row.parts.map((part) => b(part.qb64)) as [Uint8Array, Uint8Array];
    assertThrows(
      () => row.clan === "SealKind" ? SealKind.fromQb64bTuple(parts) : FirstSeen.fromQb64bTuple(parts),
      UnknownCodeError,
    );
    const codes = row.clan === "SealKind" ? ["-W", "--W"] : ["-O", "--O"];
    for (const code of codes) {
      const count = row.parts.reduce((size, part) => size + part.qb64.length, 0) / 4;
      const counter = new Counter({ code, count, version: V2 });
      for (const domain of ["txt", "bny"] as const) {
        const wire = domain === "txt"
          ? concatBytes(counter.qb64b, ...parts)
          : concatBytes(counter.qb2, ...row.parts.map((part) => hexWire(part.qb2)));
        assertThrows(() => parseAttachmentGroup(wire, V2, domain), UnknownCodeError);
      }
    }
  }
  for (const row of [vectors.records[0], vectors.records[4]]) {
    const part = row.parts[0];
    const counter = new Counter({
      code: row.clan === "SealKind" ? "-W" : "-O",
      count: part.qb64.length / 4,
      version: V2,
    });
    assertThrows(() => parseAttachmentGroup(concatBytes(counter.qb64b, b(part.qb64)), V2, "txt"), GroupSizeError);
    assertThrows(() => parseAttachmentGroup(concatBytes(counter.qb2, hexWire(part.qb2)), V2, "bny"), GroupSizeError);
  }
});

/** Partition a frame inside an attachment header while preserving source EOF. */
async function* splitFrame(wire: Uint8Array, split: number) {
  yield wire.subarray(0, split);
  yield wire.subarray(split);
}

Deno.test("current fixed-field attachment headers resume across both-domain stream partitions", async () => {
  for (const row of vectors.groups) {
    for (const domain of ["txt", "bny"] as const) {
      const body = row.version === 1
        ? b(v1ify("{\"v\":\"KERI10JSON000000_\",\"t\":\"rpy\"}"))
        : domain === "txt"
        ? b(KERIPY_NATIVE_V2_ICP_FIX_BODY)
        : decodeB64(KERIPY_NATIVE_V2_ICP_FIX_BODY);
      const attachment = domain === "txt" ? b(row.qb64) : hexWire(row.qb2);
      const wire = concatBytes(body, attachment);
      // A binary triplet carries the same counter as four text characters.
      const header = (row.code.startsWith("--") ? 8 : 4) * (domain === "txt" ? 1 : 0.75);
      for (let offset = 1; offset <= header; offset++) {
        const frames = await Array.fromAsync(parse(splitFrame(wire, body.length + offset)));
        assertEquals(frames.length, 1);
        assertEquals(frames[0].attachments[0].count, row.count);
        assertEquals(
          frames[0].attachments[0].items.length,
          vectors.records.filter((record) => record.clan === row.clan).length,
        );
      }
    }
  }
});
