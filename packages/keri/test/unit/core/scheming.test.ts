// @file-test-lane core-fast-parallel

import { assertEquals, assertThrows } from "jsr:@std/assert";
import { Schemer } from "../../../src/core/scheming.ts";

function schemaSed(): Record<string, unknown> {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: {
      name: { type: "string" },
    },
  };
}

Deno.test("Schemer computes and verifies schema $id SAIDs", () => {
  const schemer = new Schemer({ sed: schemaSed() });
  assertEquals(typeof schemer.said, "string");
  assertEquals(schemer.sed.$id, schemer.said);

  const roundTrip = new Schemer({ raw: schemer.raw });
  assertEquals(roundTrip.said, schemer.said);
  assertEquals(roundTrip.sed.$id, schemer.said);
});

Deno.test("Schemer rejects schema $id SAID mismatches", () => {
  const schemer = new Schemer({ sed: schemaSed() });
  const mutated = {
    ...schemer.sed,
    $id: "EAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  };
  assertThrows(
    () => new Schemer({ raw: JSON.stringify(mutated) }),
    Error,
    "Invalid schema $id SAID",
  );
});

Deno.test("Schemer verifies payloads against the schema document", () => {
  const schemer = new Schemer({
    sed: {
      ...schemaSed(),
      required: ["name"],
    },
  });

  assertEquals(schemer.verify({ name: "holder" }), true);
  assertThrows(
    () => schemer.verify({ name: 123 }),
    Error,
    "Credential failed schema validation",
  );
});
