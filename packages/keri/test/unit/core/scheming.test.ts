import { Diger, dumps, type MapperMap } from "cesr-ts";
import { assertEquals, assertThrows } from "jsr:@std/assert";
import { acdcmap } from "../../../src/acdc/messaging.ts";
import { validateSchema } from "../../../src/acdc/scheming.ts";
import { Schemer } from "../../../src/core/scheming.ts";
import type { Baser } from "../../../src/db/basing.ts";

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

Deno.test("v2 schema validation applies the 71438328 profile and only local static resources", () => {
  const cache = new Map<string, Schemer>(),
    db = { schema: { get: (said: string) => cache.get(said) ?? null } } as Baser;
  const issuer = "EJt3vzyzwZsSlL-LRyjG3lsJta_gxHjTmdbSYp6foOcx";
  const make = (attribute: Record<string, unknown>, extra = {}) =>
    new Schemer({
      sed: {
        $id: "",
        $schema: "https://json-schema.org/draft/2020-12/schema",
        version: "1.0.0",
        type: "object",
        properties: { a: attribute },
        ...extra,
      },
      verify: false,
    });
  const credential = (schema: Record<string, unknown> | string, name: string | number | null = "Ada") =>
    acdcmap(issuer, { schema: schema as MapperMap | string, attribute: { d: "", name } });
  const expect = (schema: Schemer, kind: string, name: string | number | null = "Ada") =>
    assertEquals(validateSchema(credential(schema.sed, name), db).kind, kind);
  const simple = make({
    type: "object",
    required: ["name"],
    properties: { name: { type: "string", pattern: "^[A-Z]" } },
  });
  expect(make({ properties: { name: { pattern: "[" } } }), "invalid");
  expect(simple, "valid");
  expect(simple, "invalid", 7);
  assertEquals(validateSchema(credential(simple.said), db), { kind: "missing", said: simple.said });
  cache.set(simple.said, simple);
  assertEquals(validateSchema(credential(simple.said), db), { kind: "valid" });
  for (const kind of ["JSON", "CBOR", "MGPK", "CESR"] as const) {
    const native = acdcmap(issuer, { kind, schema: simple.said, attribute: { d: "", name: "Ada" } });
    assertEquals(
      validateSchema(native, db),
      { kind: "valid" },
      "JSON schema validates decoded data independently of body kind",
    );
  }
  expect(make({ properties: { name: { type: "string", nullable: true } } }), "invalid", null);
  expect(make({ properties: { name: { type: "string" } } }, { $async: true }), "invalid", 7);
  assertEquals(validateSchema(credential(simple.said), db, { ...simple.sed, type: "array" }).kind, "invalid");
  const unchanged = new TextDecoder().decode(simple.raw);
  for (
    const extra of [{ version: null }, { version: "1.0.0-alpha" }, { version: "1.0.0+build" }, {
      $schema: "http://json-schema.org/draft-07/schema#",
    }]
  ) expect(make({}, extra), "invalid");
  for (const key of ["$dynamicRef", "$dynamicAnchor", "$recursiveRef", "$recursiveAnchor"]) {
    expect(make({ [key]: "#a" }), "invalid");
  }
  const external = make({ properties: { name: { type: "string" } } });
  for (
    const form of [
      external.said,
      `sad:${external.said}`,
      `did:keri:${external.said}`,
      `https://schemas.example/oobi/${external.said}`,
    ]
  ) {
    const root = make({ $ref: form + "#/properties/a" });
    assertEquals(validateSchema(credential(root.sed), db), { kind: "missing", said: external.said });
    cache.set(external.said, external);
    expect(root, "valid");
    expect(root, "invalid", 7);
    cache.delete(external.said);
  }
  for (
    const ref of [
      "https://schemas.example/current.json",
      "file:///tmp/schema",
      "relative.json",
      "sad:bad",
      "did:keri:bad",
      "#/missing",
      "#/notASchema",
    ]
  ) expect(make({ $ref: ref }, { notASchema: 5 }), "invalid");
  expect(
    make({ $ref: "#/$defs/attribute" }, { $defs: { attribute: { properties: { name: { type: "string" } } } } }),
    "valid",
  );
  expect(make({ $ref: "#allowed" }, { $defs: { attribute: { $anchor: "allowed", type: "object" } } }), "valid");
  const ambiguous = { left: { $anchor: "duplicate", type: "object" }, right: { $anchor: "duplicate", type: "string" } };
  expect(make({ $ref: "#duplicate" }, { $defs: ambiguous }), "invalid");
  expect(make({ $ref: "#/allowed" }, { allowed: true }), "valid");
  const bundled: Record<string, unknown> = {
    $id: "did:keri:" + "#".repeat(44),
    version: "1.0.0",
    type: "object",
    properties: { name: { type: "string" } },
  };
  bundled.$id = "did:keri:" + new Diger({ raw: Diger.digest(dumps(bundled, "JSON"), "E"), code: "E" }).qb64;
  const root = make({ $ref: bundled.$id }, { $defs: { attribute: bundled } });
  // The 71438328 override/cache oracle and corrected TS embedded construction remain separately qualified.
  assertEquals(validateSchema(credential(root.said), db, root.sed), { kind: "valid" });
  cache.set(root.said, root);
  assertEquals(validateSchema(credential(root.said), db), { kind: "valid" });
  assertEquals(validateSchema(credential(root.said, 7), db).kind, "invalid");
  for (const kind of ["JSON", "CBOR", "MGPK", "CESR"] as const) {
    const embedded = acdcmap(issuer, { kind, schema: root.sed as MapperMap, attribute: { d: "", name: "Ada" } });
    assertEquals(embedded.schema, root.sed);
    assertEquals(validateSchema(embedded, db), { kind: "valid" });
  }
  const changed = make({ $ref: bundled.$id }, { $defs: { attribute: { ...bundled, type: "string" } } });
  assertEquals(validateSchema(credential(root.said), db, changed.sed).kind, "invalid");
  const rebound = credential(changed.sed);
  assertEquals(
    rebound.verify(),
    true,
    "Serder verifies the new root content commitment, not bundled-resource validity",
  );
  assertEquals(validateSchema(rebound, db).kind, "invalid", "re-said root cannot authenticate the stale bundle ID");
  cache.set(external.said, simple);
  expect(make({ $ref: external.said }), "invalid");
  assertEquals(new TextDecoder().decode(simple.raw), unchanged, "validation never changes cache or borrowed schemas");
  const failed = {
    schema: {
      get() {
        throw new Error("schema database unavailable");
      },
    },
  } as unknown as Baser;
  assertThrows(() => validateSchema(credential(simple.said), failed), Error, "database unavailable");
  expect(make({}, { annotation: "x".repeat(8 * 1024 ** 2) }), "valid");
  expect(make({}, { annotation: Array.from({ length: 5000 }, (_, i) => i) }), "valid");
  const deep: Record<string, unknown> = {};
  let next = deep;
  for (let i = 0; i < 70; i++) next = next.child = {} as Record<string, unknown>;
  expect(make({}, { annotation: deep }), "valid");
  const definitions = Object.fromEntries(Array.from({ length: 129 }, (_, i) => [
    `item${i}`,
    make({}, { title: `Resource ${i}` }).sed,
  ]));
  expect(make({}, { $defs: definitions }), "valid");
});
