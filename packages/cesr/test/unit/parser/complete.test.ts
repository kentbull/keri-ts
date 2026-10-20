import { assertEquals, assertExists, assertThrows } from "jsr:@std/assert";
import { b, concatBytes } from "../../../src/core/bytes.ts";
import { ShortageError } from "../../../src/core/errors.ts";
import { parseBytes } from "../../../src/parser/complete.ts";
import { Counter } from "../../../src/primitives/counter.ts";
import { Texter } from "../../../src/primitives/texter.ts";
import { CtrDexV1 } from "../../../src/tables/counter-codex.ts";
import { KERIPY_V1_JSON_ICP_BODY } from "../../fixtures/external-vectors.ts";

/** Enclose one real protocol body and one ESSR item with an explicit frame boundary. */
function frame(raw: Uint8Array): string {
  // Qualify the JSON body so counted enclosure lengths stay quadlet-aligned.
  const body = new Texter({ raw: b(KERIPY_V1_JSON_ICP_BODY), code: "4B" }).qb64;
  const bodyHeader = new Counter({
    code: CtrDexV1.NonNativeBodyGroup,
    count: body.length / 4,
    version: { major: 1, minor: 0 },
  }).qb64;
  // v1 ESSR counts items, while the surrounding frame counts text quadlets.
  const essrHeader = new Counter({ code: CtrDexV1.ESSRPayloadGroup, count: 1, version: { major: 1, minor: 0 } }).qb64;
  const payload = bodyHeader + body + essrHeader + new Texter({ raw, code: "4B" }).qb64;
  const count = payload.length / 4;
  // The small counter holds two count sextets; longer frames need its big form.
  const code = count > 4095 ? CtrDexV1.BigBodyWithAttachmentGroup : CtrDexV1.BodyWithAttachmentGroup;
  return new Counter({ code, count, version: { major: 1, minor: 0 } }).qb64 + payload;
}

Deno.test("complete input parsing accepts large backing buffers and transfers ordered payloads", async () => {
  // A large input remains valid without a parser backing-allocation quota.
  const raw = new Uint8Array(1024 ** 2 + 1).fill(37);
  const frames = await parseBytes(b(frame(raw) + frame(b("second"))));
  assertEquals(frames.length, 2);
  assertExists(frames[0].essrs);
  assertExists(frames[1].essrs);
  assertEquals(concatBytes(...frames[0].essrs.map((part) => part.raw)), raw);
  assertEquals(concatBytes(...frames[1].essrs.map((part) => part.raw)), b("second"));
  assertEquals(parseBytes(new Uint8Array()), []);
});

Deno.test("complete input rejects a truncated trailing counter", () => {
  assertThrows(() => parseBytes(b(frame(b("first")) + frame(b("second")) + "-A")), ShortageError);
});
