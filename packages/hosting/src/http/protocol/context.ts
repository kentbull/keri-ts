/**
 * Request-context construction for Tufa protocol routing.
 *
 * The router is path-first: every endpoint classifier receives the same
 * normalized path plus hosted-prefix projections, so mailbox admin, OOBI, and
 * generic CESR ingress cannot disagree about which local AID a URL addresses.
 */
import { type AgentRuntime, type ProtocolHostPolicy, resolveHostedEndpointPath } from "keri-ts/runtime";
import { parseOobiRouteRequest } from "./endpoints/oobi.ts";
import type { ProtocolRequestContext } from "./types.ts";

/** Snapshot one request into the path-first routing context. */
export function buildProtocolRequestContext(
  req: Request,
  runtime?: AgentRuntime,
  policy: ProtocolHostPolicy = {},
): ProtocolRequestContext {
  const url = new URL(req.url);
  const pathname = normalizeProtocolPath(url.pathname);
  // Resolve the same normalized path against the three hosted path shapes used
  // by the HTTP edge: plain hosted endpoints, mailbox admin endpoints, and
  // generic root-relative CESR ingress.
  const hosted = runtime
    ? resolveHostedEndpointPath(
      runtime.hby,
      pathname,
      "",
      policy.hostedPrefixes,
    )
    : null;
  const mailboxAdmin = runtime
    ? resolveHostedEndpointPath(
      runtime.hby,
      pathname,
      "/mailboxes",
      policy.hostedPrefixes,
    )
    : null;
  const genericIngress = runtime
    ? resolveHostedEndpointPath(
      runtime.hby,
      pathname,
      "/",
      policy.hostedPrefixes,
    )
    : null;
  const oobiPath = hosted?.relativePath ?? pathname;

  return {
    req,
    url,
    pathname,
    method: req.method,
    runtime,
    policy,
    hosted,
    mailboxAdmin,
    genericIngress,
    oobi: parseOobiRouteRequest(oobiPath),
  };
}

/** Normalize incoming request paths into the comparison form used by routing. */
export function normalizeProtocolPath(pathname: string): string {
  const trimmed = pathname.trim();
  if (trimmed.length === 0 || trimmed === "/") {
    return "/";
  }
  const normalized = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return normalized.replace(/\/+$/, "") || "/";
}
