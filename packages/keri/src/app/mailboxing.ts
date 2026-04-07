/**
 * Shared mailbox utility helpers.
 *
 * This module keeps the mailbox ownership and routing rules that multiple
 * higher-level components rely on:
 * - `MailboxDirector` needs topic keys and cursor helpers
 * - `Poster` and mailbox pollers need endpoint selection rules
 * - the HTTP server needs hosted-endpoint and base-path resolution
 *
 * KERIpy correspondence:
 * - these helpers gather logic that is split across mailbox, forwarding, and
 *   indirect-mode support in KERIpy
 *
 * Current `keri-ts` difference:
 * - endpoint base-path resolution is explicit here because the Fetch/Node host
 *   layer serves both root and non-root mailbox/OOBI paths
 */
import type { Operation } from "npm:effection@^3.6.0";
import { TopicsRecord } from "../core/records.ts";
import { Roles } from "../core/roles.ts";
import {
  createMailboxer,
  type Mailboxer,
  type MailboxerOptions,
} from "../db/mailboxing.ts";
import type { OutboxerLike } from "../db/outboxing.ts";
import type { Hab, Habery } from "./habbing.ts";

/**
 * Derive mailbox open options from one existing habery.
 *
 * This is the supported bridge from core habery state to the additive
 * provider-side mailbox store lifecycle.
 */
export function mailboxerOptionsForHabery(
  hby: Habery,
  options: Partial<MailboxerOptions> = {},
): MailboxerOptions {
  return {
    name: hby.name,
    base: hby.base,
    temp: hby.temp,
    headDirPath: hby.headDirPath,
    compat: hby.compat,
    readonly: hby.readonly,
    reopen: true,
    ...options,
  };
}

/**
 * Open the provider-side mailbox sidecar corresponding to one habery.
 *
 * Ownership rule:
 * - this helper only derives open settings from habery state
 * - the caller that opens the mailboxer owns its lifecycle
 */
export function* openMailboxerForHabery(
  hby: Habery,
  options: Partial<MailboxerOptions> = {},
): Operation<Mailboxer> {
  return yield* createMailboxer(mailboxerOptionsForHabery(hby, options));
}

/** Return the habery-owned sender retry sidecar when enabled. */
export function getOutboxer(hby: Habery): OutboxerLike {
  return hby.obx;
}

/**
 * Build the stored mailbox topic key used by KERIpy-style mailbox storage.
 *
 * Topic buckets are normalized as `pre/topic`, with `topic` already carrying
 * the leading slash when it is a protocol mailbox topic like `/challenge`.
 */
export function mailboxTopicKey(pre: string, topic: string): string {
  return topic.startsWith("/") ? `${pre}${topic}` : `${pre}/${topic}`;
}

/**
 * Build the next `mbx` query cursor map for one `(pre, eid)` remote mailbox.
 *
 * Cursor records store the last seen ordinal, while mailbox queries ask for
 * the next ordinal wanted.
 */
export function mailboxQueryTopics(
  hby: Habery,
  pre: string,
  witness: string,
  topics: Iterable<string>,
): Record<string, number> {
  const record = mailboxRemoteCursorRecord(hby, pre, witness);
  const cursor: Record<string, number> = {};
  for (const topic of topics) {
    cursor[topic] = topic in record.topics ? record.topics[topic]! + 1 : 0;
  }
  return cursor;
}

/**
 * Persist one consumed remote mailbox index for one `(pre, eid, topic)` tuple.
 *
 * These cursors live in `Baser.tops` because they describe the consumer's
 * remote poll progress, not the provider's stored inbox contents.
 */
export function updateMailboxRemoteCursor(
  hby: Habery,
  pre: string,
  witness: string,
  topic: string,
  idx: number,
): void {
  const record = mailboxRemoteCursorRecord(hby, pre, witness);
  record.topics[topic] = idx;
  hby.db.tops.pin([pre, witness], record);
}

/**
 * Return the remote mailbox or witness endpoints a local habitat should poll.
 *
 * KERIpy parity rule:
 * - mailbox role endpoints take precedence when authorized
 * - otherwise poll one witness mailbox endpoint
 *
 * The result is intentionally already flattened to one preferred URL per
 * endpoint identifier so runtime pollers can stay focused on mailbox protocol
 * work instead of URL selection policy.
 */
export function mailboxPollEndpoints(
  hby: Habery,
  hab: Hab,
): Array<{ key: string; eid: string; url: string }> {
  const ends = hab.endsFor(hab.pre);
  const mailbox = flattenRoleUrls(ends[Roles.mailbox])
    .filter((endpoint) => !hby.db.prefixes.has(endpoint.eid))
    .map((endpoint) => ({
      key: `${Roles.mailbox}:${endpoint.eid}:${endpoint.url}`,
      eid: endpoint.eid,
      url: endpoint.url,
    }));
  if (mailbox.length > 0) {
    return mailbox;
  }

  const witness = firstSortedEndpoint(ends[Roles.witness]);
  if (!witness || hby.db.prefixes.has(witness.eid)) {
    return [];
  }
  return [{
    key: `${Roles.witness}:${witness.eid}:${witness.url}`,
    eid: witness.eid,
    url: witness.url,
  }];
}

/**
 * Return the currently authorized mailbox endpoints for one remote recipient.
 *
 * `Poster` treats this as the mailbox-first broadcast target set.
 */
export function mailboxDeliveryEndpoints(
  hab: Hab,
  recipient: string,
): Array<{ eid: string; url: string }> {
  return flattenRoleUrls(hab.endsFor(recipient)[Roles.mailbox]);
}

/**
 * Return the direct controller and agent endpoints for one remote recipient.
 *
 * These are fallback transport targets only when no mailbox endpoints are
 * configured or when the caller explicitly forces direct delivery.
 */
export function directDeliveryEndpoints(
  hab: Hab,
  recipient: string,
): Array<{ eid: string; url: string }> {
  const ends = hab.endsFor(recipient);
  return [
    ...flattenRoleUrls(ends[Roles.controller]),
    ...flattenRoleUrls(ends[Roles.agent]),
  ];
}

/**
 * Read one endpoint's currently stored URLs directly from shared DB state.
 *
 * This stays DB-oriented on purpose so CLI, server, and forwarding code can
 * inspect authoritative location state without carrying a second cache.
 */
export function fetchEndpointUrls(
  hby: Habery,
  eid: string,
  scheme = "",
): Record<string, string> {
  const urls: Record<string, string> = {};
  const keys = scheme ? [eid, scheme] : [eid];
  for (
    const [path, loc] of hby.db.locs.getTopItemIter(keys, {
      topive: !scheme,
    })
  ) {
    const currentScheme = path[1];
    if (!currentScheme || !loc.url) {
      continue;
    }
    urls[currentScheme] = loc.url;
  }
  return urls;
}

/** One locally hosted endpoint plus its advertised preferred URL and base path. */
export interface HostedEndpoint {
  eid: string;
  url: string;
  basePath: string;
}

/**
 * One hosted endpoint match plus the request path relative to its base path.
 *
 * The relative path always starts with `/`, so callers can route mailbox admin
 * and OOBI resources without reparsing the original absolute request path.
 */
export interface HostedEndpointPathMatch extends HostedEndpoint {
  relativePath: string;
}

/** Normalize one optional hosted-prefix filter into a membership set. */
function hostedPrefixFilter(
  eids?: Iterable<string>,
): Set<string> | null {
  if (!eids) {
    return null;
  }
  const filter = new Set<string>();
  for (const eid of eids) {
    filter.add(eid);
  }
  return filter;
}

/**
 * Resolve which locally hosted endpoint URL a request path targets.
 *
 * Matching rule:
 * - compare the request path against each local prefix's preferred endpoint URL
 * - optionally append a resource suffix like `/mailboxes`
 * - when more than one local endpoint matches, the caller must treat that as
 *   ambiguous instead of guessing
 */
export function hostedEndpointMatches(
  hby: Habery,
  pathname: string,
  resourceSuffix = "",
  eids?: Iterable<string>,
): HostedEndpoint[] {
  const target = normalizePath(pathname);
  const matches: HostedEndpoint[] = [];
  const filter = hostedPrefixFilter(eids);

  for (const eid of hby.prefixes) {
    if (filter && !filter.has(eid)) {
      continue;
    }
    const url = preferredUrl(fetchEndpointUrls(hby, eid));
    if (!url) {
      continue;
    }
    const basePath = endpointBasePath(url);
    if (joinBasePath(basePath, resourceSuffix) !== target) {
      continue;
    }
    matches.push({ eid, url, basePath });
  }

  return matches;
}

/**
 * Resolve one hosted endpoint or return `null` when missing or ambiguous.
 *
 * Callers that need ambiguity details should use `hostedEndpointPathMatches()`
 * directly.
 */
export function hostedEndpointForPath(
  hby: Habery,
  pathname: string,
  resourceSuffix = "",
  eids?: Iterable<string>,
): HostedEndpoint | null {
  const matches = hostedEndpointMatches(hby, pathname, resourceSuffix, eids);
  return matches.length === 1 ? matches[0]! : null;
}

/**
 * Resolve all locally hosted endpoints whose advertised base path prefixes the
 * current request path.
 *
 * Matching policy:
 * - root-hosted endpoints match every absolute request path
 * - non-root endpoints match their exact base path or any subpath beneath it
 * - callers should prefer the longest matching base path and treat ties as
 *   ambiguous instead of guessing
 */
export function hostedEndpointPathMatches(
  hby: Habery,
  pathname: string,
  eids?: Iterable<string>,
): HostedEndpointPathMatch[] {
  const target = normalizePath(pathname);
  const matches: HostedEndpointPathMatch[] = [];
  const filter = hostedPrefixFilter(eids);

  for (const eid of hby.prefixes) {
    if (filter && !filter.has(eid)) {
      continue;
    }
    const url = preferredUrl(fetchEndpointUrls(hby, eid));
    if (!url) {
      continue;
    }
    const basePath = endpointBasePath(url);
    const relativePath = relativeHostedPath(basePath, target);
    if (!relativePath) {
      continue;
    }
    matches.push({ eid, url, basePath, relativePath });
  }

  return matches.sort((left, right) => right.basePath.length - left.basePath.length);
}

/**
 * Flatten role endpoint maps to one preferred URL per endpoint identifier.
 *
 * This converts stored end-role location shape into the transport-ready tuples
 * used by forwarding and polling logic.
 */
export function flattenRoleUrls(
  roleUrls?: Record<string, Record<string, string>>,
): Array<{ eid: string; url: string }> {
  if (!roleUrls) {
    return [];
  }

  const flattened: Array<{ eid: string; url: string }> = [];
  for (const [eid, urls] of Object.entries(roleUrls)) {
    const preferred = preferredUrl(urls);
    if (preferred) {
      flattened.push({ eid, url: preferred });
    }
  }
  return flattened;
}

/**
 * Return the deterministic first preferred endpoint from one role map.
 *
 * Witness polling intentionally uses a stable choice instead of a randomized
 * one so local cursor progression is deterministic.
 */
export function firstSortedEndpoint(
  roleUrls?: Record<string, Record<string, string>>,
): { eid: string; url: string } | null {
  const flattened = flattenRoleUrls(roleUrls).sort((left, right) => left.eid.localeCompare(right.eid));
  return flattened[0] ?? null;
}

/**
 * Return the preferred URL for one endpoint location set.
 *
 * HTTPS wins when present because mailbox and admin URLs are externally
 * advertised endpoints.
 */
export function preferredUrl(urls: Record<string, string>): string | null {
  return urls.https ?? urls.http ?? Object.values(urls)[0] ?? null;
}

/**
 * Extract the normalized base path from one endpoint URL.
 *
 * Mailbox and OOBI hosts serve routes relative to this base path, not only
 * from `/`.
 */
export function endpointBasePath(url: string): string {
  try {
    return normalizePath(new URL(url).pathname);
  } catch {
    return "/";
  }
}

function joinBasePath(basePath: string, suffix: string): string {
  if (suffix.length === 0) {
    return normalizePath(basePath);
  }
  return normalizePath(
    `${normalizePath(basePath) === "/" ? "" : normalizePath(basePath)}${suffix}`,
  );
}

/** Normalize hosted endpoint paths into the comparison form used everywhere. */
function normalizePath(pathname: string): string {
  const trimmed = pathname.trim();
  if (trimmed.length === 0 || trimmed === "/") {
    return "/";
  }
  const normalized = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return normalized.replace(/\/+$/, "") || "/";
}

/**
 * Return the request path relative to one hosted endpoint base path.
 *
 * Root-hosted endpoints match every absolute path; non-root endpoints match
 * only their exact base path or descendants beneath it.
 */
function relativeHostedPath(
  basePath: string,
  pathname: string,
): string | null {
  if (basePath === "/") {
    return pathname;
  }
  if (pathname === basePath) {
    return "/";
  }
  if (!pathname.startsWith(`${basePath}/`)) {
    return null;
  }
  return normalizePath(pathname.slice(basePath.length));
}

/** Load or create the durable remote mailbox cursor record for one endpoint. */
function mailboxRemoteCursorRecord(
  hby: Habery,
  pre: string,
  witness: string,
): TopicsRecord {
  return hby.db.tops.get([pre, witness]) ?? new TopicsRecord({ topics: {} });
}
