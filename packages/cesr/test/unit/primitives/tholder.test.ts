import { assertEquals, assertThrows } from "jsr:@std/assert";
import { UnknownCodeError } from "../../../src/core/errors.ts";
import { Bexter } from "../../../src/primitives/bexter.ts";
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

Deno.test("tholder: nested multi-clause weighted thresholds consume slots left-to-right", () => {
  const sith = [[{ "1": ["1/2", "1/2"] }], ["1/2", "1/2"]];
  const tholder = new Tholder({ sith });
  const roundTrip = new Tholder({ qb64: tholder.qb64 });

  assertEquals(tholder.weighted, true);
  assertEquals(tholder.size, 4);
  assertEquals(tholder.sith, sith);
  assertEquals(roundTrip.sith, sith);
  assertEquals(tholder.satisfy([0, 1, 2, 3]), true);
  assertEquals(tholder.satisfy([3, 2, 1, 0]), true);
  assertEquals(tholder.satisfy([0, 1, 2]), false);
  assertEquals(tholder.satisfy([0, 1, 3]), false);
  assertEquals(tholder.satisfy([0, 2, 3]), false);
});

Deno.test("tholder: rejects weighted clauses whose sums do not reach one", () => {
  assertThrows(() => new Tholder({ sith: ["1/2"] }));
  assertThrows(() => new Tholder({ sith: [{ "1": ["1/2"] }] }));
});

Deno.test("tholder: bounds the complete weighted expression before fraction conversion", () => {
  // Frozen KERIpy 927c0cb8 counts outer group weights as well as signer leaves.
  const accepted = [
    Array(1_000).fill("1"),
    Array.from({ length: 1_000 }, () => ["1"]),
    [Array(500).fill("1"), Array(500).fill("1")],
    [{ "1": Array(999).fill("1") }],
  ];
  for (const sith of accepted) {
    const threshold = new Tholder({ sith });
    assertEquals(new Tholder({ qb2: threshold.qb2 }).sith, sith);
    assertEquals(new Tholder({ limen: threshold.limen }).sith, sith);
  }
  for (
    const sith of [
      Array(1_001).fill("1"),
      Array.from({ length: 1_001 }, () => ["1"]),
      [Array(500).fill("1"), Array(501).fill("1")],
      [{ "1": Array(1_000).fill("1") }],
      [Array(500).fill("not-a-fraction"), Array(501).fill("1")],
    ]
  ) {
    assertThrows(() => new Tholder({ sith }), Error, "exceeds limit 1000");
  }
  // Build wire directly: unlike Python927's limen bypass, our deployment cap
  // also holds without semantic construction, in both CESR representations.
  for (const bext of [Array(1_001).fill("1").join("c"), "1k" + Array(1_000).fill("1").join("v")]) {
    const wire = new Bexter({ code: "4A", raw: Bexter.rawify(bext) });
    assertThrows(() => new Tholder({ limen: wire.qb64 }), Error, "exceeds limit 1000");
    assertThrows(() => new Tholder({ qb2: wire.qb2 }), Error, "exceeds limit 1000");
  }
  // Numeric M-of-N thresholds do not allocate weighted terms and keep their domain.
  assertEquals(new Tholder({ sith: 1_001 }).num, 1_001n);
});

Deno.test("tholder: bounds JSON before decoding without discarding whitespace", () => {
  const boundary = "[\"1\"]".padEnd(65_536);
  assertEquals(new Tholder({ sith: boundary }).sith, ["1"]);
  assertThrows(() => new Tholder({ sith: boundary + " " }), Error, "JSON length exceeds limit 65536");
  // The budget trips before JSON.parse even for an unfinished nested array.
  assertThrows(() => new Tholder({ sith: "[".repeat(65_537) }), Error, "JSON length exceeds limit 65536");
});

Deno.test("tholder: deployment limits are tunable and validated", () => {
  const { maxWeights, maxSithLength } = Tholder;
  try {
    // Raising both caps admits larger legitimate deployments without a wire change.
    Tholder.maxWeights = 1_001;
    Tholder.maxSithLength = 65_537;
    const larger = new Tholder({ sith: Array(1_001).fill("1") });
    assertEquals(larger.size, 1_001);
    assertEquals(new Tholder({ limen: larger.limen }).size, 1_001);
    assertEquals(new Tholder({ sith: "[\"1\"]".padEnd(65_537) }).size, 1);
    for (const invalid of [0, -1, 1.5, NaN, Infinity]) {
      Tholder.maxWeights = invalid;
      assertThrows(() => new Tholder(1), Error, "positive safe integers");
      Tholder.maxWeights = maxWeights;
      Tholder.maxSithLength = invalid;
      assertThrows(() => new Tholder(1), Error, "positive safe integers");
      Tholder.maxSithLength = maxSithLength;
    }
  } finally {
    // Process-wide deployment configuration must not escape this isolated test.
    Tholder.maxWeights = maxWeights;
    Tholder.maxSithLength = maxSithLength;
  }
});
