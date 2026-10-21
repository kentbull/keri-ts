import { assertEquals, assertExists, assertRejects, assertThrows } from "jsr:@std/assert";
import { b, concatBytes, decodeB64, t } from "../../../src/core/bytes.ts";
import { SerializeError } from "../../../src/core/errors.ts";
import { collectPayload } from "../../../src/core/payload.ts";
import type { CesrFrame } from "../../../src/core/types.ts";
import { parse } from "../../../src/parser/parser.ts";
import { attachmentPayload, essrChunks, framePayload } from "../../../src/parser/serialize.ts";
import { Counter } from "../../../src/primitives/base/counter.ts";
import { Texter } from "../../../src/primitives/values/texter.ts";
import { CtrDexV1, CtrDexV2 } from "../../../src/tables/counter-codex.ts";
import { sigerToken, token } from "../../fixtures/counter-token-fixtures.ts";
import { KERIPY_V1_JSON_ICP_BODY as json } from "../../fixtures/external-vectors.ts";

/** Build one frame with a transferable signature group and two ESSR fragments. */
function fixture(major: 1 | 2) {
  // Count semantics come from genus even though the embedded JSON always declares protocol v1.
  const gvrsn = { major, minor: 0 } as const;
  const codes = major === 1 ? CtrDexV1 : CtrDexV2;
  /** Encode one counter from its semantic name and explicit count. */
  const head = (name: string, count: number) =>
    new Counter({ code: codes[name as keyof typeof codes], count, version: gvrsn }).qb64;
  /** Sized wrappers count text quadlets in either genus. */
  const wrap = (name: string, wire: string) => t(Counter.enclose({ code: name, qb64: wire, version: gvrsn }));
  // Real primitive qualification preserves the omitted inner controller counter on reconstruction.
  const signatures = head("ControllerIdxSigs", major === 1 ? 1 : 22) + sigerToken();
  const trans = token("B") + token("0A") + token("E") + signatures;
  const group = head("TransIdxSigGroups", major === 1 ? 1 : trans.length / 4) + trans;
  // Canonical wire contains token boundaries but never the enclosing ESSR counter.
  const wire = new Texter({ code: "4B", raw: b("abc") }).qb64 + new Texter({ code: "4B", raw: b("xyz") }).qb64;
  const essr = head("ESSRPayloadGroup", major === 1 ? 2 : wire.length / 4) + wire;
  const body = wrap("NonNativeBodyGroup", new Texter({ code: "4B", raw: b(json) }).qb64);
  const frame = t(Counter.makeGVC(gvrsn)) + wrap("BodyWithAttachmentGroup", body + group + essr);
  return { gvrsn, head, wrap, signatures, group, wire, essr, body, frame };
}

/** Feed owned irregular slices so source partitioning cannot decide token boundaries. */
async function* source(bytes: Uint8Array, width = 19): AsyncGenerator<Uint8Array> {
  for (let offset = 0; offset < bytes.length; offset += width) yield bytes.slice(offset, offset + width);
}

/** Read a single explicitly enclosed fixture and release only its upstream iterator. */
async function read(bytes: Uint8Array): Promise<CesrFrame> {
  // Returning the parser does not revoke the delivered payload owner.
  const parser = parse(source(bytes));
  try {
    const first = await parser.next();
    assertEquals(first.done, false);
    return first.value as CesrFrame;
  } finally {
    await parser.return(undefined);
  }
}

Deno.test("frame serialization normalizes both genera/domains and preserves inner signature counters", async () => {
  for (const incoming of [1, 2] as const) {
    // Both source qualifications hydrate identical semantic frames.
    const original = fixture(incoming);
    for (const encode of [b, decodeB64]) {
      const frame = await read(encode(original.frame));

      for (const major of [1, 2] as const) {
        const expected = fixture(major);
        for (const domain of ["txt", "bny"] as const) {
          // Only one frame is collected here; production consumers iterate open().
          const output = framePayload(frame, { gvrsn: expected.gvrsn, domain });
          const roundtrip = await read(await collectPayload(output));
          assertEquals(roundtrip.body.raw, b(json));
          assertEquals(roundtrip.attachments.length, 1);
          assertEquals(roundtrip.attachments[0].version, expected.gvrsn);
          assertEquals(
            roundtrip.attachments[0].raw,
            domain === "txt" ? b(expected.group) : decodeB64(expected.group),
          );
          assertExists(roundtrip.essrs);
          assertEquals(roundtrip.essrs.length, 2);
          assertEquals(concatBytes(...roundtrip.essrs.map((part) => part.raw)), b("abcxyz"));
        }
      }
    }
  }
});

Deno.test("flattened wrapper-local genera serialize as one legal attachment genus", async () => {
  // Input accepts nested local selectors; output cannot place selectors between KERIpy attachment leaves.
  const one = fixture(1);
  const two = fixture(2);
  const nested = two.wrap("AttachmentGroup", t(Counter.makeGVC(one.gvrsn)) + one.group);
  const wire = t(Counter.makeGVC(two.gvrsn))
    + two.wrap("BodyWithAttachmentGroup", two.body + two.wrap("AttachmentGroup", nested + two.group + two.essr));
  const frame = await read(b(wire));
  for (const domain of ["txt", "bny"] as const) {
    const output = attachmentPayload(frame, { gvrsn: two.gvrsn, domain });
    const bytes = await collectPayload(output);
    // Exact bytes prove no hidden selectors and unchanged inner signature qualification.
    const expected = two.wrap("AttachmentGroup", two.group + two.group + two.essr);
    assertEquals(bytes, domain === "txt" ? b(expected) : decodeB64(expected));
  }
});

Deno.test("ESSR serialization derives genus counts; the payload reader owns cancellation", async () => {
  for (const major of [1, 2] as const) {
    const value = fixture(major);
    const essrs = ["abc", "xyz"].map((raw) => new Texter({ raw: b(raw), code: "4B" }));
    const parts: Uint8Array[] = [];
    for await (const chunk of essrChunks(essrs, { gvrsn: value.gvrsn, domain: "bny" })) parts.push(chunk);
    assertEquals(concatBytes(...parts), decodeB64(value.essr));
    const controller = new AbortController();
    const frame = await read(b(value.wrap("BodyWithAttachmentGroup", value.body + value.essr)));
    const iterator = attachmentPayload(frame, { domain: "bny" }).open(controller.signal)[Symbol.asyncIterator]();
    await iterator.next(); // Attachment enclosure.
    await iterator.next(); // ESSR header; abort before its first qualified fragment.
    controller.abort(new Error("stop serialization"));
    await assertRejects(() => iterator.next(), Error, "stop serialization");
  }
});

Deno.test("opaque attachment content cannot be silently retagged to another genus", async () => {
  // Pathed content may itself contain counters; changing its enclosing genus does not decode those bytes.
  const value = fixture(1);
  const wire = t(Counter.makeGVC(value.gvrsn))
    + value.wrap("BodyWithAttachmentGroup", value.body + value.wrap("PathedMaterialCouples", "AAAA"));
  const frame = await read(b(wire));
  assertThrows(() => attachmentPayload(frame, { gvrsn: { major: 2, minor: 0 } }), SerializeError, "opaque");
  assertEquals(attachmentPayload(frame, { gvrsn: value.gvrsn }).size > 0, true);
});

Deno.test("detached attachments retain the selected genus independently of the JSON body protocol", async () => {
  const two = fixture(2);
  const frame = await read(b(two.frame));
  const payload = attachmentPayload(frame);
  const expected = two.wrap("AttachmentGroup", two.group + two.essr);
  assertEquals(await collectPayload(payload), b(expected));
  // A detached receiver supplies its counter context, as KERIpy Parser(version=...) does.
  const roundtrip = await read(concatBytes(Counter.makeGVC(two.gvrsn), b(json), b(expected)));
  assertEquals(roundtrip.body.pvrsn, { major: 1, minor: 0 });
  assertEquals(roundtrip.gvrsn, two.gvrsn);
  assertEquals(roundtrip.attachments[0].version, two.gvrsn);
  assertExists(roundtrip.essrs);
  assertEquals(concatBytes(...roundtrip.essrs.map((part) => part.raw)), b("abcxyz"));
});

Deno.test("genus conversion rejects a transferable signature tuple needing an unsupported big inner counter", async () => {
  // V1 counts signatures; v2 counts each signature's 22 quadlets, so 187 entries overflow its small counter.
  const value = fixture(1);
  const signatures = value.head("ControllerIdxSigs", 187) + sigerToken().repeat(187);
  const trans = value.head("TransIdxSigGroups", 1) + token("B") + token("0A") + token("E") + signatures;
  const frame = await read(
    b(t(Counter.makeGVC(value.gvrsn)) + value.wrap("BodyWithAttachmentGroup", value.body + trans)),
  );
  assertThrows(
    () => attachmentPayload(frame, { gvrsn: { major: 2, minor: 0 } }),
    SerializeError,
    "small inner counter",
  );
});
