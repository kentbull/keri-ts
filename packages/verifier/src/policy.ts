/** Operator business acceptance, independent of protocol validity and evidence persistence. */
import type { SerderACDC } from "cesr-ts";
import type { Reger } from "keri-ts/db";
import type { Habery } from "keri-ts/runtime";

export interface VerifierBusinessValidatorContext {
  hby: Habery;
  reger: Reger;
}

export type VerifierBusinessValidator = (
  creder: SerderACDC,
  context: VerifierBusinessValidatorContext,
) => boolean | string | void;

/** Return a business refusal reason without modifying accepted protocol evidence. */
export function validateCredential(
  creder: SerderACDC,
  validators: Record<string, VerifierBusinessValidator>,
  context: VerifierBusinessValidatorContext,
  requireKnownSchemas: boolean,
): string | null {
  const schema = credentialSchema(creder);
  if (!schema) {
    return "missing credential schema";
  }
  const validator = validators[schema];
  if (!validator) {
    return requireKnownSchemas ? `unsupported credential schema ${schema}` : null;
  }
  const result = validator(creder, context);
  if (typeof result === "string") {
    return result;
  }
  return result === false ? `credential ${creder.said ?? "<unknown>"} failed business validation` : null;
}

/** Build validators from a local JSON config object. */
export function validatorsFromVerifierConfig(
  config: unknown,
): Record<string, VerifierBusinessValidator> {
  if (!isRecord(config) || !isRecord(config.schemas)) {
    return {};
  }
  const validators: Record<string, VerifierBusinessValidator> = {};
  for (const [schema, policy] of Object.entries(config.schemas)) {
    if (!isRecord(policy)) {
      continue;
    }
    validators[schema] = (creder) => {
      const issuer = typeof policy.issuer === "string" ? policy.issuer : "";
      if (issuer && creder.issuer !== issuer) {
        return `expected issuer ${issuer}, got ${creder.issuer ?? "<missing>"}`;
      }
      return true;
    };
  }
  return validators;
}

/** Match the application's supported schema-SAID projection for policy and webhook consumers. */
export function credentialSchema(creder: SerderACDC): string {
  const schema = creder.schema;
  return typeof schema === "string" ? schema : isRecord(schema) && typeof schema.$id === "string" ? schema.$id : "";
}

/** Narrow operator JSON mappings without imposing protocol or schema validation here. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
