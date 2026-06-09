/**
 * DID document projection from KERI/VDR runtime state.
 *
 * The document is a deterministic view over accepted key state, endpoint reply
 * state, and active designated-alias credentials. Hosted artifacts may use
 * `did:web`, but resolver comparison normalizes them back to `did:webs`.
 */
import type { AgentRuntime } from "../../app/agent-runtime.ts";
import type { Habery } from "../../app/habbing.ts";
import { ValidationError } from "../../core/errors.ts";
import type { Kever } from "../../core/kever.ts";
import { Roles } from "../../core/roles.ts";
import { listActiveDesignatedAliasCredentials } from "./designated-aliases.ts";
import { parseDid, parseDidWebs, toCanonicalDidWebs, toHostedDidWeb } from "./dids.ts";

export interface DidResolutionResult {
  readonly didDocument: DidDocument | null;
  readonly didResolutionMetadata: Record<string, unknown>;
  readonly didDocumentMetadata: Record<string, unknown>;
}

export interface DidDocument extends Record<string, unknown> {
  readonly id: string;
}

export interface DidDocumentOptions {
  readonly hosted?: boolean;
  readonly metadata?: boolean;
}

/** Generate a DID document or DID Resolution Result from runtime state. */
export function generateDidDocument(
  runtime: AgentRuntime,
  did: string,
  options: DidDocumentOptions = {},
): DidDocument | DidResolutionResult {
  const document = generateBareDidDocument(runtime, did, options);
  if (!options.metadata) {
    return document;
  }
  return {
    didDocument: document,
    didResolutionMetadata: {
      contentType: "application/did+json",
    },
    didDocumentMetadata: {},
  };
}

/** Generate only the DID document body from runtime state. */
export function generateBareDidDocument(
  runtime: AgentRuntime,
  did: string,
  options: DidDocumentOptions = {},
): DidDocument {
  const parsed = parseDid(did);
  const aid = parsed.aid;
  const kever = runtime.hby.db.getKever(aid, { refresh: true });
  if (!kever) {
    throw new ValidationError(`No accepted key state for ${aid}.`);
  }
  const documentDid = parsed.kind === "webs" || parsed.kind === "web"
    ? options.hosted
      ? toHostedDidWeb(parseDidWebs(did))
      : toCanonicalDidWebs(parseDidWebs(did))
    : parsed.canonical;
  const methodEntries = verificationMethods(documentDid, kever);
  methodEntries.push(...thresholdVerificationMethods(documentDid, kever, methodEntries.map((entry) => entry.id)));
  const services = serviceEntries(runtime.hby, aid);
  const aliases = listActiveDesignatedAliasCredentials(runtime, aid)
    .flatMap((item) => item.aliases)
    .sort();
  return pruneEmpty({
    id: documentDid,
    verificationMethod: methodEntries,
    service: services,
    alsoKnownAs: [...new Set(aliases)],
  }) as DidDocument;
}

/** Format one successful resolution result. */
export function didResolutionResult(
  document: DidDocument,
  contentType = "application/did+json",
): DidResolutionResult {
  return {
    didDocument: document,
    didResolutionMetadata: { contentType },
    didDocumentMetadata: {},
  };
}

/** Format one failed resolution result. */
export function didResolutionError(
  error: string,
  message: string,
): DidResolutionResult {
  return {
    didDocument: null,
    didResolutionMetadata: { error, message },
    didDocumentMetadata: {},
  };
}

function verificationMethods(
  did: string,
  kever: Kever,
): Array<Record<string, unknown> & { id: string }> {
  return kever.verfers.map((verfer) => ({
    id: `#${verfer.qb64}`,
    type: "JsonWebKey",
    controller: did,
    publicKeyJwk: {
      kid: verfer.qb64,
      kty: "OKP",
      crv: "Ed25519",
      x: base64Url(verfer.raw),
    },
  }));
}

function thresholdVerificationMethods(
  did: string,
  kever: Kever,
  methodIds: readonly string[],
): Array<Record<string, unknown> & { id: string }> {
  const tholder = kever.tholder;
  if (!tholder || methodIds.length === 0) {
    return [];
  }
  if (!tholder.weighted && (tholder.num ?? 1n) <= 1n) {
    return [];
  }
  if (!tholder.weighted) {
    return [{
      id: `#${kever.prefixer.qb64}`,
      type: "ConditionalProof2022",
      controller: did,
      threshold: Number(tholder.num ?? 1n),
      conditionThreshold: [...methodIds],
    }];
  }
  return [{
    id: `#${kever.prefixer.qb64}`,
    type: "ConditionalProof2022",
    controller: did,
    threshold: tholder.sith,
    conditionWeightedThreshold: weightedConditions(tholder.sith, methodIds),
  }];
}

function serviceEntries(
  hby: Habery,
  aid: string,
): Array<Record<string, unknown>> {
  const entries: Array<Record<string, unknown>> = [];
  const ends = endpointUrls(hby, aid);
  for (const [role, endpoints] of Object.entries(ends).sort()) {
    for (const [eid, urls] of Object.entries(endpoints).sort()) {
      const endpoint = serviceEndpoint(urls);
      if (!endpoint) {
        continue;
      }
      entries.push({
        id: `#${eid}/${role}`,
        type: role,
        serviceEndpoint: endpoint,
      });
    }
  }
  return entries;
}

function endpointUrls(
  hby: Habery,
  aid: string,
): Record<string, Record<string, Record<string, string>>> {
  const ends: Record<string, Record<string, Record<string, string>>> = {};
  for (
    const [keys, end] of hby.db.ends.getTopItemIter([aid], { topive: true })
  ) {
    const role = keys[1];
    const eid = keys[2];
    if (!role || !eid || !(end.allowed || end.enabled)) {
      continue;
    }
    const urls = fetchUrls(hby, eid);
    if (Object.keys(urls).length === 0) {
      continue;
    }
    ends[role] ??= {};
    ends[role][eid] = urls;
  }

  const kever = hby.db.getKever(aid, { refresh: true });
  if (kever?.wits && kever.wits.length > 0) {
    const witnessUrls: Record<string, Record<string, string>> = {};
    for (const eid of [...kever.wits].sort()) {
      const urls = fetchUrls(hby, eid);
      if (Object.keys(urls).length > 0) {
        witnessUrls[eid] = urls;
      }
    }
    if (Object.keys(witnessUrls).length > 0) {
      ends[Roles.witness] = witnessUrls;
    }
  }
  return ends;
}

function fetchUrls(hby: Habery, eid: string): Record<string, string> {
  const urls: Record<string, string> = {};
  for (
    const [path, loc] of hby.db.locs.getTopItemIter([eid], { topive: true })
  ) {
    const scheme = path[1];
    if (scheme && loc.url) {
      urls[scheme] = loc.url;
    }
  }
  return urls;
}

function serviceEndpoint(urls: Record<string, string>): Record<string, string> | null {
  const sorted = Object.entries(urls).sort();
  if (sorted.length === 0) {
    return null;
  }
  return Object.fromEntries(sorted);
}

function pruneEmpty(value: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (Array.isArray(item) && item.length === 0) {
      continue;
    }
    result[key] = item;
  }
  return result;
}

function weightedConditions(
  threshold: unknown,
  methodIds: readonly string[],
): Array<Record<string, unknown>> {
  if (!Array.isArray(threshold) || threshold.length === 0) {
    return methodIds.map((id) => ({ condition: id, weight: 1 }));
  }
  const weights = Array.isArray(threshold[0]) ? threshold[0] : threshold;
  return methodIds.map((id, index) => ({
    condition: id,
    weight: weights[index] ?? 1,
  }));
}

function base64Url(raw: Uint8Array): string {
  let text = "";
  for (const byte of raw) {
    text += String.fromCharCode(byte);
  }
  return btoa(text).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
