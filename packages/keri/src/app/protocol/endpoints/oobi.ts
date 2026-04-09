import { Roles } from "../../../core/roles.ts";
import type { AgentRuntime } from "../../agent-runtime.ts";
import type { Hab } from "../../habbing.ts";
import { endpointBasePath, fetchEndpointUrls, preferredUrl } from "../../mailboxing.ts";
import { textResponse } from "../responses.ts";
import type { OobiRouteRequest, ProtocolRequestContext, ProtocolRoute } from "../types.ts";

/** Parse one OOBI-style request path into its route semantics. */
export function parseOobiRouteRequest(
  pathname: string,
): OobiRouteRequest | null {
  const parts = pathname.split("/").filter((part) => part.length > 0);

  if (
    parts.length >= 4
    && parts[0] === ".well-known"
    && parts[1] === "keri"
    && parts[2] === "oobi"
  ) {
    return {
      kind: "wellKnown",
      aid: parts[3] ?? null,
      role: Roles.controller,
    };
  }

  if (parts[0] === "oobi") {
    return {
      kind: "oobi",
      aid: parts[1] ?? null,
      role: parts[2],
      eid: parts[3],
    };
  }

  return null;
}

/** Classify OOBI requests after mailbox-admin and witness-specific routes. */
export function classifyOobiRoute(
  context: ProtocolRequestContext,
): ProtocolRoute | null {
  if (!context.runtime || !context.oobi) {
    return null;
  }
  if (context.hosted?.kind === "ambiguous" && context.options.hostedPrefixes) {
    return {
      kind: "ambiguousHostedPath",
      message: "Ambiguous hosted endpoint path",
    };
  }
  return { kind: "oobi", request: context.oobi };
}

/** Serve one OOBI request from local accepted habitat state. */
export function handleOobiRoute(
  context: ProtocolRequestContext,
  request: OobiRouteRequest,
): Response {
  const runtime = context.runtime!;
  const aid = request.aid ?? defaultOobiAid(
    runtime,
    context.options.serviceHab,
    context.options.hostedPrefixes,
  );
  if (!aid) {
    return textResponse("no blind oobi for this node", 404);
  }

  const hosted = context.hosted ?? {
    kind: "none",
    endpoint: null,
    relativePath: null,
  };
  const respondingHabAid = selectResponderHab(
    runtime,
    hosted,
    aid,
    request.eid,
    context.options.hostedPrefixes,
  );
  const hab = respondingHabAid ? runtime.hby.habs.get(respondingHabAid) : undefined;
  if (!hab) {
    if (hosted.kind === "ambiguous" && context.options.hostedPrefixes) {
      return textResponse("Ambiguous hosted endpoint path", 409);
    }
    return textResponse("Not Found", 404);
  }

  const msgs = hab.replyToOobi(aid, request.role, request.eid ? [request.eid] : []);
  if (msgs.length === 0) {
    return textResponse("Not Found", 404);
  }

  return new Response(new Blob([msgs.slice().buffer as ArrayBuffer]), {
    status: 200,
    headers: {
      "Content-Type": "application/cesr",
      "KERI-AID": aid,
      "Oobi-Aid": aid,
    },
  });
}

/**
 * Pick the default local AID whose Hab should answer a blind OOBI request when
 * the request omits an AID.
 */
export function defaultOobiAid(
  runtime: AgentRuntime,
  serviceHab?: Hab,
  hostedPrefixes?: readonly string[],
): string | undefined {
  if (serviceHab?.pre) {
    return serviceHab.pre;
  }
  if (hostedPrefixes?.length === 1) {
    const candidate = hostedPrefixes[0];
    if (candidate && runtime.hby.habs.has(candidate)) {
      return candidate;
    }
  }
  if (runtime.hby.habs.size === 1) {
    return runtime.hby.habs.keys().next().value as string | undefined;
  }
  return undefined;
}

/**
 * Choose which local Hab should answer an OOBI request and return that Hab's
 * AID.
 *
 * Preference order:
 * - the requested AID itself when locally controlled
 * - the explicit endpoint AID when it is locally controlled
 * - the hosted endpoint matched from the request path
 */
export function selectResponderHab(
  runtime: AgentRuntime,
  hosted: {
    kind: "none" | "one" | "ambiguous";
    endpoint: { eid: string; url: string; basePath: string } | null;
  },
  aid: string,
  eid?: string,
  hostedPrefixes?: readonly string[],
): string | undefined {
  const hostedSet = hostedPrefixes ? new Set(hostedPrefixes) : null;
  const hostedCandidate = (candidate?: string): string | undefined => {
    if (!candidate || !runtime.hby.habs.has(candidate)) {
      return undefined;
    }
    if (hostedSet && !hostedSet.has(candidate)) {
      return undefined;
    }
    return candidate;
  };
  const rootHostedCandidate = (candidate?: string): string | undefined => {
    if (!candidate || !runtime.hby.habs.has(candidate)) {
      return undefined;
    }
    if (hostedSet && !hostedSet.has(candidate)) {
      return undefined;
    }
    const preferred = preferredUrl(fetchEndpointUrls(runtime.hby, candidate));
    if (!preferred || endpointBasePath(preferred) !== "/") {
      return undefined;
    }
    return candidate;
  };

  if (hostedSet) {
    if (hosted.kind === "ambiguous") {
      return undefined;
    }
    if (hosted.kind === "one") {
      const hostedAid = hosted.endpoint?.eid;
      if (
        hostedAid
        && runtime.hby.habs.has(hostedAid)
        && (aid === hostedAid || eid === hostedAid)
      ) {
        return hostedAid;
      }
      return undefined;
    }
    return hostedCandidate(aid)
      ?? hostedCandidate(eid)
      ?? rootHostedCandidate(aid)
      ?? rootHostedCandidate(eid);
  }

  if (runtime.hby.habs.has(aid)) {
    return aid;
  }
  if (eid && runtime.hby.habs.has(eid)) {
    return eid;
  }
  return hosted.endpoint?.eid ?? undefined;
}
