/**
 * Schemas are pinned and validated without generating code: a page under a strict Content-Security-Policy
 * (`script-src 'self'`, no `'unsafe-eval'`) refuses `new Function` and `eval`, which Ajv needs.
 */
import type { MapperMap } from "cesr-ts";
import { assert, assertEquals, assertThrows } from "jsr:@std/assert";
import { acdcmap } from "../../../src/acdc/messaging.ts";
import { validateSchema } from "../../../src/acdc/scheming.ts";
import { ValidationError } from "../../../src/core/errors.ts";
import { Schemer } from "../../../src/core/scheming.ts";
import type { Baser } from "../../../src/db/basing.ts";

/** Run `body` with `Function` and `eval` throwing the `EvalError` a strict CSP raises. */
function withoutCodeGeneration<T>(body: () => T): T {
  const realFunction = globalThis.Function, realEval = globalThis.eval;
  // A constructible function, so `new Function(...)` reaches the throw rather than failing as "not a constructor".
  const refuse = function() {
    throw new EvalError("Code generation from strings disallowed for this context");
  };
  globalThis.Function = refuse as unknown as FunctionConstructor;
  globalThis.eval = refuse;
  try {
    return body();
  } finally {
    globalThis.Function = realFunction;
    globalThis.eval = realEval;
  }
}

/** A schema using the keywords vLEI-style schemas rely on: `$ref`, `$defs`, `oneOf`, `const`, `pattern`, `unevaluatedProperties`. */
function schemaSed(): Record<string, unknown> {
  return {
    $id: "",
    $schema: "https://json-schema.org/draft/2020-12/schema",
    version: "1.0.0",
    type: "object",
    properties: {
      a: {
        type: "object",
        required: ["name"],
        properties: {
          name: { $ref: "#/$defs/name" },
          kind: { const: "person" },
          code: { type: "string", pattern: "^[A-Z]{2}$" },
        },
        unevaluatedProperties: false,
      },
    },
    $defs: { name: { oneOf: [{ type: "string", minLength: 1 }, { type: "null" }] } },
  };
}

Deno.test("a schema is pinned, and a credential validated against it, with code generation disabled", () => {
  withoutCodeGeneration(() => {
    assertThrows(() => new Function("return 1"), EvalError);
    const schemer = new Schemer({ sed: schemaSed() });
    assertEquals(new Schemer({ raw: schemer.raw }).said, schemer.said);
    assertEquals(schemer.verify({ a: { name: "Ada", kind: "person", code: "AB" } }), true);
    for (const bad of [{ a: { name: 7 } }, { a: { name: "Ada", code: "ab" } }, { a: { name: "Ada", extra: 1 } }]) {
      assertThrows(() => schemer.verify(bad), ValidationError, "Credential failed schema validation");
    }

    const held = new Map([[schemer.said, schemer]]);
    const db = { schema: { get: (said: string) => held.get(said) ?? null } } as Baser;
    const holder = "EJt3vzyzwZsSlL-LRyjG3lsJta_gxHjTmdbSYp6foOcx";
    const credential = (name: string | number) => acdcmap(holder, { schema: schemer.said, attribute: { d: "", name } });
    assertEquals(validateSchema(credential("Ada"), db), { kind: "valid" });
    const bad = validateSchema(credential(7), db);
    assert(bad.kind === "invalid" && bad.subject === "credential", "the credential is refused, not an engine error");
    const embedded = acdcmap(holder, { schema: schemer.sed as MapperMap, attribute: { d: "", name: "Ada" } });
    assertEquals(validateSchema(embedded, db), { kind: "valid" });
  });
});

Deno.test("an invalid schema document is refused with the reason as the cause", () => {
  const error = assertThrows(
    () => new Schemer({ sed: { $schema: "https://json-schema.org/draft/2020-12/schema", type: "nonsense" } }),
    ValidationError,
    "Invalid JSON Schema document.",
  );
  assert(error.cause instanceof Error && error.cause.message.includes("meta-schema"), String(error.cause));
});
