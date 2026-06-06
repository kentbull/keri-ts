import { assertEquals, assertThrows } from "jsr:@std/assert";
import { UnknownCodeError } from "../../../src/core/errors.ts";
import { parseTholder, Tholder } from "../../../src/primitives/tholder.ts";
import { KERIPY_MATTER_VECTORS } from "../../fixtures/keripy-primitive-vectors.ts";
import { assertTxtBnyQb64Parity, txt } from "../../fixtures/primitive-test-helpers.ts";

Deno.test("tholder: parses KERIpy numeric threshold vector", () => {
  const tholder = parseTholder(txt(KERIPY_MATTER_VECTORS.numberShort), "txt");
  assertEquals(tholder.qb64, KERIPY_MATTER_VECTORS.numberShort);
  assertEquals(typeof tholder.sith, "string");
  assertEquals(tholder.weighted, false);
  assertEquals(tholder.num !== null, true);
});

Deno.test("tholder: txt/qb2 parity", () => {
  const { txtValue, bnyValue } = assertTxtBnyQb64Parity(
    KERIPY_MATTER_VECTORS.numberShort,
    parseTholder,
  );
  assertEquals(txtValue.sith, bnyValue.sith);
});

Deno.test("tholder: rejects non-threshold code families", () => {
  assertThrows(
    () => parseTholder(txt(KERIPY_MATTER_VECTORS.verferEcdsaR1), "txt"),
    UnknownCodeError,
  );
});

Deno.test("tholder: hydrates flat weighted thresholds and satisfies them exactly", () => {
  const tholder = new Tholder({ sith: ["1/2", "1/2"] });
  const roundTrip = new Tholder({ qb64: tholder.qb64 });

  assertEquals(tholder.weighted, true);
  assertEquals(tholder.size, 2);
  assertEquals(tholder.sith, ["1/2", "1/2"]);
  assertEquals(tholder.limen, tholder.qb64);
  assertEquals(roundTrip.sith, ["1/2", "1/2"]);
  assertEquals(tholder.satisfy([0]), false);
  assertEquals(tholder.satisfy([0, 1]), true);
});

Deno.test("tholder: hydrates nested weighted thresholds and satisfies nested groups", () => {
  const sith = [{ "1": ["1/2", "1/2"] }];
  const tholder = new Tholder({ sith });
  const roundTrip = new Tholder({ qb64: tholder.qb64 });

  assertEquals(tholder.weighted, true);
  assertEquals(tholder.size, 2);
  assertEquals(tholder.sith, sith);
  assertEquals(roundTrip.sith, sith);
  assertEquals(tholder.satisfy([0]), false);
  assertEquals(tholder.satisfy([1]), false);
  assertEquals(tholder.satisfy([0, 1]), true);
});

Deno.test("tholder: rejects weighted clauses whose sums do not reach one", () => {
  assertThrows(() => new Tholder({ sith: ["1/2"] }));
  assertThrows(() => new Tholder({ sith: [{ "1": ["1/2"] }] }));
});
