/**
 * Verified `did:webs` resolution.
 *
 * Resolution succeeds only when hosted `did.json` matches the DID document
 * regenerated from the fetched `keri.cesr` KERI/VDR stream.
 */

import { call, type Operation } from "effection";
import { abortable } from "../../app/abortable.ts";
import type { AgentRuntime } from "../../app/agent-runtime.ts";
import { collectBytes, streamBytes } from "../../app/byte-source.ts";
import { requireRegery } from "../../app/credential-workflows.ts";
import { defaultRuntimeHttpClient, type RuntimeHttpClient } from "../../app/runtime-services.ts";
import { ValidationError } from "../../core/errors.ts";
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
  runtime: AgentRuntime,
  options: ResolveDidWebsOptions,
): Operation<ResolveDidWebsResult> {
  return call(() => resolveArtifacts(runtime, options));
}

/** Keep finite JSON ownership local even when a long-lived caller resolves multiple DIDs. */
function* resolveArtifacts(runtime: AgentRuntime, options: ResolveDidWebsOptions): Operation<ResolveDidWebsResult> {
  const parsed = parseDidWebs(options.did);
  const urls = didWebsArtifactUrls(parsed, { scheme: "https" });
  const fallbackUrls = didWebsArtifactUrls(parsed, { scheme: "http" });
  pinDesignatedAliasesSchema(runtime.hby.db);
  const preferHttp = options.insecureHttp ?? false;
  yield* call(function*() {
    yield* runtime.reactor.process(
      (signal) => artifactBytes(runtime.services.http, urls.keriCesr, fallbackUrls.keriCesr, preferHttp, signal),
      { local: false },
    );
  });
  // EOF and parser cleanup precede convergence and any claim of a complete DID.
  yield* runtime.reactor.processEscrowsOnce();
  // Preserve the second convergence turn previously run after settleRuntimeIngress's own pass.
  yield* runtime.reactor.processEscrowsOnce();
  const expected = generateBareDidDocument(runtime.hby, requireRegery(runtime), parsed.canonical);
  const bytes = yield* abortable((signal) =>
    collectBytes(artifactBytes(runtime.services.http, urls.didJson, fallbackUrls.didJson, preferHttp, signal))
  );
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

/** Native header transport fallback only; a started body never retries another artifact URL. */
async function* artifactBytes(
  http: RuntimeHttpClient,
  httpsUrl: string,
  httpUrl: string,
  preferHttp: boolean,
  signal: AbortSignal,
): AsyncGenerator<Uint8Array> {
  const urls = preferHttp ? [httpUrl, httpsUrl] : [httpsUrl, httpUrl];
  let lastError: unknown;
  for (const url of urls) {
    signal.throwIfAborted();
    let response: Response;
    try {
      response = await http.fetch(url, { signal });
    } catch (error) {
      signal.throwIfAborted();
      // Injected clients can throw programmer/infrastructure TypeErrors; never recast those as transport.
      if (http !== defaultRuntimeHttpClient || !(error instanceof TypeError)) throw error;
      lastError = error;
      continue;
    }
    let readerOwnsBody = false;
    try {
      signal.throwIfAborted();
      if (!response.ok) {
        lastError = new ValidationError(`Unable to fetch ${url}: HTTP ${response.status}.`);
        continue;
      }
      readerOwnsBody = true;
      yield* streamBytes(response.body, { signal });
      return;
    } finally {
      // The shared reader owns started-body cancellation; dispose only unacquired/failed headers here.
      if (!readerOwnsBody && response.body) await response.body.cancel();
    }
  }
  throw lastError;
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
