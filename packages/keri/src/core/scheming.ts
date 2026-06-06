/**
 * JSON Schema SAD support for schema data OOBIs.
 *
 * KERIpy correspondence:
 * - ports the operational subset of `keri.core.scheming.Schemer`
 * - schema `$id` is the self-addressing field and must verify as a SAID
 * - raw schema bytes remain the stored value in `schema.`
 */
import Ajv from "npm:ajv@8.17.1";
import Ajv2020 from "npm:ajv@8.17.1/dist/2020.js";
import { DigDex, dumps, type Kind, Saider } from "../../../cesr/mod.ts";
import { ValidationError } from "./errors.ts";

type JsonObject = Record<string, unknown>;
type SchemaValidator = { validateSchema(schema: unknown): boolean };
type SchemaValidatorCtor = new (options: { strict: boolean }) => SchemaValidator;

/** Constructor options for one schema SAD wrapper. */
export interface SchemerInit {
  raw?: Uint8Array | string;
  sed?: JsonObject;
  kind?: Kind;
  code?: string;
  verify?: boolean;
}

/**
 * Verified JSON schema SAD wrapper.
 *
 * Responsibilities:
 * - keep the exact raw bytes fetched or imported
 * - parse the schema JSON into `sed`
 * - verify `$id` as the schema SAID
 * - validate the declared JSON Schema dialect
 */
export class Schemer {
  readonly raw: Uint8Array;
  readonly sed: JsonObject;
  readonly kind: Kind;
  readonly saider: Saider;

  constructor(init: SchemerInit) {
    const {
      raw,
      sed,
      kind = "JSON",
      code = DigDex.Blake3_256,
      verify = true,
    } = init;
    if (raw !== undefined) {
      const bytes = typeof raw === "string" ? new TextEncoder().encode(raw) : raw;
      const parsed = parseSchemaJson(bytes);
      this.raw = new Uint8Array(bytes);
      this.sed = parsed;
      this.kind = kind;
      this.saider = verifySchemaSaid(parsed, kind);
    } else if (sed !== undefined) {
      const saidified = Saider.saidifyFields({ ...sed, $id: sed.$id ?? "" }, {
        kind,
        saids: { $id: code },
      });
      this.raw = saidified.raw;
      this.sed = saidified.sad;
      this.kind = kind;
      const saider = saidified.saiders.$id;
      if (!saider) {
        throw new ValidationError("Unable to compute schema SAID.");
      }
      this.saider = saider;
    } else {
      throw new ValidationError("Schemer requires raw bytes or schema data.");
    }

    if (verify && !isValidJsonSchema(this.sed)) {
      throw new ValidationError("Invalid JSON Schema document.");
    }
  }

  /** Schema SAID encoded in `$id`. */
  get said(): string {
    return this.saider.qb64;
  }

  /** Pretty-print the parsed schema for diagnostics. */
  pretty(size = 1024): string {
    return JSON.stringify(this.sed, null, 1).slice(0, size);
  }

  /** Detect likely JSON Schema bytes using KERIpy's `$schema` heuristic. */
  static detect(raw: Uint8Array): boolean {
    return new TextDecoder().decode(raw).includes('"$schema"');
  }
}

function parseSchemaJson(raw: Uint8Array): JsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(raw));
  } catch (error) {
    throw new ValidationError(
      `Error deserializing JSON schema: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isJsonObject(parsed)) {
    throw new ValidationError("JSON schema must be an object.");
  }
  return parsed;
}

function verifySchemaSaid(sed: JsonObject, kind: Kind): Saider {
  const id = sed.$id;
  if (typeof id !== "string" || id.length === 0) {
    throw new ValidationError("Missing schema $id SAID.");
  }

  const saider = new Saider({ qb64: id });
  const actual = Saider.saidifyFields({ ...sed }, {
    kind,
    saids: { $id: saider.code },
  });
  const actualSaid = actual.saiders.$id?.qb64;
  if (actualSaid !== id) {
    throw new ValidationError(
      `Invalid schema $id SAID ${id}; expected ${actualSaid ?? "<unknown>"}.`,
    );
  }

  return saider;
}

function isValidJsonSchema(schema: JsonObject): boolean {
  try {
    return schemaValidatorFor(schema).validateSchema(schema);
  } catch {
    return false;
  }
}

function schemaValidatorFor(schema: JsonObject): SchemaValidator {
  const dialect = typeof schema.$schema === "string" ? schema.$schema : "";
  if (dialect.includes("2020-12")) {
    const Ctor = Ajv2020 as unknown as SchemaValidatorCtor;
    return new Ctor({ strict: false });
  }
  const Ctor = Ajv as unknown as SchemaValidatorCtor;
  return new Ctor({ strict: false });
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Serialize one parsed schema through KERIpy-compatible JSON dumps. */
export function dumpSchema(sed: JsonObject): Uint8Array {
  return dumps(sed, "JSON");
}
