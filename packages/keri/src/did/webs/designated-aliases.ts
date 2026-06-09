/**
 * Designated-alias ACDC support for `did:webs`.
 *
 * Responsibilities:
 * - pin the public DA schema before issuing or verifying DA credentials
 * - issue replacement DA credentials for one local AID
 * - expose one active-state query shared by DID documents and CESR artifacts
 */
import {
  DigDex,
  Ilks,
  Kinds,
  Saider,
  type SerderACDC,
} from "../../../../cesr/mod.ts";
import type { AgentRuntime } from "../../app/agent-runtime.ts";
import type { Hab } from "../../app/habbing.ts";
import { Verifier } from "../../app/verifying.ts";
import { ValidationError } from "../../core/errors.ts";
import { Schemer } from "../../core/scheming.ts";
import type { Reger } from "../../db/reger.ts";
import { Credentialer, CredentialWallet, Regery, Registry } from "../../vdr/credentialing.ts";
import { Tevery } from "../../vdr/eventing.ts";
import DESIGNATED_ALIASES_SCHEMA_RESOURCE from "./designated-aliases-public-schema.json" with { type: "json" };
import { isDidString, parseDid } from "./dids.ts";

export const DESIGNATED_ALIASES_SCHEMA_SAID = "EN6Oh5XSD5_q2Hgu-aqpdfbVepdpYpFlgz6zvJL5b_r5";

export const DEFAULT_DESIGNATED_ALIASES_REGISTRY_NAME = "dws-designated-aliases";

export interface ActiveDesignatedAliasCredential {
  readonly creder: SerderACDC;
  readonly aliases: readonly string[];
}

export interface BindDesignatedAliasesOptions {
  readonly alias: string;
  readonly dids: readonly string[];
  readonly registryName?: string;
  readonly createRegistry?: boolean;
  readonly allowExternalDid?: boolean;
}

export interface BindDesignatedAliasesResult {
  readonly aid: string;
  readonly registry: string;
  readonly registryName: string;
  readonly issued: string;
  readonly revoked: readonly string[];
  readonly aliases: readonly string[];
}

/** Pin the public DA schema into a Habery schema cache. */
export function pinDesignatedAliasesSchema(runtime: AgentRuntime): Schemer {
  const schemer = new Schemer({
    sed: cloneJsonObject(DESIGNATED_ALIASES_SCHEMA_RESOURCE),
  });
  if (schemer.said !== DESIGNATED_ALIASES_SCHEMA_SAID) {
    throw new ValidationError(
      `Embedded designated-alias schema SAID ${schemer.said} does not match ${DESIGNATED_ALIASES_SCHEMA_SAID}.`,
    );
  }
  runtime.hby.db.schema.pin(schemer.said, schemer);
  return schemer;
}

/**
 * Issue a replacement DA credential for one local AID.
 *
 * Existing active DA credentials from the same issuer/schema are revoked before
 * the replacement credential is issued.
 */
export function bindDesignatedAliases(
  runtime: AgentRuntime,
  options: BindDesignatedAliasesOptions,
): BindDesignatedAliasesResult {
  const hab = requireHab(runtime, options.alias);
  const aid = hab.pre;
  const aliases = normalizeAliasList(options.dids);
  if (aliases.length === 0) {
    throw new ValidationError("At least one --did value is required.");
  }
  for (const did of aliases) {
    validateAliasDidForAid(did, aid, options.allowExternalDid ?? false);
  }

  pinDesignatedAliasesSchema(runtime);
  const rgy = requireRegery(runtime);
  const reger = requireReger(runtime);
  const registryName = options.registryName ?? DEFAULT_DESIGNATED_ALIASES_REGISTRY_NAME;
  const registry = designatedAliasRegistry(
    rgy,
    registryName,
    hab,
    options.createRegistry ?? true,
  );

  const active = listActiveDesignatedAliasCredentials(runtime, aid);
  const revoked: string[] = [];
  for (const item of active) {
    const said = credentialSaid(item.creder);
    registryForCredential(runtime, item.creder).revoke(said);
    revoked.push(said);
  }

  const credentialer = new Credentialer(runtime.hby, {
    reger,
    vry: requireVerifier(runtime),
  });
  const creder = credentialer.create({
    registry,
    schema: DESIGNATED_ALIASES_SCHEMA_SAID,
    data: { ids: aliases },
    rules: designatedAliasRules(),
  });
  const issued = credentialer.issue(registry, creder);
  if (issued.verifierDecision.kind !== "accept") {
    throw new ValidationError(
      `Designated-alias credential was not saved: ${issued.verifierDecision.kind}.`,
    );
  }
  return {
    aid,
    registry: registry.regk ?? "",
    registryName,
    issued: credentialSaid(creder),
    revoked,
    aliases,
  };
}

/** List active, unrevoked DA credentials issued by one AID. */
export function listActiveDesignatedAliasCredentials(
  runtime: AgentRuntime,
  aid: string,
): ActiveDesignatedAliasCredential[] {
  const reger = requireReger(runtime);
  const tvy = requireTevery(runtime);
  const wallet = new CredentialWallet(reger);
  const active: ActiveDesignatedAliasCredential[] = [];
  for (
    const said of wallet.list({
      issued: true,
      aid,
      schema: DESIGNATED_ALIASES_SCHEMA_SAID,
    }).sort()
  ) {
    const [creder] = reger.cloneCred(said);
    const state = creder.regid ? tvy.tevers.get(creder.regid)?.vcState(said) : null;
    if (!state || !isActiveCredentialState(state.et)) {
      continue;
    }
    active.push({
      creder,
      aliases: extractDesignatedAliases(creder),
    });
  }
  return active;
}

/** Extract `a.ids` from one DA credential body. */
export function extractDesignatedAliases(creder: SerderACDC): string[] {
  const attrib = creder.attrib;
  if (!isRecord(attrib)) {
    return [];
  }
  const ids = attrib.ids;
  return Array.isArray(ids)
    ? ids.filter((item): item is string => typeof item === "string")
    : [];
}

function isActiveCredentialState(et: unknown): boolean {
  return et === Ilks.iss || et === Ilks.bis;
}

function designatedAliasRules(): Record<string, unknown> {
  const rules = {
    d: "",
    aliasDesignation: {
      l: "The issuer of this ACDC designates the identifiers in the ids field as the only allowed namespaced aliases of the issuer's AID.",
    },
    usageDisclaimer: {
      l: "This attestation only asserts designated aliases of the controller of the AID, that the AID controlled namespaced alias has been designated by the controller. It does not assert that the controller of this AID has control over the infrastructure or anything else related to the namespace other than the included AID.",
    },
    issuanceDisclaimer: {
      l: "All information in a valid and non-revoked alias designation assertion is accurate as of the date specified.",
    },
    termsOfUse: {
      l: "Designated aliases of the AID must only be used in a manner consistent with the expressed intent of the AID controller.",
    },
  };
  return Saider.saidify(rules, {
    label: "d",
    code: DigDex.Blake3_256,
    kind: Kinds.json,
  }).sad;
}

function validateAliasDidForAid(
  did: string,
  aid: string,
  allowExternalDid: boolean,
): void {
  if (!isDidString(did)) {
    throw new ValidationError(`Alias ${did} is not a DID.`);
  }
  let parsed;
  try {
    parsed = parseDid(did);
  } catch {
    if (allowExternalDid) {
      return;
    }
    throw new ValidationError(
      `Unsupported DID alias ${did}; pass --allow-external-did to self-attest opaque DID methods.`,
    );
  }
  if (parsed.aid !== aid) {
    throw new ValidationError(
      `Alias ${did} embeds AID ${parsed.aid}, expected ${aid}.`,
    );
  }
}

function normalizeAliasList(dids: readonly string[]): string[] {
  return [...new Set(dids.map((did) => did.trim()).filter((did) => did.length > 0))].sort();
}

function registryForCredential(
  runtime: AgentRuntime,
  creder: SerderACDC,
): Registry {
  const regid = creder.regid;
  const rgy = requireRegery(runtime);
  for (const registry of rgy.registries.values()) {
    if (registry.regk === regid) {
      return registry;
    }
  }
  throw new ValidationError(`Registry ${regid ?? "<missing>"} not found for DA credential ${credentialSaid(creder)}.`);
}

function designatedAliasRegistry(
  rgy: Regery,
  registryName: string,
  hab: Hab,
  createRegistry: boolean,
): Registry {
  let registry = rgy.registryByName(registryName);
  if (registry) {
    if (registry.hab.pre !== hab.pre) {
      throw new ValidationError(
        `Registry ${registryName} belongs to ${registry.hab.pre}, not ${hab.pre}.`,
      );
    }
    return registry;
  }

  rgy.loadRegistries();
  registry = rgy.registryByName(registryName);
  if (registry) {
    if (registry.hab.pre !== hab.pre) {
      throw new ValidationError(
        `Registry ${registryName} belongs to ${registry.hab.pre}, not ${hab.pre}.`,
      );
    }
    return registry;
  }

  if (!createRegistry) {
    throw new ValidationError(`Registry ${registryName} not found.`);
  }
  return rgy.makeRegistry(registryName, hab, { noBackers: true });
}

function credentialSaid(creder: SerderACDC): string {
  if (!creder.said) {
    throw new ValidationError("Credential is missing SAID.");
  }
  return creder.said;
}

function requireHab(runtime: AgentRuntime, alias: string): Hab {
  const hab = runtime.hby.habByName(alias);
  if (!hab?.pre) {
    throw new ValidationError(`No local AID found for alias ${alias}.`);
  }
  return hab;
}

function requireReger(runtime: AgentRuntime): Reger {
  const reger = runtime.vdr.reger;
  if (!reger) {
    throw new ValidationError("VDR runtime did not open Reger.");
  }
  return reger as Reger;
}

function requireRegery(runtime: AgentRuntime): Regery {
  if (!(runtime.vdr.rgy instanceof Regery)) {
    throw new ValidationError("VDR runtime did not open Regery.");
  }
  return runtime.vdr.rgy;
}

function requireTevery(runtime: AgentRuntime): Tevery {
  if (!(runtime.vdr.tvy instanceof Tevery)) {
    throw new ValidationError("VDR runtime did not open Tevery.");
  }
  return runtime.vdr.tvy;
}

function requireVerifier(runtime: AgentRuntime): Verifier {
  if (!(runtime.vdr.vry instanceof Verifier)) {
    throw new ValidationError("VDR runtime did not open Verifier.");
  }
  return runtime.vdr.vry;
}

function cloneJsonObject(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
