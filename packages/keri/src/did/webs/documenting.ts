/**
 * DID document projection from KERI/VDR runtime state.
 *
 * The document is a deterministic view over accepted key state, endpoint reply
 * state, and active designated-alias credentials. Hosted artifacts may use
 * `did:web`, but resolver comparison normalizes them back to `did:webs`.
 */
import type { ThresholdClause, ThresholdClauseEntry, ThresholdSith } from "../../../../cesr/mod.ts";
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

type VerificationMethodEntry = Record<string, unknown> & { id: string };

interface Rational {
  readonly numerator: bigint;
  readonly denominator: bigint;
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
): VerificationMethodEntry[] {
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
): VerificationMethodEntry[] {
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
  return weightedThresholdVerificationMethods(did, kever.prefixer.qb64, tholder.sith, methodIds);
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

function base64Url(raw: Uint8Array): string {
  let text = "";
  for (const byte of raw) {
    text += String.fromCharCode(byte);
  }
  return btoa(text).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function weightedThresholdVerificationMethods(
  did: string,
  pre: string,
  sith: ThresholdSith,
  methodIds: readonly string[],
): VerificationMethodEntry[] {
  if (typeof sith === "string") {
    throw new ValidationError(`Expected weighted threshold for ${pre}.`);
  }
  const clauses = thresholdClauses(sith);
  if (clauses.length === 1) {
    const projected = projectWeightedClause({
      id: `#${pre}`,
      did,
      pre,
      clause: clauses[0]!,
      clauseIndex: 0,
      methodIds,
      startSlot: 0,
    });
    return [projected.method, ...projected.children];
  }

  const methods: VerificationMethodEntry[] = [];
  const conditionAnd: string[] = [];
  let slot = 0;
  for (const [clauseIndex, clause] of clauses.entries()) {
    const projected = projectWeightedClause({
      id: `#${pre}-kt-c${clauseIndex}`,
      did,
      pre,
      clause,
      clauseIndex,
      methodIds,
      startSlot: slot,
    });
    conditionAnd.push(projected.method.id);
    methods.push(projected.method, ...projected.children);
    slot = projected.nextSlot;
  }

  return [{
    id: `#${pre}`,
    type: "ConditionalProof2022",
    controller: did,
    conditionAnd,
  }, ...methods];
}

function thresholdClauses(sith: Exclude<ThresholdSith, string>): ThresholdClause[] {
  if (!Array.isArray(sith) || sith.length === 0) {
    throw new ValidationError("Weighted threshold must be a non-empty array.");
  }
  return sith.some((entry) => !Array.isArray(entry))
    ? [sith as ThresholdClause]
    : sith as ThresholdClause[];
}

function projectWeightedClause(args: {
  id: string;
  did: string;
  pre: string;
  clause: ThresholdClause;
  clauseIndex: number;
  methodIds: readonly string[];
  startSlot: number;
}): {
  method: VerificationMethodEntry;
  children: VerificationMethodEntry[];
  nextSlot: number;
} {
  const topWeights = args.clause.map(clauseEntryWeight);
  const scaled = scaleWeights(topWeights);
  const children: VerificationMethodEntry[] = [];
  const conditionWeightedThreshold: Array<{ condition: string; weight: number }> = [];
  let slot = args.startSlot;
  let groupIndex = 0;

  for (const [entryIndex, entry] of args.clause.entries()) {
    if (typeof entry === "string") {
      conditionWeightedThreshold.push({
        condition: methodIdAt(args.methodIds, slot),
        weight: scaled.weights[entryIndex]!,
      });
      slot += 1;
      continue;
    }

    const [, members] = singleWeightedGroup(entry);
    const nestedWeights = members.map(parseWeight);
    const nestedScaled = scaleWeights(nestedWeights);
    const nestedConditions = members.map((_member, memberIndex) => ({
      condition: methodIdAt(args.methodIds, slot + memberIndex),
      weight: nestedScaled.weights[memberIndex]!,
    }));
    slot += members.length;

    const childId = `#${args.pre}-kt-c${args.clauseIndex}-g${groupIndex}`;
    groupIndex += 1;
    children.push({
      id: childId,
      type: "ConditionalProof2022",
      controller: args.did,
      threshold: nestedScaled.threshold,
      conditionWeightedThreshold: nestedConditions,
    });
    conditionWeightedThreshold.push({
      condition: childId,
      weight: scaled.weights[entryIndex]!,
    });
  }

  return {
    method: {
      id: args.id,
      type: "ConditionalProof2022",
      controller: args.did,
      threshold: scaled.threshold,
      conditionWeightedThreshold,
    },
    children,
    nextSlot: slot,
  };
}

function clauseEntryWeight(entry: ThresholdClauseEntry): Rational {
  if (typeof entry === "string") {
    return parseWeight(entry);
  }
  const [weight] = singleWeightedGroup(entry);
  return parseWeight(weight);
}

function singleWeightedGroup(entry: Record<string, string[]>): [string, string[]] {
  const keys = Object.keys(entry);
  if (keys.length !== 1) {
    throw new ValidationError("Nested weighted threshold groups must have exactly one key.");
  }
  const weight = keys[0]!;
  const members = entry[weight];
  if (!Array.isArray(members) || members.length === 0) {
    throw new ValidationError("Nested weighted threshold groups must contain member weights.");
  }
  return [weight, members];
}

function methodIdAt(methodIds: readonly string[], index: number): string {
  const methodId = methodIds[index];
  if (!methodId) {
    throw new ValidationError(`Weighted threshold references missing signer slot ${index}.`);
  }
  return methodId;
}

function parseWeight(input: string): Rational {
  const text = input.trim();
  if (/^\d+$/.test(text)) {
    return normalizeRational(BigInt(text), 1n);
  }
  const match = text.match(/^(\d+)\/(\d+)$/);
  if (!match) {
    throw new ValidationError(`Invalid threshold weight ${input}.`);
  }
  return normalizeRational(BigInt(match[1]!), BigInt(match[2]!));
}

function scaleWeights(weights: readonly Rational[]): { threshold: number; weights: number[] } {
  let common = 1n;
  for (const weight of weights) {
    common = lcm(common, weight.denominator);
  }
  return {
    threshold: safeNumber(common),
    weights: weights.map((weight) => safeNumber(weight.numerator * (common / weight.denominator))),
  };
}

function normalizeRational(numerator: bigint, denominator: bigint): Rational {
  if (denominator === 0n) {
    throw new ValidationError("Invalid threshold weight denominator=0.");
  }
  const divisor = gcd(numerator, denominator);
  return {
    numerator: numerator / divisor,
    denominator: denominator / divisor,
  };
}

function gcd(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a === 0n ? 1n : a;
}

function lcm(left: bigint, right: bigint): bigint {
  return (left / gcd(left, right)) * right;
}

function safeNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ValidationError(`Threshold weight scale ${value} exceeds safe JSON number range.`);
  }
  return Number(value);
}
