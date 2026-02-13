import { assertEquals, assertThrows } from "jsr:@std/assert";
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
  ];

  for (const entry of cases) {
    const parsed = parseAttachmentDispatch(
      encode(entry.vector),
      { major: 1, minor: 0 },
      "txt",
    );
    assertEquals(parsed.consumed > 0, true);
    assertEquals(parsed.consumed <= entry.vector.length, true);
    assertEquals(parsed.group.code, entry.code);
    assertEquals(parsed.group.name, entry.name);
    assertEquals(parsed.group.items.length > 0, true);
  }
});

Deno.test("parside attachment-group fixture currently hits nested payload limitation", () => {
  assertThrows(
    () =>
      parseAttachmentDispatch(
        encode(PARSIDE_GROUP_VECTORS.attachmentGroup),
        { major: 1, minor: 0 },
        "txt",
      ),
  );
});

Deno.test("KERIpy native v2 fix-body fixture parses as top-level frame", () => {
  const parser = createParser();
  const emissions = parser.feed(encode(KERIPY_NATIVE_V2_ICP_FIX_BODY));
  assertEquals(emissions.length, 1);
  assertEquals(emissions[0].type, "frame");
  if (emissions[0].type === "frame") {
    const raw = new TextDecoder().decode(emissions[0].frame.serder.raw);
    assertEquals(raw, KERIPY_NATIVE_V2_ICP_FIX_BODY);
    assertEquals(emissions[0].frame.serder.kind, "CESR");
    assertEquals(emissions[0].frame.serder.pvrsn.major, 2);
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
  const emissions = parser.feed(decodeB64(wrapped));
  assertEquals(emissions.length, 1);
  assertEquals(emissions[0].type, "frame");
  if (emissions[0].type === "frame") {
    assertEquals(emissions[0].frame.serder.kind, "CESR");
    assertEquals(emissions[0].frame.attachments.length, 0);
  }
});
