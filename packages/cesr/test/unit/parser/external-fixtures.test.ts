import { assertEquals, assertRejects } from "jsr:@std/assert";
import { decodeB64, t } from "../../../src/core/bytes.ts";
import { DeserializeError } from "../../../src/core/errors.ts";
import { parseAttachmentGroup } from "../../../src/parser/attachments.ts";
import { parseBytes } from "../../../src/parser/complete.ts";
import { CtrDexV1, CtrDexV2 } from "../../../src/tables/counter-codex.ts";
import { counterV2, groupV2, sigerToken } from "../../fixtures/counter-token-fixtures.ts";
import { KERIPY_NATIVE_V2_ICP_FIX_BODY, PARSIDE_GROUP_VECTORS } from "../../fixtures/external-vectors.ts";
import { encode } from "../../fixtures/stream-byte-fixtures.ts";

Deno.test("parside fixtures parse as expected CESR groups", () => {
  const cases: Array<{ vector: string; code: string; name: string }> = [
    {
      vector: PARSIDE_GROUP_VECTORS.transIdxSigGroups,
      code: CtrDexV1.TransIdxSigGroups,
      name: "TransIdxSigGroups",
    },
    {
      vector: PARSIDE_GROUP_VECTORS.controllerIdxSigs,
      code: CtrDexV1.ControllerIdxSigs,
      name: "ControllerIdxSigs",
    },
    {
      vector: PARSIDE_GROUP_VECTORS.nonTransReceiptCouples,
      code: CtrDexV1.NonTransReceiptCouples,
      name: "NonTransReceiptCouples",
    },
    {
      vector: PARSIDE_GROUP_VECTORS.transLastIdxSigGroups,
      code: CtrDexV1.TransLastIdxSigGroups,
      name: "TransLastIdxSigGroups",
    },
    {
      vector: PARSIDE_GROUP_VECTORS.attachmentGroup,
      code: CtrDexV1.AttachmentGroup,
      name: "AttachmentGroup",
    },
  ];

  for (const entry of cases) {
    const parsed = parseAttachmentGroup(
      encode(entry.vector),
      { major: 1, minor: 0 },
      "txt",
    );
    assertEquals(parsed.consumed, entry.vector.length);
    assertEquals(parsed.group.code, entry.code);
    assertEquals(parsed.group.name, entry.name);
    assertEquals(parsed.group.items.length > 0, true);
  }
});

Deno.test("parside fixtures have qb64/qb2 dispatch parity", () => {
  const vectors = [
    PARSIDE_GROUP_VECTORS.transIdxSigGroups,
    PARSIDE_GROUP_VECTORS.controllerIdxSigs,
    PARSIDE_GROUP_VECTORS.nonTransReceiptCouples,
    PARSIDE_GROUP_VECTORS.transLastIdxSigGroups,
    PARSIDE_GROUP_VECTORS.attachmentGroup,
  ];

  for (const vector of vectors) {
    const txt = parseAttachmentGroup(
      encode(vector),
      { major: 1, minor: 0 },
      "txt",
    );
    const bny = parseAttachmentGroup(
      decodeB64(vector),
      { major: 1, minor: 0 },
      "bny",
    );
    assertEquals(bny.group.code, txt.group.code);
    assertEquals(bny.group.count, txt.group.count);
    assertEquals(bny.group.items.length, txt.group.items.length);
  }
});

Deno.test("KERIpy native v2 fix-body fixture parses as top-level frame", async () => {
  const frames = await parseBytes(encode(KERIPY_NATIVE_V2_ICP_FIX_BODY));
  assertEquals(frames.length, 1);
  const { body, attachments } = frames[0];
  assertEquals(t(body.raw), KERIPY_NATIVE_V2_ICP_FIX_BODY);
  assertEquals(body.kind, "CESR");
  assertEquals(body.pvrsn.major, 2);
  assertEquals(body.ilk, "icp");
  assertEquals(body.ked?.t, "icp");
  assertEquals(body.said, "EFaYE2LTv8dItUgQzIHKRA9FaHDrHtIHNs-m5DJKWXRN");
  assertEquals(attachments.length, 0);
});

Deno.test("qb2 BodyWithAttachmentGroup parses nested native body", async () => {
  const payload = KERIPY_NATIVE_V2_ICP_FIX_BODY;
  assertEquals(payload.length % 4, 0);
  const wrapped = counterV2(CtrDexV2.BodyWithAttachmentGroup, payload.length / 4) + payload;
  const frames = await parseBytes(decodeB64(wrapped));
  assertEquals(frames.length, 1);
  assertEquals(frames[0].body.kind, "CESR");
  assertEquals(frames[0].attachments.length, 0);
});

Deno.test("txt and qb2 BodyWithAttachmentGroup parse nested native body with attachments", async () => {
  const payload = KERIPY_NATIVE_V2_ICP_FIX_BODY + groupV2(CtrDexV2.ControllerIdxSigs, sigerToken());
  assertEquals(payload.length % 4, 0);
  const wrapped = counterV2(CtrDexV2.BodyWithAttachmentGroup, payload.length / 4) + payload;
  const txt = await parseBytes(encode(wrapped));
  const bny = await parseBytes(decodeB64(wrapped));
  assertEquals(txt.length, 1);
  assertEquals(bny.length, 1);
  assertEquals(txt[0].body.kind, "CESR");
  assertEquals(txt[0].body.ilk, "icp");
  assertEquals(bny[0].body.kind, "CESR");
  assertEquals(bny[0].body.ilk, txt[0].body.ilk);
  assertEquals(bny[0].body.said, txt[0].body.said);
  assertEquals(bny[0].attachments.length, txt[0].attachments.length);
});

Deno.test("top-level native MapBodyGroup without version field is rejected as non-message", async () => {
  const payload = KERIPY_NATIVE_V2_ICP_FIX_BODY.slice(4);
  const mapPayload = `0J_i${payload.slice(0, 12)}0J_s${payload.slice(12, 16)}0J_d${payload.slice(16)}`;
  const mapBody = counterV2(CtrDexV2.MapBodyGroup, mapPayload.length / 4) + mapPayload;
  // Lower-level maps are useful primitive fixtures, but no protocol body exists without v.
  await assertRejects(() => parseBytes(encode(mapBody)), DeserializeError);
});
