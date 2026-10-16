/**
 * Static/dynamic `did:webs` artifact generation.
 *
 * `did.json` is a hosted projection. `keri.cesr` is the replay stream a clean
 * resolver needs to rebuild the same DID document from KERI/VDR state.
 */
import { concatBytes, Diger, Prefixer } from "cesr-ts";
import type { AgentRuntime } from "../../app/agent-runtime.ts";
import { requireRegery } from "../../app/credential-workflows.ts";
import type { Hab, Habery } from "../../app/habbing.ts";
import { ValidationError } from "../../core/errors.ts";
import { type Role, Roles } from "../../core/roles.ts";
import { type Regery, serializeCredential } from "../../vdr/credentialing.ts";
import { listActiveDesignatedAliasCredentials, pinDesignatedAliasesSchema } from "./designated-aliases.ts";
import { parseDidWebs } from "./dids.ts";
import { generateDidDocument } from "./documenting.ts";

export interface DidWebsJsonArtifact {
  readonly aid: string;
  readonly didJson: Uint8Array;
}

export interface DidWebsArtifacts extends DidWebsJsonArtifact {
  readonly keriCesr: Uint8Array;
}

export interface GenerateDidWebsArtifactsOptions {
  readonly did: string;
  readonly alias?: string;
  readonly metadata?: boolean;
}

/** Generate both hosted artifacts for one local AID. */
export function generateDidWebsArtifacts(
  runtime: AgentRuntime,
  options: GenerateDidWebsArtifactsOptions,
): DidWebsArtifacts {
  const { aid, hab, didJson } = prepareHostedJson(runtime, options);
  return { aid, didJson, keriCesr: generateDidWebsCesr(runtime, aid, { hab }) };
}

/** Generate only the hosted JSON artifact; never open the CESR replay history. */
export function generateDidWebsJson(
  runtime: AgentRuntime,
  options: GenerateDidWebsArtifactsOptions,
): DidWebsJsonArtifact {
  const { aid, didJson } = prepareHostedJson(runtime, options);
  return { aid, didJson };
}

/** Preserve local-AID validation and document projection for both artifact entry points. */
function prepareHostedJson(
  runtime: AgentRuntime,
  options: GenerateDidWebsArtifactsOptions,
): DidWebsJsonArtifact & { readonly hab: Hab } {
  const parsed = parseDidWebs(options.did);
  const hab = options.alias ? requireHab(runtime.hby, options.alias) : runtime.hby.habs.get(parsed.aid);
  if (!hab?.pre) {
    throw new ValidationError(`No local AID found for did:webs AID ${parsed.aid}.`);
  }
  if (hab.pre !== parsed.aid) {
    throw new ValidationError(
      `DID ${options.did} embeds AID ${parsed.aid}, but alias ${hab.name} is ${hab.pre}.`,
    );
  }
  pinDesignatedAliasesSchema(runtime.hby.db);
  const document = generateDidDocument(runtime.hby, requireRegery(runtime), options.did, {
    hosted: true,
    metadata: options.metadata ?? false,
  });
  return {
    aid: parsed.aid,
    hab,
    didJson: new TextEncoder().encode(`${JSON.stringify(document, null, 2)}\n`),
  };
}

/** Generate the replay CESR stream for one local AID. */
export function generateDidWebsCesr(
  runtime: AgentRuntime,
  aid: string,
  options: { readonly hab?: Hab } = {},
): Uint8Array {
  const hab = options.hab ?? runtime.hby.habs.get(aid);
  if (!hab?.pre) {
    throw new ValidationError(`No local AID found for ${aid}.`);
  }
  const kever = runtime.hby.db.getKever(aid, { refresh: true });
  if (!kever) {
    throw new ValidationError(`No accepted key state for ${aid}.`);
  }
  const messages: Uint8Array[] = [];
  if (kever.delegated) {
    messages.push(...runtime.hby.db.cloneDelegation(kever));
  }
  messages.push(...runtime.hby.db.clonePreIter(aid));
  messages.push(...endpointMessages(hab, aid));
  const regery = runtime.vdr;
  if (!regery) throw new ValidationError("VDR runtime did not open Reger.");
  messages.push(...designatedAliasMessages(regery, aid));
  return concatBytes(...messages.filter((message) => message.length > 0));
}

function endpointMessages(hab: Hab, aid: string): Uint8Array[] {
  const messages: Uint8Array[] = [];
  const kever = hab.db.getKever(aid, { refresh: true });
  for (const eid of kever?.wits ?? []) {
    messages.push(hab.loadLocScheme(eid));
    messages.push(hab.loadEndRole(eid, eid, Roles.controller));
  }
  messages.push(...storedEndpointMessages(hab, aid, Roles.agent));
  messages.push(...storedEndpointMessages(hab, aid, Roles.mailbox));
  return messages;
}

function storedEndpointMessages(hab: Hab, aid: string, role: Role): Uint8Array[] {
  const messages: Uint8Array[] = [];
  for (
    const [keys, end] of hab.db.ends.getTopItemIter([aid, role], {
      topive: true,
    })
  ) {
    const eid = keys[2];
    if (!eid || !(end.allowed || end.enabled)) {
      continue;
    }
    messages.push(hab.loadLocScheme(eid));
    messages.push(hab.loadEndRole(aid, eid, role));
  }
  return messages;
}

function designatedAliasMessages(
  regery: Regery,
  aid: string,
): Uint8Array[] {
  const reger = regery.reger;
  const messages: Uint8Array[] = [];
  for (const item of listActiveDesignatedAliasCredentials(regery, aid)) {
    const creder = item.creder;
    if (!creder.regid || !creder.said) {
      continue;
    }
    messages.push(...reger.clonePreIter(creder.regid));
    messages.push(...reger.clonePreIter(creder.said));
    const [clone, prefixer, number, diger] = reger.cloneCred(creder.said);
    messages.push(serializeCredential(
      clone,
      prefixer as Prefixer,
      number,
      diger as Diger,
    ));
  }
  return messages;
}

function requireHab(hby: Habery, alias: string): Hab {
  const hab = hby.habByName(alias);
  if (!hab?.pre) {
    throw new ValidationError(`No local AID found for alias ${alias}.`);
  }
  return hab;
}
