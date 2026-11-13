/**
 * JSON Schema validation that generates no code.
 *
 * Ajv compiles each schema to JavaScript with `new Function`, which a page under a strict Content-Security-Policy
 * (`script-src 'self'`, no `'unsafe-eval'`) refuses, so no schema could be pinned or validated there. This module
 * interprets schemas with `@cfworker/json-schema` instead, in every environment: one path, not a browser fallback.
 *
 * It matches the behaviour KERIpy and the Ajv setup it replaces had, not the validator's defaults:
 * - `format` never rejects (neither KERIpy's validator nor Ajv without a format checker has one), so `format` is
 *   removed from a schema before it is prepared;
 * - a schema document is checked against its dialect's meta-schema, and every `pattern` and `patternProperties` key
 *   must be a regular expression the engine accepts, since a bad one would otherwise surface at validation time;
 * - unknown keywords are annotations, except `$dynamicRef`, which the engine cannot interpret and so refuses.
 */
import { Validator } from "npm:@cfworker/json-schema@4.1.6";
import { ValidationError } from "./errors.ts";
import { META_2020_12, META_DRAFT_07 } from "./json-schema-meta.ts";

/** A schema document or subschema. */
export type JsonSchema = Record<string, unknown>;
/** The dialects the engine interprets: 2020-12, and draft-07 for schemas that name no 2020-12 `$schema`. */
export type SchemaDialect = "2020-12" | "7";

/** A schema (or closure of schemas) ready to validate data; building it was the expensive step. */
export interface PreparedSchema {
  /** Validate `data`; `errors` is empty when valid and one readable line per failure otherwise. */
  validate(data: unknown): { valid: boolean; errors: string };
}

const ROOT_2020_12 = "https://json-schema.org/draft/2020-12/schema";
/** Keyword positions that hold a subschema, a map of subschemas, or a list of them (the rest is data). */
const SINGLES = [
  "items",
  "contains",
  "additionalProperties",
  "unevaluatedProperties",
  "propertyNames",
  "not",
  "if",
  "then",
  "else",
  "contentSchema",
  "unevaluatedItems",
  "additionalItems",
];
const MAPS = ["$defs", "definitions", "properties", "patternProperties", "dependentSchemas", "dependencies"];
const LISTS = ["prefixItems", "allOf", "anyOf", "oneOf", "items"];

function object(value: unknown): value is JsonSchema {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Visit every subschema of `schema` (itself included), by keyword position, never entering data keywords. */
function visit(schema: unknown, each: (schema: JsonSchema) => void): void {
  if (!object(schema)) return;
  each(schema);
  for (const key of SINGLES) visit(schema[key], each);
  for (const key of MAPS) {
    const map = schema[key];
    if (object(map)) for (const value of Object.values(map)) visit(value, each);
  }
  for (const key of LISTS) {
    const list = schema[key];
    if (Array.isArray(list)) for (const value of list) visit(value, each);
  }
}

/** A deep copy of `schema` with every `format` keyword removed; a property named `format` is data and stays. */
export function withoutFormats(schema: JsonSchema): JsonSchema {
  const copy = structuredClone(schema);
  visit(copy, (each) => {
    if (typeof each.format === "string") delete each.format;
  });
  return copy;
}

/** Throw the `SyntaxError` of the first `pattern` or `patternProperties` key that is not a valid regular expression. */
function assertRegularExpressions(schema: JsonSchema): void {
  visit(schema, (each) => {
    if (typeof each.pattern === "string") new RegExp(each.pattern, "u");
    if (object(each.patternProperties)) {
      for (const pattern of Object.keys(each.patternProperties)) new RegExp(pattern, "u");
    }
  });
}

const meta: { "2020-12"?: Validator; "7"?: Validator } = {};
/** The meta-schema validator of a dialect, built once. */
function metaValidator(dialect: SchemaDialect): Validator {
  const known = meta[dialect];
  if (known) return known;
  let built: Validator;
  if (dialect === "7") built = new Validator(META_DRAFT_07, "7", false);
  else {
    built = new Validator(META_2020_12[0], "2020-12", false);
    for (const vocabulary of META_2020_12.slice(1)) built.addSchema(vocabulary);
  }
  return meta[dialect] = built;
}

/** The dialect a schema document selects through `$schema`. */
export function dialectOf(schema: JsonSchema): SchemaDialect {
  return typeof schema.$schema === "string" && schema.$schema.includes("2020-12") ? "2020-12" : "7";
}

/**
 * Throw unless `schema` is a valid schema document of `dialect`, that is valid against the dialect's meta-schema. The
 * error says what failed. A regular expression the engine would refuse is not checked here: it surfaces when the
 * schema is prepared, as it did with Ajv.
 */
export function checkSchemaDocument(schema: unknown, dialect: SchemaDialect): void {
  if (!object(schema) && typeof schema !== "boolean") {
    throw new Error("A schema document must be an object or a boolean");
  }
  // Ajv resolves a document's own `$schema` and refuses one whose meta-schema it does not know.
  const named = object(schema) && typeof schema.$schema === "string" ? schema.$schema.replace(/#$/, "") : undefined;
  const known = dialect === "2020-12" ? ROOT_2020_12 : "http://json-schema.org/draft-07/schema";
  if (named !== undefined && named !== known) {
    throw new Error(`No meta-schema ${named} for a ${dialect} schema document`);
  }
  const result = metaValidator(dialect).validate(schema);
  if (!result.valid) {
    throw new Error(`Schema does not conform to the ${dialect} meta-schema: ${describe(result.errors)}`);
  }
}

/** Readable line per failed keyword, such as `data/credential/a: must be a string`. */
function describe(errors: ReadonlyArray<{ instanceLocation: string; error: string }>): string {
  return errors.map(({ instanceLocation, error }) => `data${instanceLocation.replace(/^#/, "")}: ${error}`).join("; ");
}

/**
 * Prepare `schemas` for validation against `schemas[0]`: the first is the root, the rest are resources its `$ref`s
 * may reach by `$id`. Formats are ignored. A regular expression the engine does not accept throws its `SyntaxError`,
 * here, not at validation time.
 */
export function prepareSchemas(schemas: readonly JsonSchema[], dialect: SchemaDialect): PreparedSchema {
  const [root, ...rest] = schemas.map(withoutFormats);
  for (const schema of [root, ...rest]) {
    assertRegularExpressions(schema);
    // The engine ignores `$dynamicRef`, which would silently weaken validation: refuse it instead.
    visit(schema, (each) => {
      if ("$dynamicRef" in each) throw new ValidationError("A schema using $dynamicRef cannot be validated here");
    });
  }
  const validator = new Validator(root, dialect, true);
  for (const schema of rest) validator.addSchema(schema);
  return {
    validate(data) {
      const result = validator.validate(data);
      return { valid: result.valid, errors: result.valid ? "" : describe(result.errors) };
    },
  };
}
