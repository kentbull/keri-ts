/** Universal Resolver compatible DID route. */
import { run } from "effection";
import {
  didResolutionError,
  parseDidKeriIdentifier,
  requireRegery,
  resolveDidKeri,
  type ResolveDidKeriResult,
  resolveDidWebs,
  type ResolveDidWebsResult,
  runtimeOobiConverged,
} from "keri-ts/runtime";
import type { ProtocolRequestContext, ProtocolRoute } from "../types.ts";

const IDENTIFIERS_PREFIX = "/1.0/identifiers/";

/** Classify `/1.0/identifiers/{did}` requests. */
export function classifyDidResolutionRoute(
  context: ProtocolRequestContext,
): ProtocolRoute | null {
  if (context.method !== "GET" || !context.pathname.startsWith(IDENTIFIERS_PREFIX)) {
    return null;
  }
  const encoded = context.pathname.slice(IDENTIFIERS_PREFIX.length);
  if (encoded.length === 0) {
    return null;
  }
  return { kind: "didResolution", did: decodeDidIdentifierPath(encoded) };
}

/** Handle one Universal Resolver request. */
export async function handleDidResolutionRoute(
  context: ProtocolRequestContext,
  did: string,
): Promise<Response> {
  const meta = wantsResolutionResult(context.req, context.url);
  if (!context.runtime) {
    return jsonResponse(
      didResolutionError("internalError", "DID resolver runtime is not available."),
      500,
    );
  }
  try {
    const oobis = context.url.searchParams.getAll("oobi");
    let result: ResolveDidKeriResult | ResolveDidWebsResult | null = null;
    if (did.startsWith("did:webs:") || did.startsWith("did:web:")) {
      result = await run(() =>
        resolveDidWebs(context.runtime!, {
          did,
          metadata: meta,
          insecureHttp: context.policy.dwsInsecureHttp ?? false,
        })
      );
    } else if (did.startsWith("did:keri:")) {
      const canonical = parseDidKeriIdentifier(did).canonical;
      // The host owns workers. This request only queues introductions and observes state.
      for (const oobi of oobis) context.runtime.oobiery.resolve(oobi);
      const deadline = Date.now() + 30_000;
      while (!oobis.every((url) => runtimeOobiConverged(context.runtime!, url))) {
        context.req.signal.throwIfAborted();
        if (Date.now() >= deadline) throw new Error("DID introductions did not converge within 30000ms.");
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      result = resolveDidKeri(context.runtime.hby, requireRegery(context.runtime), canonical);
    }
    if (!result) {
      return jsonResponse(
        didResolutionError("methodNotSupported", `Unsupported DID method for ${did}.`),
        meta ? 200 : 400,
      );
    }
    return jsonResponse(
      meta ? result.resolution : result.document,
      200,
      meta ? "application/did-resolution+json" : "application/did+json",
    );
  } catch (error) {
    return jsonResponse(
      didResolutionError(
        "notFound",
        error instanceof Error ? error.message : String(error),
      ),
      meta ? 200 : 404,
    );
  }
}

function wantsResolutionResult(req: Request, url: URL): boolean {
  if (url.searchParams.get("meta") === "true") {
    return true;
  }
  return (req.headers.get("accept") ?? "").toLowerCase().includes("application/did-resolution");
}

function decodeDidIdentifierPath(encoded: string): string {
  if (encoded.startsWith("did:")) {
    return encoded;
  }
  try {
    const decoded = decodeURIComponent(encoded);
    return decoded.startsWith("did:") ? decoded : encoded;
  } catch {
    return encoded;
  }
}

function jsonResponse(
  body: unknown,
  status = 200,
  contentType = "application/did+json",
): Response {
  return new Response(`${JSON.stringify(body, null, 2)}\n`, {
    status,
    headers: { "Content-Type": contentType },
  });
}
