import { assertEquals, assertExists, assertInstanceOf, assertRejects } from "jsr:@std/assert";
import { b, concatBytes, decodeB64, t } from "../../../src/core/bytes.ts";
import { DeserializeError, GroupSizeError, ShortageError, WireParseError } from "../../../src/core/errors.ts";
import { collectPayload } from "../../../src/core/payload.ts";
import { essrRaw, essrWire } from "../../../src/parser/essr.ts";
import { parse } from "../../../src/parser/parser.ts";
import { Counter } from "../../../src/primitives/counter.ts";
import { Texter } from "../../../src/primitives/texter.ts";
import { CtrDexV1, CtrDexV2 } from "../../../src/tables/counter-codex.ts";
import { sigerToken } from "../../fixtures/counter-token-fixtures.ts";
import { KERIPY_V1_JSON_ICP_BODY } from "../../fixtures/external-vectors.ts";
/** Build genus-specific counters around one shared protocol-v1 JSON body. */
function vector(major: 1 | 2) {
  // Selected genus for fixture counters, independent of the embedded JSON protocol.
  const gvrsn = { major, minor: 0 } as const;
  // Semantic counter names resolve through the matching generated genus table.
  const codes = major === 1 ? CtrDexV1 : CtrDexV2;
  // Construct a fixture counter with explicit promotion when its small form overflows.
  const counter = (code: string, count: number) => {
    // Counter construction requires explicit promotion once its two soft sextets overflow.
    const name = Object.entries(codes).find(([, value]) => value === code)![0];
    if (count > 4095) code = codes[`Big${name}` as keyof typeof codes];
    return new Counter({ code, count, version: gvrsn }).qb64;
  };
  // Sized wrappers always count qualified text quadlets, including under v1.
  const group = (
    name: "GenericGroup" | "BodyWithAttachmentGroup" | "NonNativeBodyGroup" | "AttachmentGroup",
    wire: string,
  ) => counter(codes[name], wire.length / 4) + wire;
  // Wrap the real JSON vector so the entire fixture can also be encoded as qb2.
  const body = group("NonNativeBodyGroup", new Texter({ raw: b(KERIPY_V1_JSON_ICP_BODY), code: "4B" }).qb64);
  // Signature counters count items in v1 and payload quadlets in v2.
  const sig = counter(codes.ControllerIdxSigs, major === 1 ? 1 : sigerToken().length / 4) + sigerToken();
  // ESSR counters use item counts in v1 and qualified payload quadlets in v2.
  const essr = (wire: string, count: number) =>
    counter(codes.ESSRPayloadGroup, major === 1 ? count : wire.length / 4) + wire;
  return { gvrsn, body, sig, group, essr, selector: t(Counter.makeGVC(gvrsn)) };
}
/** Owned input slices model producer chunks without pinning a large backing buffer. */
async function* chunks(bytes: Uint8Array, size = 31): AsyncGenerator<Uint8Array> {
  for (let offset = 0; offset < bytes.length; offset += size) yield bytes.slice(offset, offset + size);
}

Deno.test("ESSR preserves fragment order, duplicates and mixed Texter lengths in both genera/domains", async () => {
  const raw = [new Uint8Array(), b("abc"), b("abc"), b("a"), b("bc"), new Uint8Array(49157).fill(213)];
  const wire = raw.map((part) => new Texter({ raw: part, code: "4B" }).qb64).join("");
  for (const major of [1, 2] as const) {
    const v = vector(major);
    for (const encode of [b, decodeB64]) {
      const input = v.selector
        + v.group("BodyWithAttachmentGroup", v.body + v.group("AttachmentGroup", v.sig + v.essr(wire, raw.length)));
      const parser = parse(chunks(encode(input), 1021));
      const first = await parser.next();
      assertEquals(first.done, false);
      const frame = first.value!;
      assertExists(frame.essrs);
      assertEquals(frame.attachments.map((group) => group.name), ["ControllerIdxSigs"]);
      assertEquals(frame.gvrsn, v.gvrsn);
      assertEquals(frame.essrs.map((texter) => texter.raw), raw);
      assertEquals(await collectPayload(essrWire(frame.essrs)), b(wire));
      assertEquals(await collectPayload(essrRaw(frame.essrs)), concatBytes(...raw));
      assertEquals((await parser.next()).done, true);
      // Ordinary evidence remains readable after the input has closed.
      assertEquals(await collectPayload(essrRaw(frame.essrs)), concatBytes(...raw));
    }
  }
});
Deno.test("ESSR headers survive every source split and preserve a big code for a small token", async () => {
  for (const major of [1, 2] as const) {
    const v = vector(major);
    const wire = "7AABAAABYWJj" + new Texter({ raw: b("xy"), code: "4B" }).qb64;
    for (const encode of [b, decodeB64]) {
      const bytes = encode(v.selector + v.group("BodyWithAttachmentGroup", v.body + v.essr(wire, 2)));
      for await (const frame of parse(chunks(bytes, 1))) {
        assertExists(frame.essrs);
        assertEquals(await collectPayload(essrWire(frame.essrs)), b(wire));
        assertEquals(await collectPayload(essrRaw(frame.essrs)), b("abcxy"));
      }
    }
  }
});
Deno.test("ESSR rejects invalid alphabet, lead padding, impossible extents and truncation", async () => {
  const v = vector(2);
  for (const token of ["5BABAQAA", "6BABAAEA", "4BABYW=J", "5BAA"]) {
    const failure = await assertRejects(
      () => parse(chunks(b(v.selector + v.group("BodyWithAttachmentGroup", v.body + v.essr(token, 1))))).next(),
      WireParseError,
    );
    assertInstanceOf(failure.cause, DeserializeError);
  }
  for (const encode of [b, decodeB64]) {
    const invalid = await assertRejects(
      () => parse(chunks(encode(v.selector + v.body + v.essr("4BACAAAA", 1)))).next(),
      WireParseError,
    );
    assertInstanceOf(invalid.cause, GroupSizeError);
    const complete = encode(v.selector + v.group("BodyWithAttachmentGroup", v.body + v.essr("4BACAAAAAAAA", 1)));
    const truncated = await assertRejects(() => parse(chunks(complete.slice(0, -1))).next(), WireParseError);
    assertInstanceOf(truncated.cause, ShortageError);
    const padding = await assertRejects(
      () => parse(chunks(encode(v.selector + v.body + v.essr("5BABAQAA", 1)))).next(),
      WireParseError,
    );
    assertInstanceOf(padding.cause, DeserializeError);
  }
});
Deno.test("ESSR single-frame enclosure rejects multiple candidates before delivery", async () => {
  const v = vector(2);
  const child = v.group("BodyWithAttachmentGroup", v.body + v.essr("4BABYWJj", 1));
  await assertRejects(
    () => parse(chunks(b(v.selector + v.group("BodyWithAttachmentGroup", child + child)))).next(),
    WireParseError,
    "more than one frame",
  );
});
Deno.test("delivered ESSR stays readable after a malformed later sibling in a complete group", async () => {
  const v = vector(2);
  const good = v.group("BodyWithAttachmentGroup", v.body + v.essr("4BABYWJj", 1));
  const bad = v.group("BodyWithAttachmentGroup", v.body + v.essr("5BABAQAA", 1));
  const parser = parse(chunks(b(v.selector + v.group("GenericGroup", good + bad))));
  const first = (await parser.next()).value!;
  assertExists(first.essrs);
  await assertRejects(() => parser.next(), WireParseError);
  assertEquals(await collectPayload(essrRaw(first.essrs)), b("abc"));
});
Deno.test("attachment wrapper selectors restore the enclosing ESSR genus", async () => {
  const one = vector(1), two = vector(2);
  const inner = two.group("AttachmentGroup", one.selector + one.essr("4BABYWJj", 1) + one.sig);
  const wire = two.selector
    + two.group(
      "BodyWithAttachmentGroup",
      two.body + two.group("AttachmentGroup", inner + two.essr("4BABeHl6", 1) + two.sig),
    );
  for (const encode of [b, decodeB64]) {
    for await (const frame of parse(chunks(encode(wire)))) {
      assertExists(frame.essrs);
      assertEquals(frame.attachments.map((group) => group.code), [
        CtrDexV1.ControllerIdxSigs,
        CtrDexV2.ControllerIdxSigs,
      ]);
      assertEquals(await collectPayload(essrRaw(frame.essrs)), b("abcxyz"));
    }
  }
});
