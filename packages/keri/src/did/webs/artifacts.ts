/**
 * Static/dynamic `did:webs` artifact generation.
 *
 * `did.json` is a hosted projection. `keri.cesr` is the replay stream a clean
 * resolver needs to rebuild the same DID document from KERI/VDR state.
 */
import {
  concatBytes,
  Diger,
  Prefixer,
} from "../../../../cesr/mod.ts";
import type { AgentRuntime } from "../../app/agent-runtime.ts";
import type { Hab } from "../../app/habbing.ts";
import { ValidationError } from "../../core/errors.ts";
import { Roles } from "../../core/roles.ts";
import { Reger } from "../../db/reger.ts";
import { serializeCredential } from "../../vdr/credentialing.ts";
import { listActiveDesignatedAliasCredentials, pinDesignatedAliasesSchema } from "./designated-aliases.ts";
import { parseDidWebs } from "./dids.ts";
import { generateDidDocument } from "./documenting.ts";

export interface DidWebsArtifacts {
  readonly aid: string;
  readonly didJson: Uint8Array;
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
  const parsed = parseDidWebs(options.did);
  const hab = options.alias ? requireHab(runtime, options.alias) : runtime.hby.habs.get(parsed.aid);
  if (!hab?.pre) {
    throw new ValidationError(`No local AID found for did:webs AID ${parsed.aid}.`);
  }
  if (hab.pre !== parsed.aid) {
    throw new ValidationError(
      `DID ${options.did} embeds AID ${parsed.aid}, but alias ${hab.name} is ${hab.pre}.`,
    );
  }
  pinDesignatedAliasesSchema(runtime);
  const document = generateDidDocument(runtime, options.did, {
    hosted: true,
    metadata: options.metadata ?? false,
  });
  return {
    aid: parsed.aid,
    didJson: new TextEncoder().encode(`${JSON.stringify(document, null, 2)}\n`),
    keriCesr: generateDidWebsCesr(runtime, parsed.aid, { hab }),
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
  messages.push(...designatedAliasMessages(runtime, aid));
  return concatBytes(...messages.filter((message) => message.length > 0));
}

function endpointMessages(hab: Hab, aid: string): Uint8Array[] {
  const messages: Uint8Array[] = [];
  for (const role of [Roles.witness, Roles.agent, Roles.mailbox, Roles.controller]) {
    messages.push(hab.replyEndRole(aid, role));
  }
  return messages;
}

function designatedAliasMessages(
  runtime: AgentRuntime,
  aid: string,
): Uint8Array[] {
  const reger = runtime.vdr.reger;
  if (!(reger instanceof Reger)) {
    throw new ValidationError("VDR runtime did not open Reger.");
  }
  const messages: Uint8Array[] = [];
  for (const item of listActiveDesignatedAliasCredentials(runtime, aid)) {
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

function requireHab(runtime: AgentRuntime, alias: string): Hab {
  const hab = runtime.hby.habByName(alias);
  if (!hab?.pre) {
    throw new ValidationError(`No local AID found for alias ${alias}.`);
  }
  return hab;
}
