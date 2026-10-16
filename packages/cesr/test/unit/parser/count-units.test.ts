import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert";
import { decodeB64 } from "../../../src/core/bytes.ts";
import { GroupSizeError, ShortageError } from "../../../src/core/errors.ts";
import { parseAttachmentGroup } from "../../../src/parser/attachments.ts";
import { parseBytes } from "../../../src/parser/complete.ts";
import { parse } from "../../../src/parser/parser.ts";
import { CtrDexV1, CtrDexV2 } from "../../../src/tables/counter-codex.ts";
import { counterV1, groupV2, sigerToken, token } from "../../fixtures/counter-token-fixtures.ts";
import { KERIPY_NATIVE_V2_ICP_FIX_BODY } from "../../fixtures/external-vectors.ts";
import { KERIPY_STRUCTOR_VECTORS } from "../../fixtures/keripy-primitive-vectors.ts";
import { assertWireError } from "../../fixtures/parser-test-helpers.ts";
import { encode } from "../../fixtures/stream-byte-fixtures.ts";

/** Genus v1 uses item counts for the attachment cases below. */
const V1 = { major: 1, minor: 0 } as const;
/** Genus v2 uses enclosed byte counts in its attachment counters. */
const V2 = { major: 2, minor: 0 } as const;
/** Exercise both qualified text and binary wire representations. */
const domains = ["txt", "bny"] as const;
/** Encode the same qualified fixture in the requested wire domain. */
const bytes = (text: string, domain: typeof domains[number]) => domain === "txt" ? encode(text) : decodeB64(text);
// Generated with KERIpy 927c0cb8794d7c84fc17143c67df64aab9deda6c:
// Siger(raw=bytes(64), code="2A", index=65).qb64 (92 chars, 23 quadlets).
const bigSiger = "2ABBBB" + "A".repeat(86);

Deno.test("signature count units match pinned KERIpy in text and binary", () => {
  for (const domain of domains) {
    for (
      const [version, header, count, payload, items] of [
        [V1, "-AAB", 1, sigerToken(), 1],
        [V1, "-BAB", 1, sigerToken(), 1],
        [V2, "-KAW", 22, sigerToken(), 1],
        [V2, "-LAW", 22, sigerToken(), 1],
        [V2, "--KAAAAW", 22, sigerToken(), 1],
        [V2, "--LAAAAW", 22, sigerToken(), 1],
        [V2, "-KAX", 23, bigSiger, 1],
        [V2, "-KAt", 45, sigerToken() + bigSiger, 2],
        [V2, "-KAA", 0, "", 0],
      ] as const
    ) {
      const wire = bytes(header + payload, domain);
      const parsed = parseAttachmentGroup(wire, version, domain);
      assertEquals(parsed.consumed, wire.length);
      assertEquals(parsed.group.count, count);
      assertEquals(parsed.group.items.length, items);
      assertEquals(parsed.group.raw, wire);
    }
  }
});

Deno.test("v2 boundaries distinguish incomplete transport from malformed complete payloads", () => {
  for (const domain of domains) {
    const good = bytes("-KAW" + sigerToken(), domain);
    assertThrows(() => parseAttachmentGroup(good.slice(0, -1), V2, domain), ShortageError);
    for (
      const malformed of [
        "-KAB" + sigerToken(), // A full signature outside the declared four-character boundary cannot repair it.
        "-KAX" + sigerToken() + "AAAA", // Complete payload, incomplete second signature.
        groupV2(CtrDexV2.NonTransReceiptCouples, token("B")), // Missing second tuple element.
        groupV2(CtrDexV2.TransLastIdxSigGroups, token("B") + "-KAW"), // Inner payload exceeds outer boundary.
      ]
    ) {
      for (const wire of [malformed, groupV2(CtrDexV2.AttachmentGroup, malformed)]) {
        assertThrows(
          () => parseAttachmentGroup(bytes(wire + "-KAW" + sigerToken(), domain), V2, domain),
          GroupSizeError,
        );
      }
    }
    const adjacent = bytes("-KAW" + sigerToken() + "-LAW" + sigerToken(), domain);
    const first = parseAttachmentGroup(adjacent, V2, domain);
    assertEquals(first.consumed, good.length);
    assertEquals(parseAttachmentGroup(adjacent.slice(first.consumed), V2, domain).group.code, "-L");
  }
});

Deno.test("versioned transferable groups preserve item counts, payload bounds, and nested signatures", () => {
  for (const domain of domains) {
    for (
      const [version, code, header] of [
        [V1, CtrDexV1.TransIdxSigGroups, token("B") + token("0A") + token("E")],
        [V1, CtrDexV1.TransLastIdxSigGroups, token("B")],
        [V2, CtrDexV2.TransIdxSigGroups, token("B") + token("0A") + token("E")],
        [V2, CtrDexV2.BigTransIdxSigGroups, token("B") + token("0A") + token("E")],
        [V2, CtrDexV2.TransLastIdxSigGroups, token("B")],
        [V2, CtrDexV2.BigTransLastIdxSigGroups, token("B")],
      ] as const
    ) {
      const inner = (version.major === 1 ? "-AAC" : "-KAt") + sigerToken() + bigSiger;
      const payload = (header + inner).repeat(2);
      const group = version.major === 1 ? counterV1(code, 2) + payload : groupV2(code, payload);
      const wire = bytes(group, domain);
      const parsed = parseAttachmentGroup(bytes(group + group, domain), version, domain);
      assertEquals(parsed.group.raw, wire);
      assertEquals(parsed.consumed, wire.length);
      assertEquals(parsed.group.items.length, 2);
      const tuples = parsed.group.items as unknown[][];
      assertEquals((tuples[0].at(-1) as unknown[]).length, 2);
      assertEquals((tuples[1].at(-1) as unknown[]).length, 2);
    }
  }
});

Deno.test("v2 length-counted signatures preserve bytewise and attachment-edge framing", async () => {
  for (const domain of domains) {
    for (const code of [CtrDexV2.ControllerIdxSigs, CtrDexV2.WitnessIdxSigs]) {
      const wire = bytes(KERIPY_NATIVE_V2_ICP_FIX_BODY + groupV2(code, sigerToken() + bigSiger), domain);
      const expected = await parseBytes(wire);
      assertEquals(expected.length, 1);
      assertEquals(expected[0].attachments[0].items.length, 2);
      const edge = bytes(KERIPY_NATIVE_V2_ICP_FIX_BODY, domain).length + 1;
      for (const parts of [Array.from(wire, (byte) => Uint8Array.of(byte)), [wire.slice(0, edge), wire.slice(edge)]]) {
        /** Bytewise input visits all headers; the edge case resumes inside the attachment counter. */
        const chunks = async function*() {
          yield* parts;
        };
        assertEquals(await Array.fromAsync(parse(chunks())), expected, `${domain} ${code}`);
      }
    }
  }
});

Deno.test("v2 tuple families exhaust payload lengths rather than repeat the wire count", () => {
  for (
    const [code, payload] of [
      [CtrDexV2.NonTransReceiptCouples, token("B") + token("0B")],
      [CtrDexV2.FirstSeenReplayCouples, token("0A") + token("1AAG")],
      [CtrDexV2.SealSourceCouples, token("0A") + token("E")],
      [CtrDexV2.SealSourceTriples, token("B") + token("0A") + token("E")],
      [CtrDexV2.SealSourceLastSingles, token("B")],
      [CtrDexV2.DigestSealSingles, token("E")],
      [CtrDexV2.MerkleRootSealSingles, token("E")],
      [CtrDexV2.BackerRegistrarSealCouples, token("B") + token("E")],
      [CtrDexV2.TypedDigestSealCouples, KERIPY_STRUCTOR_VECTORS.sealerTypedDigestPayload],
      [CtrDexV2.BlindedStateQuadruples, KERIPY_STRUCTOR_VECTORS.blinderBlindStatePayload],
      [CtrDexV2.TypedMediaQuadruples, KERIPY_STRUCTOR_VECTORS.mediarTypedMediaPayload],
      [CtrDexV2.BoundStateSextuples, KERIPY_STRUCTOR_VECTORS.blinderBlindStatePayload + token("M") + token("E")],
    ]
  ) {
    for (const domain of domains) {
      const wire = bytes(groupV2(code, payload.repeat(2)), domain);
      const parsed = parseAttachmentGroup(wire, V2, domain);
      assertEquals(parsed.consumed, wire.length);
      assertEquals(parsed.group.items.length, 2);
      assertEquals(parsed.group.count, payload.length / 2);
    }
  }
});

Deno.test("a complete malformed v2 signature group fails without requesting EOF", async () => {
  /** The invalid group must fail before reading any later transport data. */
  async function* source() {
    yield encode(KERIPY_NATIVE_V2_ICP_FIX_BODY + "-KAB" + sigerToken());
    throw new Error("Parser read beyond a malformed bounded group");
  }
  const parser = parse(source());
  await assertWireError(() => parser.next(), GroupSizeError);
  assertEquals((await parser.next()).done, true);
});

Deno.test("v2 big signature counters handle payloads beyond the small-counter limit", () => {
  const payload = sigerToken().repeat(187); // 4114 quadlets, above the 4095 small-counter limit.
  for (const code of [CtrDexV2.BigControllerIdxSigs, CtrDexV2.BigWitnessIdxSigs]) {
    for (const domain of domains) {
      const wire = bytes(groupV2(code, payload), domain);
      const parsed = parseAttachmentGroup(wire, V2, domain);
      assertEquals(parsed.consumed, wire.length);
      assertEquals(parsed.group.count, 4114);
      assertEquals(parsed.group.items.length, 187);
    }
  }
});
