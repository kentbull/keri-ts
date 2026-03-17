import { assertEquals, assertThrows } from "jsr:@std/assert";
import { UnknownCodeError } from "../../../src/core/errors.ts";
import { parseCompactor } from "../../../src/primitives/compactor.ts";
import { CtrDexV2 } from "../../../src/tables/counter-codex.ts";
import { counterV2, token } from "../../fixtures/counter-token-fixtures.ts";
import { txt } from "../../fixtures/primitive-test-helpers.ts";

const V2 = { major: 2, minor: 0 } as const;

Deno.test("compactor: parses KERIpy map-body shape", () => {
  const payload = `0J_i${token("B")}0J_d${token("E")}`;
  const mapBody = `${
    counterV2(CtrDexV2.MapBodyGroup, payload.length / 4)
  }${payload}`;

  const compactor = parseCompactor(txt(mapBody), V2, "txt");
  assertEquals(compactor.code, CtrDexV2.MapBodyGroup);
  assertEquals(compactor.fields.length, 2);
});

Deno.test("compactor: rejects non-map aggregate groups", () => {
  const payload = "ABCDWXYZ";
  const listBody = `${
    counterV2(CtrDexV2.GenericListGroup, payload.length / 4)
  }${payload}`;

  assertThrows(
    () => parseCompactor(txt(listBody), V2, "txt"),
    UnknownCodeError,
  );
});
