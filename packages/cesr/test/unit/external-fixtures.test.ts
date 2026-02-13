import { assertEquals } from "jsr:@std/assert";
import { parseAttachmentDispatch } from "../../src/parser/group-dispatch.ts";
import { CtrDexV1, CtrDexV2 } from "../../src/tables/counter-codex.ts";
import {
  KERIPY_NATIVE_V2_ICP_FIX_BODY,
  PARSIDE_GROUP_VECTORS,
} from "../fixtures/external-vectors.ts";
import { createParser } from "../../src/core/parser-engine.ts";
import { decodeB64, intToB64 } from "../../src/core/bytes.ts";
import { COUNTER_SIZES_V2 } from "../../src/tables/counter.tables.generated.ts";

function encode(input: string): Uint8Array {
  return new TextEncoder().encode(input);
}

function makeCounterV2(code: string, count: number): string {
  const sizage = COUNTER_SIZES_V2.get(code);
  if (!sizage) throw new Error(`Unknown v2 counter code ${code}`);
  return `${code}${intToB64(count, sizage.ss)}`;
}

function sigerToken(): string {
  return `A${"A".repeat(87)}`;
}

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
    const parsed = parseAttachmentDispatch(
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
    const txt = parseAttachmentDispatch(
      encode(vector),
      { major: 1, minor: 0 },
      "txt",
    );
    const bny = parseAttachmentDispatch(
      decodeB64(vector),
      { major: 1, minor: 0 },
      "bny",
    );
    assertEquals(bny.group.code, txt.group.code);
    assertEquals(bny.group.count, txt.group.count);
    assertEquals(bny.group.items.length, txt.group.items.length);
  }
});

Deno.test("KERIpy native v2 fix-body fixture parses as top-level frame", () => {
  const parser = createParser();
  const first = parser.feed(encode(KERIPY_NATIVE_V2_ICP_FIX_BODY));
  assertEquals(first.length, 0);
  const emissions = parser.flush();
  assertEquals(emissions.length, 1);
  assertEquals(emissions[0].type, "frame");
  if (emissions[0].type === "frame") {
    const raw = new TextDecoder().decode(emissions[0].frame.serder.raw);
    assertEquals(raw, KERIPY_NATIVE_V2_ICP_FIX_BODY);
    assertEquals(emissions[0].frame.serder.kind, "CESR");
    assertEquals(emissions[0].frame.serder.pvrsn.major, 2);
    assertEquals(emissions[0].frame.serder.ilk, "icp");
    assertEquals(
      emissions[0].frame.serder.said,
      "EFaYE2LTv8dItUgQzIHKRA9FaHDrHtIHNs-m5DJKWXRN",
    );
    assertEquals(emissions[0].frame.attachments.length, 0);
  }
});

Deno.test("qb2 BodyWithAttachmentGroup parses nested native body", () => {
  const payload = `${KERIPY_NATIVE_V2_ICP_FIX_BODY}`;
  assertEquals(payload.length % 4, 0);

  const wrapped = `${makeCounterV2(
    CtrDexV2.BodyWithAttachmentGroup,
    payload.length / 4,
  )}${payload}`;

  const parser = createParser();
  const first = parser.feed(decodeB64(wrapped));
  const emissions = first.length > 0 ? first : parser.flush();
  assertEquals(emissions.length, 1);
  assertEquals(emissions[0].type, "frame");
  if (emissions[0].type === "frame") {
    assertEquals(emissions[0].frame.serder.kind, "CESR");
    assertEquals(emissions[0].frame.attachments.length, 0);
  }
});

Deno.test("txt and qb2 BodyWithAttachmentGroup parse nested native body with attachments", () => {
  const nestedAttachment = `${makeCounterV2(CtrDexV2.ControllerIdxSigs, 1)}${
    sigerToken()
  }`;
  const payload = `${KERIPY_NATIVE_V2_ICP_FIX_BODY}${nestedAttachment}`;
  assertEquals(payload.length % 4, 0);

  const wrapped = `${makeCounterV2(
    CtrDexV2.BodyWithAttachmentGroup,
    payload.length / 4,
  )}${payload}`;

  const txtParser = createParser();
  const txtFirst = txtParser.feed(encode(wrapped));
  const txt = txtFirst.length > 0 ? txtFirst : txtParser.flush();
  assertEquals(txt.length, 1);
  assertEquals(txt[0].type, "frame");
  if (txt[0].type === "frame") {
    assertEquals(txt[0].frame.serder.kind, "CESR");
    assertEquals(txt[0].frame.serder.ilk, "icp");
  }

  const qb2Parser = createParser();
  const qb2First = qb2Parser.feed(decodeB64(wrapped));
  const bny = qb2First.length > 0 ? qb2First : qb2Parser.flush();
  assertEquals(bny.length, 1);
  assertEquals(bny[0].type, "frame");
  if (txt[0].type === "frame" && bny[0].type === "frame") {
    assertEquals(bny[0].frame.serder.kind, "CESR");
    assertEquals(bny[0].frame.serder.ilk, txt[0].frame.serder.ilk);
    assertEquals(bny[0].frame.serder.said, txt[0].frame.serder.said);
    assertEquals(
      bny[0].frame.attachments.length,
      txt[0].frame.attachments.length,
    );
  }
});

Deno.test("native MapBodyGroup supports labels between primitives", () => {
  const base = KERIPY_NATIVE_V2_ICP_FIX_BODY;
  const payload = base.slice(4);
  const mapPayload = `VAAA${payload.slice(0, 12)}VAAA${payload.slice(12, 16)}VAAA${
    payload.slice(16)
  }`;
  const mapBody = `${makeCounterV2(CtrDexV2.MapBodyGroup, mapPayload.length / 4)}${mapPayload}`;

  const parser = createParser();
  const first = parser.feed(encode(mapBody));
  const emissions = first.length > 0 ? first : parser.flush();
  assertEquals(emissions.length, 1);
  assertEquals(emissions[0].type, "frame");
  if (emissions[0].type === "frame") {
    assertEquals(emissions[0].frame.serder.kind, "CESR");
    assertEquals(emissions[0].frame.serder.ilk, "icp");
    assertEquals(
      emissions[0].frame.serder.native?.bodyCode,
      CtrDexV2.MapBodyGroup,
    );
    const labels = emissions[0].frame.serder.native?.fields
      .filter((f) => f.label !== null).length ?? 0;
    assertEquals(labels > 0, true);
  }
});
