/**
 * Verified `did:webs` resolution.
 *
 * Resolution succeeds only when hosted `did.json` matches the DID document
 * regenerated from the fetched `keri.cesr` KERI/VDR stream.
 */
import type { HttpStreamResponse } from "../../app/http-client.ts";
import { TransportError } from "../../app/transport-error.ts";

import { call, type Operation, resource, scoped } from "effection";
import { abortable } from "../../app/abortable.ts";
import { collectBytes } from "../../app/byte-source.ts";
import { type HttpClient } from "../../app/http-client.ts";
import type { Reactor } from "../../app/reactor.ts";
import { ValidationError } from "../../core/errors.ts";
import type { Regery } from "../../vdr/credentialing.ts";
import { pinDesignatedAliasesSchema } from "./designated-aliases.ts";
import { didWebsArtifactUrls, normalizeHostedDidDocument, parseDidWebs } from "./dids.ts";
import {
  type DidDocument,
  type DidResolutionResult,
  didResolutionResult,
  generateBareDidDocument,
} from "./documenting.ts";

export interface ResolveDidWebsOptions {
  readonly did: string;
  readonly metadata?: boolean;
  readonly insecureHttp?: boolean;
}

export interface ResolveDidWebsResult {
  readonly did: string;
  readonly document: DidDocument;
  readonly resolution: DidResolutionResult;
}

/** Resolve one `did:webs` by fetching and verifying hosted artifacts. */
export function resolveDidWebs(
  rgy: Regery,
  reactor: Reactor,
  http: HttpClient,
  options: ResolveDidWebsOptions,
): Operation<ResolveDidWebsResult> {
  return call(() => resolveArtifacts(rgy, reactor, http, options));
}

/** Keep finite JSON ownership local even when a long-lived caller resolves multiple DIDs. */
function* resolveArtifacts(
  rgy: Regery,
  reactor: Reactor,
  http: HttpClient,
  options: ResolveDidWebsOptions,
): Operation<ResolveDidWebsResult> {
  const parsed = parseDidWebs(options.did);
  const urls = didWebsArtifactUrls(parsed, { scheme: "https" });
  const fallbackUrls = didWebsArtifactUrls(parsed, { scheme: "http" });
  pinDesignatedAliasesSchema(rgy.hby.db);
  const preferHttp = options.insecureHttp ?? false;
  yield* call(function*() {
    const response = yield* artifactResponse(http, urls.keriCesr, fallbackUrls.keriCesr, preferHttp);
    yield* reactor.process((signal) => response.body(signal), { local: false });
  });
  // EOF and parser cleanup precede convergence and any claim of a complete DID.
  yield* reactor.protocol.processEscrowsOnce();
  // Preserve the second convergence turn previously run after settleRuntimeIngress's own pass.
  yield* reactor.protocol.processEscrowsOnce();
  const expected = generateBareDidDocument(rgy.hby, rgy, parsed.canonical);
  const bytes = yield* call(function*() {
    const response = yield* artifactResponse(http, urls.didJson, fallbackUrls.didJson, preferHttp);
    return yield* abortable((signal) => collectBytes(response.body(signal)));
  });
  let hosted: unknown;
  try {
    hosted = JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new ValidationError(`Unable to parse DID JSON: ${error.message}`);
  }
  const hostedDocument = hostedDidDocument(hosted);
  const normalized = normalizeHostedDidDocument(hostedDocument, parsed.canonical);
  assertSameDocument(expected, normalized);
  const resolution = didResolutionResult(expected);
  return {
    did: parsed.canonical,
    document: expected,
    resolution,
  };
}

/** Try alternate artifact URLs only while opening headers; a borrowed body never starts another attempt. */
function artifactResponse(
  http: HttpClient,
  httpsUrl: string,
  httpUrl: string,
  preferHttp: boolean,
): Operation<HttpStreamResponse> {
  return resource<HttpStreamResponse>(function*(provide) {
    const urls = preferHttp ? [httpUrl, httpsUrl] : [httpsUrl, httpUrl];
    let lastError: unknown;
    for (const url of urls) {
      let receivedHeaders = false;
      // Each unsuccessful request finishes cleanup before another URL may be attempted.
      try {
        const delivered = yield* scoped(function*() {
          const response = yield* http.open(url);
          receivedHeaders = true;
          if (!response.ok) {
            lastError = new ValidationError(`Unable to fetch ${url}: HTTP ${response.status}.`);
            return false;
          }
          // Keep the request open for protocol/JSON consumption, after the fallback decision.
          yield* provide(response);
          return true;
        });
        if (delivered) return;
      } catch (error) {
        if (receivedHeaders || !(error instanceof TransportError)) throw error;
        lastError = error;
      }
    }
    throw lastError;
  });
}

function hostedDidDocument(value: unknown): DidDocument {
  if (!isRecord(value)) {
    throw new ValidationError("Hosted did.json must be a JSON object.");
  }
  const maybeDocument = isRecord(value.didDocument) ? value.didDocument : value;
  if (typeof maybeDocument.id !== "string") {
    throw new ValidationError("Hosted DID document is missing id.");
  }
  return maybeDocument as DidDocument;
}

function assertSameDocument(
  expected: DidDocument,
  actual: DidDocument,
): void {
  const expectedJson = canonicalJson(expected);
  const actualJson = canonicalJson(actual);
  if (expectedJson !== actualJson) {
    throw new ValidationError(
      `Hosted did.json does not match KERI/VDR state. Expected ${expectedJson}; got ${actualJson}.`,
    );
  }
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortJson(item)]),
    );
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
