import { assertEquals, assertThrows } from "jsr:@std/assert";
import { UnknownCodeError } from "../../../src/core/errors.ts";
import { parseAggor } from "../../../src/primitives/aggor.ts";
import { CtrDexV2 } from "../../../src/tables/counter-codex.ts";
import { counterV2, token } from "../../fixtures/counter-token-fixtures.ts";
import { txt } from "../../fixtures/primitive-test-helpers.ts";

const V2 = { major: 2, minor: 0 } as const;

Deno.test("aggor: parses list aggregate groups", () => {
  const payload = "ABCDWXYZ";
  const listBody = `${counterV2(CtrDexV2.GenericListGroup, payload.length / 4)}${payload}`;

  const aggor = parseAggor(txt(listBody), V2, "txt");
  assertEquals(aggor.kind, "list");
  assertEquals((aggor.listItems?.length ?? 0) > 0, true);
});

Deno.test("aggor: parses map aggregate groups", () => {
  const payload = `0J_i${token("B")}`;
  const mapBody = `${counterV2(CtrDexV2.MapBodyGroup, payload.length / 4)}${payload}`;

  const aggor = parseAggor(txt(mapBody), V2, "txt");
  assertEquals(aggor.kind, "map");
  assertEquals((aggor.mapFields?.length ?? 0) > 0, true);
});

Deno.test("aggor: rejects non-aggregate counter groups", () => {
  const bad = counterV2(CtrDexV2.ControllerIdxSigs, 1);
  assertThrows(
    () => parseAggor(txt(bad), V2, "txt"),
    UnknownCodeError,
  );
});
