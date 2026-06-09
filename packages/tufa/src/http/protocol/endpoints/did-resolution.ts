/** Universal Resolver compatible DID route. */
import { run } from "effection";
import {
  didResolutionError,
  resolveDidKeri,
  resolveDidWebs,
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
    const result = did.startsWith("did:webs:") || did.startsWith("did:web:")
      ? await run(() =>
        resolveDidWebs(context.runtime!, {
          did,
          metadata: meta,
          insecureHttp: context.policy.dwsInsecureHttp ?? false,
        })
      )
      : did.startsWith("did:keri:")
      ? await run(() =>
        resolveDidKeri(context.runtime!, {
          did,
          oobis,
          metadata: meta,
        })
      )
      : null;
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
