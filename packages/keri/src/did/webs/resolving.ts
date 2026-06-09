/**
 * Verified `did:webs` resolution.
 *
 * Resolution succeeds only when hosted `did.json` matches the DID document
 * regenerated from the fetched `keri.cesr` KERI/VDR stream.
 */
import { action, type Operation } from "effection";
import type { AgentRuntime } from "../../app/agent-runtime.ts";
import { settleRuntimeIngress } from "../../app/agent-runtime.ts";
import { fetchResponseHandle } from "../../app/httping.ts";
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
export function* resolveDidWebs(
  runtime: AgentRuntime,
  options: ResolveDidWebsOptions,
): Operation<ResolveDidWebsResult> {
  const parsed = parseDidWebs(options.did);
  const urls = didWebsArtifactUrls(parsed, { scheme: "https" });
  const fallbackUrls = didWebsArtifactUrls(parsed, { scheme: "http" });
  pinDesignatedAliasesSchema(runtime);
  const cesr = yield* fetchBytesWithFallback(
    urls.keriCesr,
    fallbackUrls.keriCesr,
    options.insecureHttp ?? false,
  );
  settleRuntimeIngress(runtime, [cesr], { local: false });
  runtime.reactor.processEscrowsOnce();
  const expected = generateBareDidDocument(runtime, parsed.canonical);
  const hosted = yield* fetchJsonWithFallback(
    urls.didJson,
    fallbackUrls.didJson,
    options.insecureHttp ?? false,
  );
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

function* fetchBytes(url: string): Operation<Uint8Array> {
  const { response } = yield* fetchResponseHandle(url);
  if (!response.ok) {
    yield* closeBody(response);
    throw new ValidationError(`Unable to fetch ${url}: HTTP ${response.status}.`);
  }
  return yield* readResponseBytes(response);
}

function* fetchBytesWithFallback(
  httpsUrl: string,
  httpUrl: string,
  preferHttp: boolean,
): Operation<Uint8Array> {
  const urls = preferHttp ? [httpUrl, httpsUrl] : [httpsUrl, httpUrl];
  let lastError: unknown;
  for (const url of [...new Set(urls)]) {
    try {
      return yield* fetchBytes(url);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new ValidationError(String(lastError));
}

function* fetchJsonWithFallback(
  httpsUrl: string,
  httpUrl: string,
  preferHttp: boolean,
): Operation<unknown> {
  const bytes = yield* fetchBytesWithFallback(httpsUrl, httpUrl, preferHttp);
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch (error) {
    throw new ValidationError(
      `Unable to parse DID JSON from ${preferHttp ? httpUrl : httpsUrl}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function* readResponseBytes(response: Response): Operation<Uint8Array> {
  return yield* action<Uint8Array>((resolve, reject) => {
    response.arrayBuffer()
      .then((buffer) => resolve(new Uint8Array(buffer)))
      .catch(reject);
    return () => {};
  });
}

function* closeBody(response: Response): Operation<void> {
  if (!response.body) {
    return;
  }
  yield* action<void>((resolve) => {
    void response.body!.cancel().finally(() => resolve(undefined));
    return () => {};
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
