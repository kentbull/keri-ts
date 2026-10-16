/** Static and dynamic `did:webs` artifact routes. */
import {
  didWebsFromArtifactRequest,
  generateDidWebsArtifacts,
  generateDidWebsJson,
  ValidationError,
} from "keri-ts/runtime";
import type { ArtifactFiles } from "../artifact-files.ts";
import type { ProtocolRequestContext, ProtocolRoute } from "../types.ts";

/** Classify configured `did.json` and `keri.cesr` artifact routes. */
export function classifyDwsArtifactRoute(
  context: ProtocolRequestContext,
): ProtocolRoute | null {
  if (context.method !== "GET") {
    return null;
  }
  if (!context.policy.dwsDynamic && !context.policy.dwsStaticFilesDir) {
    return null;
  }
  const segments = context.pathname.split("/").filter((part) => part.length > 0);
  const configuredPath = didPathSegments(context.policy.dwsDidPath);
  if (!pathPrefixMatches(segments, configuredPath)) {
    return null;
  }
  const remaining = segments.slice(configuredPath.length);
  if (remaining.length !== 2) {
    return null;
  }
  const [aid, artifact] = remaining;
  if (artifact !== "did.json" && artifact !== "keri.cesr") {
    return null;
  }
  return { kind: "dwsArtifact", aid, artifact };
}

/** Serve one configured artifact route from dynamic state or static files. */
export async function handleDwsArtifactRoute(
  context: ProtocolRequestContext,
  route: Extract<ProtocolRoute, { kind: "dwsArtifact" }>,
  files: ArtifactFiles,
): Promise<Response> {
  if (context.policy.dwsDynamic && context.runtime && dynamicAidAllowed(context, route.aid)) {
    return dynamicArtifactResponse(context, route);
  }
  if (context.policy.dwsStaticFilesDir) {
    return await staticArtifactResponse(context, route, files);
  }
  return new Response("Not Found", {
    status: 404,
    headers: { "Content-Type": "text/plain" },
  });
}

function dynamicArtifactResponse(
  context: ProtocolRequestContext,
  route: Extract<ProtocolRoute, { kind: "dwsArtifact" }>,
): Response {
  try {
    const did = didWebsFromArtifactRequest({
      host: context.req.headers.get("host") ?? context.url.host,
      didPath: didPathSegments(context.policy.dwsDidPath),
      aid: route.aid,
    });
    const rgy = context.runtime?.vdr;
    if (!rgy) throw new ValidationError("Legacy credential registry is unavailable in this runtime.");
    const bytes = route.artifact === "did.json"
      ? generateDidWebsJson(rgy, { did }).didJson
      : generateDidWebsArtifacts(rgy, { did }).keriCesr;
    return new Response(bodyBuffer(bytes), {
      headers: {
        "Content-Type": route.artifact === "did.json" ? "application/did+json" : "application/cesr",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(message, {
      status: error instanceof ValidationError ? 400 : 500,
      headers: { "Content-Type": "text/plain" },
    });
  }
}

async function staticArtifactResponse(
  context: ProtocolRequestContext,
  route: Extract<ProtocolRoute, { kind: "dwsArtifact" }>,
  files: ArtifactFiles,
): Promise<Response> {
  const root = context.policy.dwsStaticFilesDir!;
  try {
    const path = staticArtifactPath(root, context.policy.dwsDidPath, route.aid, route.artifact);
    return await files.response(
      path,
      route.artifact === "did.json" ? "application/did+json" : "application/cesr",
      context.req.signal,
    );
  } catch (error) {
    if (error instanceof ValidationError) {
      return new Response(error.message, {
        status: 400,
        headers: { "Content-Type": "text/plain" },
      });
    }
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain" } });
    }
    throw error;
  }
}

function bodyBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function dynamicAidAllowed(context: ProtocolRequestContext, aid: string): boolean {
  const hosted = context.policy.hostedPrefixes ?? [];
  return hosted.includes(aid);
}

function staticArtifactPath(
  root: string,
  didPath: string | undefined,
  aid: string,
  artifact: "did.json" | "keri.cesr",
): string {
  const normalizedRoot = root.replace(/\/+$/u, "");
  const prefix = didPathSegments(didPath).map(safeSegment).join("/");
  const parts = [normalizedRoot, prefix, safeSegment(aid), artifact].filter((part) => part.length > 0);
  return parts.join("/");
}

function didPathSegments(path: string | undefined): string[] {
  return (path ?? "").split("/").filter((part) => part.length > 0);
}

function pathPrefixMatches(
  segments: readonly string[],
  prefix: readonly string[],
): boolean {
  if (segments.length < prefix.length) {
    return false;
  }
  return prefix.every((part, index) => segments[index] === part);
}

function safeSegment(segment: string): string {
  if (segment.includes("/") || segment === ".." || segment.includes("\0")) {
    throw new ValidationError(`Unsafe path segment ${segment}.`);
  }
  return segment;
}
