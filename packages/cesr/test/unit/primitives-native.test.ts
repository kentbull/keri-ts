import { assertEquals } from "jsr:@std/assert";
import { parseAggor } from "../../src/primitives/aggor.ts";
import { parseIlker } from "../../src/primitives/ilker.ts";
import { parseLabeler } from "../../src/primitives/labeler.ts";
import { parseMapperBody } from "../../src/primitives/mapper.ts";
import { parseVerser } from "../../src/primitives/verser.ts";
import { CtrDexV2 } from "../../src/tables/counter-codex.ts";
import { counterV2, token } from "../fixtures/counter-token-fixtures.ts";
import { KERIPY_NATIVE_V2_ICP_FIX_BODY } from "../fixtures/external-vectors.ts";
import { txt } from "../fixtures/primitive-test-helpers.ts";

const V2 = { major: 2, minor: 0 } as const;

Deno.test("native primitive smoke: verser/ilker/labeler", () => {
  const verser = parseVerser(txt("YKERICAA"), "txt");
  const ilker = parseIlker(txt("Xicp"), "txt");
  const labeler = parseLabeler(txt("0J_i"), "txt");

  assertEquals(verser.proto, "KERI");
  assertEquals(ilker.ilk, "icp");
  assertEquals(labeler.label, "i");
});

Deno.test("native primitive smoke: mapper over KERIpy v2 body", () => {
  const payload = KERIPY_NATIVE_V2_ICP_FIX_BODY.slice(4);
  const mapPayload = `0J_i${payload.slice(0, 12)}0J_s${payload.slice(12, 16)}0J_d${
    payload.slice(16)
  }`;
  const mapBody = `${counterV2(CtrDexV2.MapBodyGroup, mapPayload.length / 4)}${mapPayload}`;

  const mapper = parseMapperBody(txt(mapBody), V2, "txt");
  assertEquals(mapper.fields.length > 0, true);
});

Deno.test("native primitive smoke: aggor list", () => {
  const payload = `${token("B")}${token("E")}`;
  const listBody = `${counterV2(CtrDexV2.GenericListGroup, payload.length / 4)}${payload}`;
  const aggor = parseAggor(txt(listBody), V2, "txt");

  assertEquals(aggor.kind, "list");
  assertEquals((aggor.listItems?.length ?? 0) > 0, true);
});
