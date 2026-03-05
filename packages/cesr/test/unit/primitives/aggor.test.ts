import { assertEquals, assertThrows } from "jsr:@std/assert";
import { codeB64ToB2 } from "../../../src/core/bytes.ts";
import { UnknownCodeError } from "../../../src/core/errors.ts";
import { Aggor, parseAggor } from "../../../src/primitives/aggor.ts";
import { CtrDexV2 } from "../../../src/tables/counter-codex.ts";
import { counterV2, token } from "../../fixtures/counter-token-fixtures.ts";
import { KERIPY_STRUCTOR_VECTORS } from "../../fixtures/keripy-primitive-vectors.ts";
import { txt } from "../../fixtures/primitive-test-helpers.ts";

const V2 = { major: 2, minor: 0 } as const;

Deno.test("aggor: parses list aggregate groups", () => {
  const payload = "ABCDWXYZ";
  const listBody = `${
    counterV2(CtrDexV2.GenericListGroup, payload.length / 4)
  }${payload}`;

  const aggor = parseAggor(txt(listBody), V2, "txt");
  assertEquals(aggor instanceof Aggor, true);
  assertEquals(aggor.kind, "list");
  assertEquals((aggor.listItems?.length ?? 0) > 0, true);
  assertEquals(aggor.qb64g, listBody);
});

Deno.test("aggor: parses KERIpy empty-list aggregate vector", () => {
  const aggor = parseAggor(
    txt(KERIPY_STRUCTOR_VECTORS.aggorEmptyList),
    V2,
    "txt",
  );
  assertEquals(aggor instanceof Aggor, true);
  assertEquals(aggor.kind, "list");
  assertEquals(aggor.count, 0);
  assertEquals(aggor.items.length, 0);
});

Deno.test("aggor: parses map aggregate groups", () => {
  const payload = `0J_i${token("B")}`;
  const mapBody = `${
    counterV2(CtrDexV2.MapBodyGroup, payload.length / 4)
  }${payload}`;

  const aggor = parseAggor(txt(mapBody), V2, "txt");
  assertEquals(aggor instanceof Aggor, true);
  assertEquals(aggor.kind, "map");
  assertEquals((aggor.mapFields?.length ?? 0) > 0, true);
});

Deno.test("aggor: qb2 parsing keeps KERIpy-derived payload stable", () => {
  const payload = KERIPY_STRUCTOR_VECTORS.mediarTypedMediaPayload;
  const listBody = `${
    counterV2(CtrDexV2.GenericListGroup, payload.length / 4)
  }${payload}`;
  const qb2 = codeB64ToB2(listBody);

  const aggor = parseAggor(qb2, V2, "bny");
  assertEquals(aggor.kind, "list");
  assertEquals(aggor.qb64g, listBody);
  assertEquals(aggor.qb2g, qb2);
});

Deno.test("aggor: rejects non-aggregate counter groups", () => {
  const bad = counterV2(CtrDexV2.ControllerIdxSigs, 1);
  assertThrows(
    () => parseAggor(txt(bad), V2, "txt"),
    UnknownCodeError,
  );
});
