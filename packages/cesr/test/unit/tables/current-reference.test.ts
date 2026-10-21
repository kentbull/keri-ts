import { assertEquals, assertRejects, assertStringIncludes, assertThrows } from "jsr:@std/assert";
import { annotate } from "../../../src/annotate/annotator.ts";
import { counterCodeNameForVersion, matterCodeName } from "../../../src/annotate/comments.ts";
import { b, concatBytes, decodeB64 } from "../../../src/core/bytes.ts";
import {
  DeserializeError,
  GroupSizeError,
  SerializeError,
  ShortageError,
  UnknownCodeError,
} from "../../../src/core/errors.ts";
import { collectPayload } from "../../../src/core/payload.ts";
import { parseAttachmentGroup } from "../../../src/parser/attachments.ts";
import { parseBytes } from "../../../src/parser/complete.ts";
import { parse } from "../../../src/parser/parser.ts";
import { attachmentPayload } from "../../../src/parser/serialize.ts";
import { Counter, parseCounter } from "../../../src/primitives/base/counter.ts";
import { Matter, parseMatter } from "../../../src/primitives/base/matter.ts";
import { isGroupTuple } from "../../../src/primitives/base/primitive.ts";
import { parsePrimitiveFromText } from "../../../src/primitives/base/registry.ts";
import { Noncer } from "../../../src/primitives/crypto/noncer.ts";
import { parseSealer } from "../../../src/primitives/structuring/sealer.ts";
import { SealNonce } from "../../../src/primitives/structuring/structing.ts";
import { parseStructor } from "../../../src/primitives/structuring/structor.ts";
import { dumpCesrNativeSad } from "../../../src/serder/native.ts";
import { CtrDexV1, CtrDexV2 } from "../../../src/tables/counter-codex.ts";
import { resolveCounterSizeTable, resolveCtrDex } from "../../../src/tables/counter-version-registry.ts";
import { Vrsn_1_0 as V1, Vrsn_2_0 as V2 } from "../../../src/tables/versions.ts";
import { groupV2, sigerToken, token } from "../../fixtures/counter-token-fixtures.ts";
import vectors from "../../fixtures/current-reference-vectors.json" with { type: "json" };
import { currentReferenceVectors, hexWire, wireHex } from "../../fixtures/current-reference-vectors.ts";
import { KERIPY_NATIVE_V2_ICP_FIX_BODY as native } from "../../fixtures/external-vectors.ts";
import { expectedNativeKeriIcpSad } from "../../fixtures/native-serder-test-helpers.ts";
import { assertWireError } from "../../fixtures/parser-test-helpers.ts";
import { v1ify } from "../../fixtures/versioned-body-fixtures.ts";

/** Yield byte partitions without changing version selection or wire contents. */
async function* chunks(...parts: Uint8Array[]) {
  yield* parts;
}

Deno.test("frozen Python counter tables match TS except the explicit v1 protocol extensions", () => {
  assertEquals(vectors.reference, "7143832813cac6a394ab1faf9be83bb3372be87c");
  for (const version of [V1, V2]) {
    const reference = vectors.counterTables[version.major === 1 ? "1" : "2"];
    const names = Object.fromEntries(Object.entries(resolveCtrDex(version)).map(([name, code]) => [code, name]));
    assertEquals(names, reference.names);
    const sizes = Object.fromEntries(resolveCounterSizeTable(version));
    if (version.major === 1) {
      for (const code of ["-D", "-J", "-K"]) {
        assertEquals(sizes[code], { hs: 2, ss: 2, fs: 4 });
        delete sizes[code];
      }
    }
    assertEquals(sizes, reference.sizes);
  }
});

Deno.test("TS emits independent frozen Python GramHead, nonce-seal and counter bytes", () => {
  const emitted = currentReferenceVectors();
  assertEquals(emitted.gramHead, vectors.gramHead);
  assertEquals(emitted.nonces, vectors.nonces);
  assertEquals(emitted.groups, vectors.groups);
  assertEquals(emitted.counters, vectors.counters);
});

Deno.test("GramHead preserves special metadata, raw bytes and exact token extents in both domains", () => {
  const expected = vectors.gramHead;
  for (const domain of ["txt", "bny"] as const) {
    const wire = domain === "txt" ? b(expected.qb64) : hexWire(expected.qb2);
    const parsed = parseMatter(concatBytes(wire, b("TAIL")), domain);
    assertEquals([parsed.code, parsed.soft, wireHex(parsed.raw)], ["b", "ABC", "010203"]);
    assertEquals([parsed.fullSize, parsed.fullSizeB2], [8, 6]);
    for (let end = 0; end < wire.length; end++) {
      assertThrows(() => parseMatter(wire.subarray(0, end), domain), ShortageError);
    }
  }
  assertEquals(parsePrimitiveFromText(b(expected.qb64)).name, "GramHead");
  assertEquals(matterCodeName("b"), "GramHead");
  for (const code of ["0P", "0Q", "0R", "0S"]) {
    assertThrows(() => new Matter({ qb64: code + "A".repeat(78) }), UnknownCodeError);
    assertThrows(() => new Matter({ qb2: decodeB64(code + "A".repeat(78)) }), UnknownCodeError);
  }
  for (const soft of [undefined, "", "AB", "A?C"]) {
    assertThrows(() => new Matter({ code: "b", soft, raw: Uint8Array.of(1, 2, 3) }), DeserializeError);
  }
  for (const length of [0, 1, 2, 4]) {
    assertThrows(() => new Matter({ code: "b", soft: "ABC", raw: new Uint8Array(length) }), DeserializeError);
  }
});

Deno.test("nonce seals hydrate only Noncer roles and consume small/big payload extents exactly", () => {
  for (const row of vectors.groups) {
    for (const domain of ["txt", "bny"] as const) {
      const wire = domain === "txt" ? b(row.qb64) : hexWire(row.qb2);
      const parsed = parseSealer(concatBytes(wire, b("TAIL")), V2, domain);
      assertEquals(parseStructor(wire, V2, domain).qb64g, row.qb64);
      assertEquals(parsed.consumed, wire.length);
      assertEquals(parsed.count, row.count);
      assertEquals(parsed.qb64g, row.qb64);
      assertEquals(wireHex(parsed.qb2g), row.qb2);
      assertEquals(
        parsed.items.map((entry) => {
          if (!isGroupTuple(entry) || !(entry[0] instanceof Noncer)) throw new Error("Expected nonce tuple");
          assertEquals(entry.length, 1);
          return SealNonce.toSad(SealNonce.fromTuple([entry[0]]));
        }),
        vectors.nonces.map((nonce) => nonce.sad),
      );
      for (let end = 0; end < wire.length; end++) {
        assertThrows(() => parseSealer(wire.subarray(0, end), V2, domain), ShortageError);
      }
    }
    assertStringIncludes(counterCodeNameForVersion(row.code, V2), "NonceSealSingles");
  }
  for (const domain of ["txt", "bny"] as const) {
    const encode = domain === "txt" ? b : decodeB64;
    for (const code of ["-N", "--N"]) {
      const header = new Counter({ code, count: 1, version: V2 }).qb64;
      assertThrows(() => parseSealer(encode(header + "0AAA"), V2, domain), GroupSizeError);
      assertThrows(() => parseSealer(encode(header), V2, domain), ShortageError);
      assertThrows(() => parseSealer(encode(groupV2(code, token("B"))), V2, domain), UnknownCodeError);
    }
  }
});

Deno.test("current counter small/big forms preserve widths, promotion and truncated-header errors", () => {
  for (const row of vectors.counters) {
    for (const domain of ["txt", "bny"] as const) {
      const wire = domain === "txt" ? b(row.qb64) : hexWire(row.qb2);
      const counter = parseCounter(concatBytes(wire, b("TAIL")), V2, domain);
      assertEquals([counter.code, counter.count, counter.name], [row.code, row.count, row.name]);
      assertEquals(domain === "txt" ? counter.fullSize : counter.fullSizeB2, wire.length);
      for (let end = 0; end < wire.length; end++) {
        assertThrows(() => parseCounter(wire.subarray(0, end), V2, domain), ShortageError);
      }
    }
  }
});

Deno.test("nonce seals and obsolete v2 receipts never become attachments across stream partitions", async () => {
  const oldReceipt = groupV2("-N", token("B") + token("0A") + token("E") + sigerToken());
  for (const row of [...vectors.groups, { qb64: oldReceipt, qb2: wireHex(decodeB64(oldReceipt)) }]) {
    for (const domain of ["txt", "bny"] as const) {
      const attachment = domain === "txt" ? b(row.qb64) : hexWire(row.qb2);
      assertThrows(() => parseAttachmentGroup(attachment, V2, domain), UnknownCodeError);
      const wire = concatBytes(domain === "txt" ? b(native) : decodeB64(native), attachment);
      for (const parts of [Array.from(wire, (byte) => Uint8Array.of(byte)), [wire]]) {
        await assertWireError(
          () => Array.fromAsync(parse(chunks(...parts))),
          UnknownCodeError,
        );
      }
      assertThrows(() => annotate(wire), UnknownCodeError);
    }
  }
  const bodyPayload = native.slice(4, -4) + groupV2("-J", "-NAB1AAP");
  for (const encode of [b, decodeB64]) {
    assertThrows(() => parseBytes(encode(groupV2("-F", bodyPayload))));
  }
  const sad = { ...expectedNativeKeriIcpSad(), a: [{ nd: "1AAP" }] };
  assertThrows(() => dumpCesrNativeSad(sad as never), SerializeError, "NonceSealSingles");
  assertEquals("TransReceiptQuadruples" in CtrDexV2, false);
});

Deno.test("historical v1 receipt quadruples remain item-counted protocol input", async () => {
  const payload = token("B") + token("0A") + token("E") + sigerToken();
  const attachment = new Counter({ code: CtrDexV1.TransReceiptQuadruples, count: 2, version: V1 }).qb64
    + payload.repeat(2);
  for (const domain of ["txt", "bny"] as const) {
    const wire = domain === "txt" ? b(attachment) : decodeB64(attachment);
    const { group, consumed } = parseAttachmentGroup(concatBytes(wire, b("TAIL")), V1, domain);
    assertEquals(consumed, wire.length);
    assertEquals([group.name, group.count, group.items.length], ["TransReceiptQuadruples", 2, 2]);
    for (const entry of group.items) {
      if (!isGroupTuple(entry)) throw new Error("Expected receipt tuple");
      assertEquals(entry.map((part) => part.constructor.name), ["Prefixer", "NumberPrimitive", "Diger", "Siger"]);
    }
  }
  const body = v1ify("{\"v\":\"KERI10JSON000000_\",\"t\":\"rpy\"}");
  assertStringIncludes(await annotate(body + attachment), "TransReceiptQuadruples");
  const [frame] = await parseBytes(b(body + attachment));
  assertEquals(
    await collectPayload(attachmentPayload(frame, { gvrsn: V1 })),
    Counter.enclose({ qb64: attachment, version: V1 }),
  );
  assertThrows(() => attachmentPayload(frame, { gvrsn: V2 }), SerializeError);
  assertThrows(() => SealNonce.fromSad({ nd: "" }), DeserializeError);
});
