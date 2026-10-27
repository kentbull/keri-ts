/** Authenticated local schemas and selected bounded v2 disclosure closure; no network resolution. */
import { Diger, dumps, makePather, ParserError, type SerderACDC } from "cesr-ts";
import Ajv2020 from "npm:ajv@8.18.0/dist/2020.js";
import { ValidationError } from "../core/errors.ts";
import { Schemer } from "../core/scheming.ts";
import type { Baser } from "../db/basing.ts";

/** Normal schema dependencies/invalid content stay distinct from infrastructure failures. */
export type SchemaValidation = { kind: "valid" } | { kind: "missing"; said: string } | {
  kind: "invalid";
  subject: "schema" | "credential";
  reason: string;
};
/** Local issuance caller must supply this dependency before a disclosure can be derived. */
export class MissingSchemaError extends ValidationError {
  constructor(readonly schema: string) {
    super(`Missing ACDC schema: ${schema}`);
  }
}
/** Invalid schema or credential content cannot be staged as an issuance commitment. */
export class FailedSchemaValidationError extends ValidationError {}
/** Only explicit input/profile refusals are caught; arbitrary failures are not recategorized. */
class InvalidSchema extends Error {}
type Schema = Record<string, unknown>;
/** One verified resource owns its reference/anchor scope. */
interface Resource {
  said: string;
  schema: Schema;
  anchors: Map<string, Schema | boolean>;
}
/** Keep Deno's CommonJS constructor adaptation local, matching the existing Schemer adapter. */
type Validator = {
  validateSchema(schema: unknown): boolean;
  addSchema(schema: unknown): void;
  getSchema(key: string): (((data: unknown) => boolean) & { errors?: unknown }) | undefined;
  errorsText(errors?: unknown): string;
};
const ValidatorCtor = Ajv2020 as unknown as new(options: { strict: boolean; validateFormats: boolean }) => Validator;
const dialect = "https://json-schema.org/draft/2020-12/schema";
const dynamic = ["$dynamicAnchor", "$dynamicRef", "$recursiveAnchor", "$recursiveRef"];
const singles = [
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
];
const maps = ["$defs", "properties", "patternProperties", "dependentSchemas"];
const arrays = ["prefixItems", "allOf", "anyOf", "oneOf"];
/** Plain maps and booleans are the only JSON Schema resource/fragment targets. */
function object(value: unknown): value is Schema {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
/** Parse a complete digest without accepting a CESR prefix followed by unrelated text. */
function digest(value: string): Diger {
  try {
    const diger = new Diger({ qb64: value });
    if (diger.qb64 === value) return diger;
  } catch (error) {
    if (!(error instanceof ParserError)) throw error;
  }
  throw new InvalidSchema("Schema reference must contain a complete SAID");
}
/** Accept only static internal, bare, sad, DID and exact /oobi/SAID references. */
function reference(value: unknown): { said: string | null; fragment: string } {
  if (typeof value !== "string" || !value) throw new InvalidSchema("Empty schema reference");
  const at = value.indexOf("#"), base = at < 0 ? value : value.slice(0, at), fragment = at < 0 ? "" : value.slice(at);
  if (!base) return { said: null, fragment };
  let said = base;
  if (base.startsWith("sad:")) said = base.slice(4);
  else if (base.startsWith("did:")) {
    const tokens = base.split(/[:/;?&=]/).filter((token) => {
      try {
        digest(token);
        return true;
      } catch (error) {
        if (error instanceof InvalidSchema) return false;
        throw error;
      }
    });
    if (tokens.length !== 1) throw new InvalidSchema("DID schema reference must contain one SAID");
    said = tokens[0];
  } else if (/^https?:/i.test(base)) {
    if (!/^https?:\/\//i.test(base)) throw new InvalidSchema("Invalid schema OOBI URL");
    let url: URL;
    try {
      url = new URL(base);
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      throw new InvalidSchema("Invalid schema OOBI URL");
    }
    const parts = url.pathname.split("/").filter(Boolean);
    if (!url.host || parts.length !== 2 || parts[0].toLowerCase() !== "oobi") {
      throw new InvalidSchema("Schema OOBI must be /oobi/SAID");
    }
    said = parts[1];
  }
  digest(said);
  return { said, fragment };
}
/** Verify original root/bundled IDs before any private compilation normalization. */
function identity(schema: Schema, root: boolean): string {
  const id = schema.$id;
  if (typeof id !== "string" || id.includes("#")) throw new InvalidSchema("Invalid schema $id");
  const said = reference(id).said;
  if (!said || (root && id !== said) || id.split(said).length !== 2) throw new InvalidSchema("Invalid schema $id SAID");
  const diger = digest(said), raw = dumps({ ...schema, $id: id.replace(said, "#".repeat(said.length)) }, "JSON");
  if (!diger.verify(raw)) throw new InvalidSchema("Schema content does not match its SAID");
  if (typeof schema.version !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(schema.version)) {
    throw new InvalidSchema("Schema requires plain major.minor.patch version");
  }
  return said;
}
/** Walk the actual Draft 2020-12 schema locations, leaving annotation data uninterpreted. */
function children(schema: Schema): (Schema | boolean)[] {
  const values: unknown[] = singles.filter((key) => key in schema).map((key) => schema[key]);
  for (const key of maps) if (object(schema[key])) values.push(...Object.values(schema[key]));
  for (const key of arrays) if (Array.isArray(schema[key])) values.push(...schema[key]);
  if (values.some((value) => !object(value) && typeof value !== "boolean")) {
    throw new InvalidSchema("Invalid schema subschema");
  }
  return values as (Schema | boolean)[];
}
/** Confirm every fragment resolves to a schema; no external URI is dereferenced. */
function fragment(resource: Resource, value: string): Schema | boolean {
  let path: string;
  try {
    path = decodeURIComponent(value.slice(1));
  } catch (error) {
    if (!(error instanceof URIError)) throw error;
    throw new InvalidSchema("Invalid schema fragment");
  }
  let target: unknown = resource.schema;
  if (path && !path.startsWith("/")) target = resource.anchors.get(path);
  else if (path) {
    for (const key of path.slice(1).split("/")) {
      const member = key.replace(/~1/g, "/").replace(/~0/g, "~");
      target = target && typeof target === "object" && Object.hasOwn(target, member)
        ? (target as Schema)[member]
        : undefined;
    }
  }
  if (!object(target) && typeof target !== "boolean") {
    throw new InvalidSchema("Schema fragment does not resolve to a schema");
  }
  return target;
}
/** Authenticate one local static resource graph, shared by validation and disclosure closure. */
class SchemaResources {
  private readonly resources = new Map<string, Resource>();
  readonly roots: Schema[] = [];
  readonly scopes = new Map<Schema, Resource>();
  private readonly refs: { node: Schema; resource: Resource; value: unknown }[] = [];
  private readonly work: { schema: Schema | boolean; resource: Resource }[] = [];
  missing: string | null = null;

  constructor(private readonly db: Baser) {}

  /** Cache reads remain outside input-validation catches and retain their infrastructure failures. */
  private load(said: string): Resource | null {
    const existing = this.resources.get(said);
    if (existing) return existing;
    const cached = this.db.schema.get(said);
    if (!cached) {
      this.missing = said;
      return null;
    }
    if (!(cached instanceof Schemer) || cached.kind !== "JSON") {
      throw new InvalidSchema("Unsupported non-JSON schema encoding");
    }
    return this.add(cached.sed, true, said);
  }
  /** Verify each original resource before cloning it for compilation. */
  private add(schema: Schema, root: boolean, expected?: string): Resource {
    const said = identity(schema, root);
    if (expected && said !== expected) throw new InvalidSchema("Cached schema does not match its lookup SAID");
    const existing = this.resources.get(said);
    if (existing) return existing;
    const resource = { said, schema, anchors: new Map<string, Schema | boolean>() };
    this.resources.set(said, resource);
    if (root) this.roots.push(schema);
    this.work.push({ schema, resource });
    return resource;
  }

  /** Discover all original resources and static references before any private schema use. */
  admit(source: unknown): Resource | null {
    const root = object(source)
      ? this.add(source, true)
      : typeof source === "string"
      ? this.load(digest(source).qb64)
      : null;
    if (!root) return null;
    for (;;) {
      while (this.work.length) {
        const item = this.work.pop()!;
        if (typeof item.schema === "boolean" || this.scopes.has(item.schema)) continue;
        const node = item.schema;
        let owner = item.resource;
        if (node !== owner.schema && "$id" in node) owner = this.add(node, false);
        this.scopes.set(node, owner);
        if (dynamic.some((key) => key in node)) throw new InvalidSchema("Dynamic schema references are prohibited");
        if ("$schema" in node && node.$schema !== dialect) throw new InvalidSchema("Schema must use Draft 2020-12");
        if (typeof node.$anchor === "string") owner.anchors.set(node.$anchor, node);
        if ("$ref" in node) {
          this.refs.push({ node, resource: owner, value: node.$ref });
        }
        for (const child of children(node)) this.work.push({ schema: child, resource: owner });
      }
      // Finish discovering bundled resources before cache lookup, including fragment targets in annotations.
      for (const entry of this.refs) {
        const parsed = reference(entry.value);
        const owner = parsed.said ? this.load(parsed.said) : entry.resource;
        if (!owner) return null;
        // A just-loaded external resource must discover its anchors before fragment resolution.
        if (!this.scopes.has(owner.schema)) continue;
        const target = fragment(owner, parsed.fragment);
        if (object(target) && !this.scopes.has(target)) this.work.push({ schema: target, resource: owner });
      }
      if (!this.work.length) break;
    }
    return root;
  }

  /** Resolve only references authenticated by admit, preserving each bundled resource's scope. */
  resolve(schema: Schema): Schema | boolean {
    const owner = this.scopes.get(schema);
    if (!owner) throw new Error("Admitted schema has no resource scope");
    const parsed = reference(schema.$ref);
    const target = parsed.said ? this.resources.get(parsed.said) : owner;
    if (!target) throw new Error("Admitted schema reference has no resource");
    return fragment(target, parsed.fragment);
  }
}

/** Local static schema closure plus a synchronous Draft 2020-12 validator; legacy Schemer behavior is unchanged. */
export function validateSchema(acdc: SerderACDC, db: Baser, override?: string | Readonly<Schema>): SchemaValidation {
  const resources = new SchemaResources(db);
  try {
    const root = resources.admit(override ?? acdc.schema);
    if (!root) {
      return resources.missing
        ? { kind: "missing", said: resources.missing }
        : { kind: "invalid", subject: "schema", reason: "Invalid ACDC schema field" };
    }
    const { roots, scopes } = resources;
    // Compile only admitted private copies. Canonical local URNs remove URI-alias ambiguity without changing stored IDs.
    const uri = (said: string) => `urn:said:${said}`;
    const registered = new Set<string>();
    const copy = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(copy);
      if (!object(value)) return value;
      const result = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)]));
      const owner = scopes.get(value);
      if (!owner) return result;
      if ("$id" in value) {
        if (registered.has(owner.said)) delete result.$id;
        else {
          result.$id = uri(owner.said);
          registered.add(owner.said);
        }
      }
      if ("$ref" in value) {
        const parsed = reference(value.$ref);
        result.$ref = uri(parsed.said ?? owner.said) + parsed.fragment;
      }
      // Python treats these AJV extension/obsolete applicator keywords as annotations.
      for (const key of ["$async", "nullable", "dependencies", "additionalItems"]) delete result[key];
      return result;
    };
    const validator = new ValidatorCtor({ strict: false, validateFormats: false });
    for (const schema of scopes.keys()) {
      if (!validator.validateSchema(schema)) throw new InvalidSchema("Invalid Draft 2020-12 schema");
    }
    const copies = roots.map(copy);
    let validate: ReturnType<Validator["getSchema"]>;
    try {
      for (const schema of copies) validator.addSchema(schema);
      validate = validator.getSchema(uri(root.said));
    } catch (error) {
      if (error instanceof SyntaxError && error.message.includes("regular expression")) {
        return { kind: "invalid", subject: "schema", reason: error.message };
      }
      if (
        error instanceof Error && /^reference "urn:said:[^"]+" resolves to more than one schema$/.test(error.message)
      ) {
        return { kind: "invalid", subject: "schema", reason: error.message };
      }
      throw error;
    }
    if (!validate) throw new Error("Admitted schema was not registered");
    return validate(acdc.sad)
      ? { kind: "valid" }
      : { kind: "invalid", subject: "credential", reason: validator.errorsText(validate.errors) };
  } catch (error) {
    if (error instanceof InvalidSchema) return { kind: "invalid", subject: "schema", reason: error.message };
    throw error;
  }
}

/** Select a declared JSON type without interpreting constraints or digest spelling. */
function schemaTypeMatches(schema: unknown, value: unknown): boolean {
  if (schema === true) return true;
  if (!object(schema)) return false;
  const type = schema.type;
  if (object(value)) return type === "object";
  if (Array.isArray(value)) return type === "array";
  if (value === null) return type === "null";
  if (typeof value === "number") return type === "number" || (Number.isInteger(value) && type === "integer");
  if (typeof value === "string") return type === "string";
  if (typeof value === "boolean") return type === "boolean";
  return false;
}

/** Select one bounded, unambiguous branch; intersections and conditional reasoning stay unsupported. */
function selectDisclosureSchema(
  schema: unknown,
  value: unknown,
  resources: SchemaResources,
  depth = 64,
): Schema | false | null {
  if (depth <= 0) return null;
  if (typeof schema === "boolean") return schema === false ? false : null;
  if (!object(schema)) return null;
  if ("$ref" in schema) {
    const annotations = new Set([
      "$ref",
      "$id",
      "$schema",
      "title",
      "description",
      "$comment",
      "deprecated",
      "readOnly",
      "writeOnly",
      "examples",
      "default",
    ]);
    if (Object.keys(schema).some((key) => !annotations.has(key))) return null;
    return selectDisclosureSchema(resources.resolve(schema), value, resources, depth - 1);
  }
  if (
    ["anyOf", "allOf", "not", "if", "then", "else", "dependentSchemas", "patternProperties"].some((key) =>
      key in schema
    )
  ) {
    return null;
  }
  if ("oneOf" in schema) {
    if (!Array.isArray(schema.oneOf) || schema.oneOf.length > 16) return null;
    const matches = schema.oneOf.filter((branch) => schemaTypeMatches(branch, value));
    return matches.length === 1 ? selectDisclosureSchema(matches[0], value, resources, depth - 1) : null;
  }
  return schema;
}

/** Detect a compact-or-expanded map position without classifying ordinary scalar SAID data as a hidden map. */
function schemaMayMap(schema: unknown, resources: SchemaResources, depth = 64): boolean {
  if (depth <= 0 || schema === true) return true;
  if (!object(schema)) return false;
  if (schema.type === "object") return true;
  if ("$ref" in schema) return schemaMayMap(resources.resolve(schema), resources, depth - 1);
  if (!("oneOf" in schema)) return false;
  if (!Array.isArray(schema.oneOf) || schema.oneOf.length > 16) return true;
  return schema.oneOf.some((branch) => schemaMayMap(branch, resources, depth - 1));
}

/** Prove each schema-declared field-map below the carried value is expanded, under selected bounded limits. */
function closedBySchema(value: unknown, schema: unknown, resources: SchemaResources, depth = 64): boolean {
  if (depth <= 0 || (typeof value === "string" && schemaMayMap(schema, resources, depth))) return false;
  const selected = selectDisclosureSchema(schema, value, resources, depth);
  if (selected === null) return false;
  if (!object(value)) return schemaTypeMatches(selected, value);
  if (!selected || selected.type !== "object" || !object(selected.properties)) return false;
  const additional = selected.additionalProperties;
  if (additional !== false && !object(additional)) return false;
  for (const [label, child] of Object.entries(value)) {
    const childSchema = selected.properties[label] ?? additional;
    if (childSchema === false || !closedBySchema(child, childSchema, resources, depth - 1)) return false;
  }
  return true;
}

/** Locate the carried value and its authenticated subschema without resolving or expanding credential data. */
function disclosureSubschema(schema: unknown, value: unknown, parts: readonly string[], resources: SchemaResources): {
  value: unknown;
  schema: unknown;
} | null {
  for (const part of parts) {
    const selected = selectDisclosureSchema(schema, value, resources);
    if (!selected || !object(value)) return null;
    if (object(selected.properties) && Object.hasOwn(selected.properties, part)) schema = selected.properties[part];
    else {
      schema = selected.additionalProperties;
      if (schema !== true && !object(schema)) return null;
    }
    if (!Object.hasOwn(value, part)) return null;
    value = value[part];
  }
  return { value, schema };
}

/**
 * Prove requested whole/subtree disclosure under the selected explicit-acm profile.
 * Own-node schema validation remains separate. Missing static resources stay dependencies;
 * open/ambiguous schemas, reference intersections and whole aggregates refuse the closure claim.
 */
export function verifyDisclosureClosure(acdc: SerderACDC, db: Baser, paths: readonly string[]): SchemaValidation {
  const invalid = (): SchemaValidation => ({
    kind: "invalid",
    subject: "credential",
    reason: "Unproved disclosure closure",
  });
  if (acdc.ilk !== "acm") return invalid();
  const resources = new SchemaResources(db);
  try {
    const root = resources.admit(acdc.schema);
    if (!root) return resources.missing ? { kind: "missing", said: resources.missing } : invalid();
    for (const path of paths) {
      let parts: string[];
      try {
        parts = [...makePather(path, { relative: true }).rparts];
      } catch (error) {
        if (error instanceof ParserError) return invalid();
        throw error;
      }
      if (parts.at(-1) === "") parts.pop();
      if (parts.length === 1 && parts[0] === "d") {
        if (Object.hasOwn(acdc.sad!, "A")) return invalid();
        for (const label of ["a", "e", "r"]) {
          if (!Object.hasOwn(acdc.sad!, label)) continue;
          const located = disclosureSubschema(root.schema, acdc.sad, [label], resources);
          if (!located || !closedBySchema(located.value, located.schema, resources)) return invalid();
        }
      } else {
        const located = disclosureSubschema(root.schema, acdc.sad, parts, resources);
        if (!located || !closedBySchema(located.value, located.schema, resources)) return invalid();
      }
    }
    return { kind: "valid" };
  } catch (error) {
    if (error instanceof InvalidSchema) return { kind: "invalid", subject: "schema", reason: error.message };
    throw error;
  }
}
