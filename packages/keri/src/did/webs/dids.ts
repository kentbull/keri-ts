/**
 * DID parsing and canonicalization for `did:webs`, hosted `did:web`, and
 * `did:keri` identifiers.
 *
 * Responsibilities:
 * - keep encoded host/port handling deterministic
 * - identify the terminal AID segment used by `did:webs`
 * - derive artifact URLs without trusting hosted JSON
 */
import { ValidationError } from "../../core/errors.ts";

export type DidMethod = "webs" | "web" | "keri";

export interface DidQueryParts {
  readonly did: string;
  readonly query: string;
  readonly fragment: string;
}

export interface ParsedDidWebs {
  readonly kind: "webs" | "web";
  readonly raw: string;
  readonly canonical: string;
  readonly method: "webs" | "web";
  readonly host: string;
  readonly encodedHost: string;
  readonly path: readonly string[];
  readonly aid: string;
  readonly query: string;
  readonly fragment: string;
}

export interface ParsedDidKeri {
  readonly kind: "keri";
  readonly raw: string;
  readonly canonical: string;
  readonly method: "keri";
  readonly aid: string;
  readonly query: string;
  readonly fragment: string;
}

export type ParsedDid = ParsedDidWebs | ParsedDidKeri;

export interface DidWebsArtifactUrls {
  readonly didJson: string;
  readonly keriCesr: string;
}

/** Split one DID into identifier, query, and fragment components. */
export function splitDidQuery(input: string): DidQueryParts {
  const hashIndex = input.indexOf("#");
  const beforeFragment = hashIndex >= 0 ? input.slice(0, hashIndex) : input;
  const fragment = hashIndex >= 0 ? input.slice(hashIndex + 1) : "";
  const queryIndex = beforeFragment.indexOf("?");
  return {
    did: queryIndex >= 0 ? beforeFragment.slice(0, queryIndex) : beforeFragment,
    query: queryIndex >= 0 ? beforeFragment.slice(queryIndex + 1) : "",
    fragment,
  };
}

/** Parse supported DID methods into a canonical descriptor. */
export function parseDid(input: string): ParsedDid {
  const trimmed = input.trim();
  if (!trimmed.startsWith("did:")) {
    throw new ValidationError(`Unsupported DID ${input}.`);
  }
  const parts = splitDidQuery(trimmed);
  const [, method, ...methodParts] = parts.did.split(":");
  switch (method) {
    case "webs":
    case "web":
      return parseDidWebLike(trimmed, method, methodParts, parts);
    case "keri":
      return parseDidKeri(trimmed, methodParts, parts);
    default:
      throw new ValidationError(`Unsupported DID method ${method}.`);
  }
}

/** Return true when a value looks like a supported or opaque DID string. */
export function isDidString(value: string): boolean {
  return /^did:[a-z0-9]+:/u.test(value);
}

/** Parse and require a `did:webs` or hosted `did:web` descriptor. */
export function parseDidWebs(input: string): ParsedDidWebs {
  const parsed = parseDid(input);
  if (parsed.kind !== "webs" && parsed.kind !== "web") {
    throw new ValidationError(`Expected did:webs or did:web, got ${input}.`);
  }
  return parsed;
}

/** Parse and require a `did:keri` descriptor. */
export function parseDidKeriIdentifier(input: string): ParsedDidKeri {
  const parsed = parseDid(input);
  if (parsed.kind !== "keri") {
    throw new ValidationError(`Expected did:keri, got ${input}.`);
  }
  return parsed;
}

/** Convert a canonical `did:webs` descriptor to the hosted `did:web` form. */
export function toHostedDidWeb(input: string | ParsedDidWebs): string {
  const parsed = typeof input === "string" ? parseDidWebs(input) : input;
  return didWebLike("web", parsed.encodedHost, parsed.path, parsed.aid);
}

/** Convert a hosted `did:web` descriptor to canonical `did:webs` form. */
export function toCanonicalDidWebs(input: string | ParsedDidWebs): string {
  const parsed = typeof input === "string" ? parseDidWebs(input) : input;
  return didWebLike("webs", parsed.encodedHost, parsed.path, parsed.aid);
}

/** Build artifact URLs for one canonical `did:webs` identifier. */
export function didWebsArtifactUrls(
  input: string | ParsedDidWebs,
  options: { readonly scheme?: "https" | "http" } = {},
): DidWebsArtifactUrls {
  const parsed = typeof input === "string" ? parseDidWebs(input) : input;
  const path = [...parsed.path, parsed.aid].map(encodeURIComponent).join("/");
  const basePath = path.length > 0 ? `/${path}` : "";
  const base = `${options.scheme ?? "https"}://${parsed.host}${basePath}`;
  return {
    didJson: `${base}/did.json${parsed.query ? `?${parsed.query}` : ""}`,
    keriCesr: `${base}/keri.cesr`,
  };
}

/**
 * Build the canonical `did:webs` identifier represented by one HTTP artifact
 * request.
 */
export function didWebsFromArtifactRequest(args: {
  readonly host: string;
  readonly didPath: readonly string[];
  readonly aid: string;
}): string {
  const host = args.host.trim();
  if (host.length === 0) {
    throw new ValidationError("Artifact request is missing host.");
  }
  return didWebLike("webs", encodeHost(host), args.didPath, args.aid);
}

/**
 * Normalize one hosted DID document by replacing its `did:web` form with the
 * canonical `did:webs` form used for resolver comparison.
 */
export function normalizeHostedDidDocument<T>(
  document: T,
  canonicalDid: string,
): T {
  const canonical = parseDidWebs(canonicalDid);
  const hostedDid = toHostedDidWeb(canonical);
  return replaceStringValues(document, hostedDid, toCanonicalDidWebs(canonical));
}

function parseDidWebLike(
  raw: string,
  method: "webs" | "web",
  methodParts: string[],
  query: DidQueryParts,
): ParsedDidWebs {
  if (methodParts.length < 2) {
    throw new ValidationError(`DID ${raw} must include host and AID segments.`);
  }
  const encodedHost = methodParts[0];
  if (!encodedHost) {
    throw new ValidationError(`DID ${raw} is missing host.`);
  }
  if (
    !encodedHost.includes("%3A")
    && !encodedHost.includes("%3a")
    && methodParts[1] !== undefined
    && /^\d+$/u.test(methodParts[1])
  ) {
    throw new ValidationError(
      `DID ${raw} must encode host ports as %3A, not raw colon separators.`,
    );
  }
  const aid = methodParts[methodParts.length - 1];
  if (!aid) {
    throw new ValidationError(`DID ${raw} is missing terminal AID segment.`);
  }
  const path = methodParts.slice(1, -1).map(decodeURIComponent);
  const normalizedHost = decodeHost(encodedHost);
  const canonical = didWebLike(method, encodeHost(normalizedHost), path, aid);
  return {
    kind: method,
    raw,
    canonical,
    method,
    host: normalizedHost,
    encodedHost: encodeHost(normalizedHost),
    path,
    aid,
    query: query.query,
    fragment: query.fragment,
  };
}

function parseDidKeri(
  raw: string,
  methodParts: string[],
  query: DidQueryParts,
): ParsedDidKeri {
  const aid = methodParts[0];
  if (!aid || methodParts.length !== 1) {
    throw new ValidationError(`DID ${raw} must be did:keri:<aid>.`);
  }
  return {
    kind: "keri",
    raw,
    canonical: `did:keri:${aid}`,
    method: "keri",
    aid,
    query: query.query,
    fragment: query.fragment,
  };
}

function didWebLike(
  method: "webs" | "web",
  encodedHost: string,
  path: readonly string[],
  aid: string,
): string {
  return [
    "did",
    method,
    encodedHost,
    ...path.map(encodeURIComponent),
    aid,
  ].join(":");
}

function encodeHost(host: string): string {
  return host.replaceAll(":", "%3A");
}

function decodeHost(encodedHost: string): string {
  try {
    return decodeURIComponent(encodedHost);
  } catch (error) {
    throw new ValidationError(
      `Invalid DID host encoding: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function replaceStringValues<T>(
  value: T,
  from: string,
  to: string,
): T {
  if (typeof value === "string") {
    return value.replaceAll(from, to) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => replaceStringValues(item, from, to)) as T;
  }
  if (typeof value === "object" && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = replaceStringValues(item, from, to);
    }
    return result as T;
  }
  return value;
}
