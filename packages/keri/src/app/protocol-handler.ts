/**
 * Shared protocol-route classification and dispatch for HTTP hosts.
 *
 * Maintainer mental model:
 * - `server.ts` owns transport concerns only: startup, shutdown, and Node/Deno
 *   request bridging
 * - this module owns HTTP-visible protocol policy: route precedence, hosted
 *   endpoint resolution, witness-vs-runtime ingress mode selection, and HTTP
 *   response shaping
 * - `agent-runtime.ts` and `witnessing.ts` remain the execution seams that
 *   actually settle CESR/KERI payloads and drain cues
 *
 * Why this module exists:
 * - the host has to serve several overlapping KERI surfaces from one listener:
 *   witness endpoints, mailbox endpoints, OOBIs, and generic CESR ingress
 * - base-path hosting means the request path alone can target different local
 *   AIDs, so "which habitat did this request hit?" is protocol policy, not
 *   socket plumbing
 * - witness replacement parity with KERIpy depends on routing ordinary hosted
 *   witness root ingress through the witness-local settlement seam, which is a
 *   semantic decision and should stay explicit
 *
 * Design shape:
 * - phase 1 is path/method classification without reading the body
 * - phase 2 applies only to generic CESR ingress after inspecting the payload
 *   and decides which settlement path should run
 *
 * KERIpy correspondence:
 * - KERIpy spreads this responsibility across endpoint classes such as
 *   `ReceiptEnd`, `QueryEnd`, mailbox endpoints, and OOBI handlers
 * - `keri-ts` keeps the same externally visible route behavior, but centralizes
 *   classification here because the parser and router are intentionally
 *   decoupled
 */
import { concatBytes, Ilks, type SerderKERI } from "../../../cesr/mod.ts";
import type { CueEmission } from "../core/cues.ts";
import { ValidationError } from "../core/errors.ts";
import { normalizeMbxTopicCursor } from "../core/mailbox-topics.ts";
import { Roles } from "../core/roles.ts";
import { type AgentRuntime, settleRuntimeIngress } from "./agent-runtime.ts";
import {
  type CesrStreamInspection,
  inspectCesrRequest,
  readMailboxAdminRequest,
  readRequiredCesrRequestBytes,
} from "./cesr-http.ts";
import type { Hab } from "./habbing.ts";
import {
  endpointBasePath,
  fetchEndpointUrls,
  type HostedRouteResolution,
  preferredUrl,
  resolveHostedEndpointPath,
} from "./mailboxing.ts";
import type { RuntimeServerOptions } from "./server.ts";
import { processWitnessIngress, witnessQueryGet, witnessReceiptGet, witnessReceiptPost } from "./witnessing.ts";

/** Shared request handler contract consumed by both Deno and Node hosts. */
export type ProtocolHandler = (req: Request) => Promise<Response>;

/**
 * One request snapshot used by path-first route classification.
 *
 * Invariant:
 * - building this context must not read the request body
 *
 * The three hosted-route fields deliberately represent different matching
 * intents:
 * - `hosted`: longest-base-path match for the raw request path
 * - `mailboxAdmin`: hosted match only when the path targets `/mailboxes`
 * - `genericIngress`: hosted match only when the path targets the hosted root
 *
 * Keeping those lookups separate makes precedence reviewable and prevents the
 * later dispatcher from having to rediscover path semantics.
 */
export interface ProtocolRequestContext {
  readonly req: Request;
  readonly url: URL;
  readonly pathname: string;
  readonly method: string;
  readonly runtime?: AgentRuntime;
  readonly options: RuntimeServerOptions;
  readonly hosted: HostedRouteResolution | null;
  readonly mailboxAdmin: HostedRouteResolution | null;
  readonly genericIngress: HostedRouteResolution | null;
  readonly oobi: OobiRouteRequest | null;
}

/**
 * Phase-one route decision before any request body is read.
 *
 * Precedence is intentional and externally visible:
 * 1. `/health`
 * 2. mailbox admin
 * 3. witness `/receipts` and `/query`
 * 4. OOBI resources
 * 5. generic CESR ingress to the hosted root path
 *
 * If precedence changes, add or update focused classifier tests first.
 */
export type ProtocolRoute =
  | { kind: "health" }
  | { kind: "mailboxAdmin"; mailboxAid: string }
  | { kind: "witnessReceiptsPost"; witnessHab: Hab }
  | { kind: "witnessReceiptsGet"; witnessHab: Hab }
  | { kind: "witnessQueryGet"; witnessHab: Hab }
  | { kind: "oobi"; request: OobiRouteRequest }
  | { kind: "genericCesrIngress"; hosted: HostedRouteResolution }
  | { kind: "ambiguousHostedPath"; message: string }
  | { kind: "notFound" };

/**
 * Phase-two ingress decision for one already-inspected CESR request.
 *
 * This exists because one generic POST/PUT CESR route fans out to several
 * semantic execution paths:
 * - witness-local ingress for ordinary witness-hosted event/reply traffic
 * - generic runtime ingress for normal request handling
 * - mailbox SSE streaming for `qry/mbx`
 * - runtime ingress plus immediate replay publication for `qry/ksn`
 *
 * The goal is to name those policy branches explicitly instead of burying them
 * in ad hoc booleans inside one large request handler.
 */
export type CesrIngressRoute =
  | { kind: "witnessLocalIngress"; witnessHab: Hab }
  | { kind: "runtimeIngress"; mailboxAid: string | null }
  | {
    kind: "mailboxQueryStream";
    mailboxAid: string | null;
    pre: string | null;
    topics: unknown;
  }
  | {
    kind: "runtimeIngressWithKsnReplay";
    mailboxAid: string | null;
    pre: string | null;
  };

/** Parsed OOBI request semantics extracted from the request path alone. */
export interface OobiRouteRequest {
  kind: "wellKnown" | "oobi";
  aid: string | null;
  role?: string;
  eid?: string;
}

/**
 * Build the shared protocol handler used by both Deno and Node hosts.
 *
 * This function is intentionally thin: create request context, classify,
 * dispatch, and translate uncaught errors into HTTP 500 responses. The point
 * of the refactor was to make that control flow obvious enough that future
 * policy edits happen in small helpers instead of inside transport adapters.
 */
export function createProtocolHandler(
  runtime?: AgentRuntime,
  options: RuntimeServerOptions = {},
): ProtocolHandler {
  return async (req: Request): Promise<Response> => {
    try {
      const context = buildProtocolRequestContext(req, runtime, options);
      const route = classifyProtocolRoute(context);
      return await dispatchProtocolRoute(context, route);
    } catch (error) {
      return new Response(String(error), { status: 500 });
    }
  };
}

/**
 * Snapshot one request into the path-first routing context.
 *
 * The resulting context is the durable seam between transport adaptation and
 * protocol policy. Everything needed for phase-one classification should be
 * derivable here without touching the request body.
 */
export function buildProtocolRequestContext(
  req: Request,
  runtime?: AgentRuntime,
  options: RuntimeServerOptions = {},
): ProtocolRequestContext {
  const url = new URL(req.url);
  const pathname = normalizeProtocolPath(url.pathname);
  const hosted = runtime
    ? resolveHostedEndpointPath(runtime.hby, pathname, "", options.hostedPrefixes)
    : null;
  const mailboxAdmin = runtime
    ? resolveHostedEndpointPath(runtime.hby, pathname, "/mailboxes", options.hostedPrefixes)
    : null;
  const genericIngress = runtime
    ? resolveHostedEndpointPath(runtime.hby, pathname, "/", options.hostedPrefixes)
    : null;
  const oobiPath = hosted?.relativePath ?? pathname;

  return {
    req,
    url,
    pathname,
    method: req.method,
    runtime,
    options,
    hosted,
    mailboxAdmin,
    genericIngress,
    oobi: parseOobiRouteRequest(oobiPath),
  };
}

/**
 * Classify one request by path and method before reading the body.
 *
 * This is the place to reason about visible HTTP precedence. If two surfaces
 * compete for the same path, resolve it here rather than inside the downstream
 * route handlers.
 */
export function classifyProtocolRoute(
  context: ProtocolRequestContext,
): ProtocolRoute {
  if (context.pathname === "/health") {
    return { kind: "health" };
  }

  if (!context.runtime) {
    return { kind: "notFound" };
  }

  if (context.method === "POST") {
    if (context.mailboxAdmin?.kind === "ambiguous") {
      return {
        kind: "ambiguousHostedPath",
        message: "Ambiguous mailbox endpoint path",
      };
    }
    if (context.mailboxAdmin?.kind === "one") {
      return {
        kind: "mailboxAdmin",
        mailboxAid: context.mailboxAdmin.endpoint!.eid,
      };
    }
  }

  if (context.options.witnessHab) {
    if (context.hosted?.kind === "ambiguous") {
      return {
        kind: "ambiguousHostedPath",
        message: "Ambiguous hosted endpoint path",
      };
    }
    const relativePath = context.hosted?.relativePath ?? context.pathname;
    if ((context.method === "POST" || context.method === "PUT") && relativePath === "/receipts") {
      return { kind: "witnessReceiptsPost", witnessHab: context.options.witnessHab };
    }
    if (context.method === "GET" && relativePath === "/receipts") {
      return { kind: "witnessReceiptsGet", witnessHab: context.options.witnessHab };
    }
    if (context.method === "GET" && relativePath === "/query") {
      return { kind: "witnessQueryGet", witnessHab: context.options.witnessHab };
    }
  }

  if (context.oobi) {
    if (context.hosted?.kind === "ambiguous") {
      return {
        kind: "ambiguousHostedPath",
        message: "Ambiguous hosted endpoint path",
      };
    }
    return { kind: "oobi", request: context.oobi };
  }

  if (context.method === "POST" || context.method === "PUT") {
    if (context.genericIngress?.kind === "ambiguous") {
      return {
        kind: "ambiguousHostedPath",
        message: "Ambiguous hosted endpoint path",
      };
    }
    return {
      kind: "genericCesrIngress",
      hosted: context.genericIngress ?? NONE_HOSTED_ROUTE,
    };
  }

  return { kind: "notFound" };
}

/**
 * Decide how one inspected CESR request should be ingested.
 *
 * This is the explicit replacement for the old inline witness-root boolean.
 *
 * Durable rule:
 * - hosted witness root traffic for ordinary events and replies should settle
 *   through the witness-local path
 * - `qry` stays on the generic runtime path because mailbox SSE and `/ksn`
 *   replay behavior are runtime-owned response policies
 * - `exn` stays on the generic runtime path because combined witness+mailbox
 *   forwarding behavior currently lives there
 */
export function classifyCesrIngressRoute(
  context: ProtocolRequestContext,
  hosted: HostedRouteResolution,
  serder: Pick<SerderKERI, "ilk" | "route" | "ked">,
): CesrIngressRoute {
  const mailboxAid = hosted.kind === "one" ? hosted.endpoint?.eid ?? null : null;
  const witnessHab = context.options.witnessHab;

  if (
    witnessHab
    && hosted.kind === "one"
    && hosted.endpoint?.eid === witnessHab.pre
    && serder.ilk !== Ilks.qry
    && serder.ilk !== Ilks.exn
  ) {
    return { kind: "witnessLocalIngress", witnessHab };
  }

  if (serder.ilk === Ilks.qry && serder.route === "mbx") {
    const query = serder.ked?.q as Record<string, unknown> | undefined;
    const pre = typeof query?.i === "string" ? query.i : null;
    return {
      kind: "mailboxQueryStream",
      mailboxAid,
      pre,
      topics: query?.topics,
    };
  }

  if (serder.ilk === Ilks.qry && serder.route === "ksn") {
    const query = serder.ked?.q as Record<string, unknown> | undefined;
    const pre = typeof query?.i === "string" ? query.i : null;
    return {
      kind: "runtimeIngressWithKsnReplay",
      mailboxAid,
      pre,
    };
  }

  return { kind: "runtimeIngress", mailboxAid };
}

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

/**
 * Dispatch one already-classified phase-one route to its concrete response.
 *
 * The dispatcher intentionally does not do its own route rediscovery. Its job
 * is to connect an explicit route decision to the narrow handler that owns the
 * remaining request-specific work.
 */
async function dispatchProtocolRoute(
  context: ProtocolRequestContext,
  route: ProtocolRoute,
): Promise<Response> {
  switch (route.kind) {
    case "health":
      return textResponse("ok", 200);
    case "ambiguousHostedPath":
      return textResponse(route.message, 409);
    case "mailboxAdmin":
      return await handleMailboxAdmin(
        context.runtime!,
        context.req,
        route.mailboxAid,
        context.options.serviceHab,
      );
    case "witnessReceiptsPost":
      return await handleWitnessReceiptPost(context.runtime!, context.req, route.witnessHab);
    case "witnessReceiptsGet":
      return handleWitnessReceiptGet(context, route.witnessHab);
    case "witnessQueryGet":
      return handleWitnessQueryGet(context, route.witnessHab);
    case "oobi":
      return handleOobiRequest(context, route.request);
    case "genericCesrIngress":
      return await handleGenericCesrIngress(context, route.hosted);
    case "notFound":
      return textResponse("Not Found", 404);
  }
}

/** Handle one witness `/receipts` POST request. */
async function handleWitnessReceiptPost(
  runtime: AgentRuntime,
  req: Request,
  witnessHab: Hab,
): Promise<Response> {
  const bytes = await readRequiredCesrRequestBytes(req);
  if (!bytes) {
    return textResponse("Unacceptable content type.", 406);
  }

  const result = witnessReceiptPost(runtime, witnessHab, bytes);
  if (result.kind === "accepted") {
    return cesrResponse(result.body, result.status);
  }
  if (result.kind === "escrow") {
    return new Response(null, {
      status: result.status,
      headers: { "Content-Type": "application/json" },
    });
  }
  return textResponse(result.message, result.status);
}

/** Handle one witness `/receipts` GET request. */
function handleWitnessReceiptGet(
  context: ProtocolRequestContext,
  witnessHab: Hab,
): Response {
  const snText = context.url.searchParams.get("sn");
  const sn = snText === null ? null : Number.parseInt(snText, 10);
  const result = witnessReceiptGet(witnessHab, {
    pre: context.url.searchParams.get("pre"),
    sn: Number.isNaN(sn ?? Number.NaN) ? null : sn,
    said: context.url.searchParams.get("said"),
  });
  if (result.kind === "accepted") {
    return cesrResponse(result.body, result.status);
  }
  return textResponse(result.message, result.status);
}

/** Handle one witness `/query` GET request. */
function handleWitnessQueryGet(
  context: ProtocolRequestContext,
  witnessHab: Hab,
): Response {
  const snText = context.url.searchParams.get("sn");
  const sn = snText === null ? null : Number.parseInt(snText, 10);
  const result = witnessQueryGet(witnessHab, {
    typ: context.url.searchParams.get("typ"),
    pre: context.url.searchParams.get("pre"),
    sn: Number.isNaN(sn ?? Number.NaN) ? null : sn,
  });
  if (result.kind === "accepted") {
    return cesrResponse(result.body, result.status);
  }
  return textResponse(result.message, result.status);
}

/** Serve one OOBI request from local accepted habitat state. */
function handleOobiRequest(
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

  const hosted = context.hosted ?? NONE_HOSTED_ROUTE;
  const speakerAid = selectOobiSpeaker(
    runtime,
    hosted,
    aid,
    request.eid,
    context.options.hostedPrefixes,
  );
  const hab = speakerAid ? runtime.hby.habs.get(speakerAid) : undefined;
  if (!hab) {
    if (hosted.kind === "ambiguous") {
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
 * Handle one generic POST/PUT CESR ingress request.
 *
 * This is where the two-phase model becomes concrete:
 * - read and inspect the CESR payload once
 * - classify the body-aware ingress mode
 * - call the matching settlement seam
 * - shape any immediate HTTP response required by that ingress mode
 *
 * The important boundary is that this function chooses *which* execution seam
 * runs, while `settleRuntimeIngress(...)` and `processWitnessIngress(...)`
 * decide *how* the message is parsed, settled, and escrow-replayed.
 */
async function handleGenericCesrIngress(
  context: ProtocolRequestContext,
  hosted: HostedRouteResolution,
): Promise<Response> {
  const runtime = context.runtime!;
  const bytes = await readRequiredCesrRequestBytes(context.req);
  if (!bytes) {
    return textResponse("Unacceptable content type.", 406);
  }

  const serder = inspectCesrRequest(bytes);
  if (!serder) {
    return textResponse("Invalid CESR request", 400);
  }

  const ingressRoute = classifyCesrIngressRoute(context, hosted, serder);
  let emissions: CueEmission[];

  switch (ingressRoute.kind) {
    case "witnessLocalIngress":
      emissions = processWitnessIngress(runtime, ingressRoute.witnessHab, bytes, {
        local: true,
      });
      break;
    case "runtimeIngress":
      processRuntimeRequest(
        runtime,
        bytes,
        ingressRoute.mailboxAid,
        context.options.serviceHab,
      );
      return jsonNoContentResponse();
    case "mailboxQueryStream":
      emissions = processRuntimeRequest(
        runtime,
        bytes,
        ingressRoute.mailboxAid,
        context.options.serviceHab,
      );
      if (!ingressRoute.pre) {
        return textResponse("Mailbox query is missing i", 400);
      }
      return new Response(
        runtime.mailboxDirector.streamMailbox(
          ingressRoute.pre,
          normalizeMbxTopicCursor(ingressRoute.topics),
        ),
        {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "close",
          },
        },
      );
    case "runtimeIngressWithKsnReplay":
      emissions = processRuntimeRequest(
        runtime,
        bytes,
        ingressRoute.mailboxAid,
        context.options.serviceHab,
      );
      if (ingressRoute.pre) {
        publishQueryCatchupReplay(runtime, emissions, ingressRoute.pre);
      }
      return jsonNoContentResponse();
  }

  return jsonNoContentResponse();
}

/**
 * Choose which local habitat should answer an OOBI request.
 *
 * Preference order:
 * - the requested AID itself when locally controlled
 * - the explicit endpoint AID when it is locally controlled
 * - the hosted endpoint matched from the request path
 */
function selectOobiSpeaker(
  runtime: AgentRuntime,
  hosted: HostedRouteResolution,
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

/** Pick the default blind OOBI speaker when the request omits an AID. */
function defaultOobiAid(
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
 * Handle mailbox add/remove authorization requests for one hosted mailbox AID.
 *
 * Contract:
 * - request body is either one `application/cesr` stream or one
 *   `multipart/form-data` request carrying `kel`, optional `delkel`, and `rpy`
 * - both request shapes normalize to one mailbox authorization CESR stream
 * - that stream ends in the mailbox authorization `rpy`
 */
async function handleMailboxAdmin(
  runtime: AgentRuntime,
  req: Request,
  mailboxAid: string,
  serviceHab?: Hab,
): Promise<Response> {
  let mailboxRequest;
  try {
    mailboxRequest = await readMailboxAdminRequest(req);
  } catch (error) {
    if (error instanceof ValidationError) {
      return textResponse(error.message, 400);
    }
    return textResponse(String(error), 400);
  }
  if (!mailboxRequest) {
    return textResponse("Unacceptable content type.", 406);
  }

  const { bytes, inspection } = mailboxRequest;
  const validation = validateMailboxAuthorizationReply(inspection, mailboxAid);
  if (validation instanceof Response) {
    return validation;
  }

  const { cid, role, expected } = validation;
  processRuntimeRequest(runtime, bytes, mailboxAid, serviceHab);

  const acceptance = confirmMailboxAuthorization(runtime, cid, mailboxAid, expected);
  if (acceptance instanceof Response) {
    return acceptance;
  }

  return new Response(
    JSON.stringify({
      cid,
      role,
      eid: mailboxAid,
      allowed: expected,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}

/** Validate the terminal mailbox authorization reply before local acceptance checks. */
function validateMailboxAuthorizationReply(
  inspection: CesrStreamInspection,
  mailboxAid: string,
): Response | { cid: string; role: string; expected: boolean } {
  const serder = inspection.terminal;
  if (!serder) {
    return textResponse("Mailbox authorization stream is required", 400);
  }
  if (serder.ilk !== Ilks.rpy) {
    return textResponse("Mailbox authorization stream must end in rpy", 400);
  }

  const route = serder.route ?? "";
  if (route !== "/end/role/add" && route !== "/end/role/cut") {
    return textResponse("Unsupported mailbox authorization route", 400);
  }

  const data = serder.ked?.a as Record<string, unknown> | undefined;
  const cid = typeof data?.cid === "string" ? data.cid : null;
  const role = typeof data?.role === "string" ? data.role : null;
  const eid = typeof data?.eid === "string" ? data.eid : null;
  if (!cid || !role || !eid) {
    return textResponse("Mailbox authorization reply is missing cid/role/eid", 400);
  }
  if (role !== Roles.mailbox) {
    return textResponse("Mailbox authorization reply must use role=mailbox", 400);
  }
  if (eid !== mailboxAid) {
    return textResponse(
      "Mailbox authorization target does not match hosted mailbox",
      403,
    );
  }
  return { cid, role, expected: route === "/end/role/add" };
}

/** Confirm that mailbox authorization state was accepted locally. */
function confirmMailboxAuthorization(
  runtime: AgentRuntime,
  cid: string,
  mailboxAid: string,
  expected: boolean,
): Response | null {
  const end = runtime.hby.db.ends.get([cid, Roles.mailbox, mailboxAid]);
  const accepted = expected ? !!end?.allowed : !!end && !end.allowed;
  if (!accepted) {
    return textResponse("Mailbox authorization reply was not accepted", 403);
  }
  return null;
}

/**
 * Ingest one mailbox-aware request payload through the shared runtime.
 *
 * Why this helper exists:
 * - the runtime settlement path itself should stay route-policy-free
 * - request handling still needs one scoped bit of context: which hosted
 *   mailbox AID, if any, received the request
 *
 * That mailbox identity is applied only for the duration of parsing and cue
 * handling so `/fwd` authorization and mailbox publication stay tied to the
 * endpoint that actually received the HTTP request.
 */
function processRuntimeRequest(
  runtime: AgentRuntime,
  bytes: Uint8Array,
  mailboxAid: string | null,
  serviceHab?: Hab,
): CueEmission[] {
  runtime.mailboxDirector.withActiveMailboxAid(mailboxAid, () => {
    settleRuntimeIngress(runtime, [bytes]);
  });
  return drainRuntimeCues(runtime, serviceHab);
}

/**
 * Drain runtime cues through one service habitat and mailbox side effects.
 *
 * Responsibilities:
 * - choose the habitat that should interpret runtime cues for this request
 * - let `Hab.processCuesIter(...)` remain the cue-to-wire interpreter
 * - publish any mailbox side effects before the HTTP response is finalized
 *
 * This keeps cue interpretation out of `server.ts`, but also keeps the runtime
 * itself from knowing anything about HTTP response finalization.
 */
function drainRuntimeCues(
  runtime: AgentRuntime,
  serviceHab?: Hab,
): CueEmission[] {
  const habitats = [...runtime.hby.habs.values()];
  const hab = serviceHab
    ?? (habitats.length === 1 ? habitats[0] ?? null : null);
  if (!hab) {
    return [];
  }

  const emissions: CueEmission[] = [];
  for (const emission of hab.processCuesIter(runtime.cues)) {
    runtime.mailboxDirector.handleEmission(emission);
    emissions.push(emission);
  }
  return emissions;
}

/**
 * Publish one replay catch-up payload after a successful `/ksn` style reply.
 *
 * This bridges the stale-but-recoverable case where a mailbox client learns
 * that the remote controller is ahead but still needs replay material quickly
 * enough to verify the new signer state.
 *
 * The replay publication is intentionally coupled to the route layer because it
 * is a response policy attached to `/ksn` over mailbox transport, not a generic
 * side effect of settling a `qry`.
 */
function publishQueryCatchupReplay(
  runtime: AgentRuntime,
  emissions: CueEmission[],
  pre: string,
): void {
  let destination: string | null = null;
  for (const emission of emissions) {
    if (emission.kind !== "wire" || emission.cue.kin !== "reply") {
      continue;
    }
    if (emission.cue.route !== "/ksn" || typeof emission.cue.dest !== "string") {
      continue;
    }
    destination = emission.cue.dest;
    break;
  }
  if (!destination) {
    return;
  }

  const kever = runtime.hby.db.getKever(pre);
  const parts = [...runtime.hby.db.clonePreIter(pre, 0)];
  if (kever?.delpre) {
    parts.push(...runtime.hby.db.cloneDelegation(kever));
  }
  if (parts.length === 0) {
    return;
  }

  runtime.mailboxDirector.publish(
    destination,
    "/replay",
    Uint8Array.from(concatBytes(...parts)),
  );
}

/** Normalize incoming request paths into the comparison form used by routing. */
function normalizeProtocolPath(pathname: string): string {
  const trimmed = pathname.trim();
  if (trimmed.length === 0 || trimmed === "/") {
    return "/";
  }
  const normalized = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return normalized.replace(/\/+$/, "") || "/";
}

/** Return one CESR response body with the expected content type. */
function cesrResponse(body: Uint8Array, status: number): Response {
  return new Response(body.slice().buffer, {
    status,
    headers: { "Content-Type": "application/cesr" },
  });
}

/** Return one plain-text response. */
function textResponse(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain" },
  });
}

/** Return the ordinary no-content JSON response used by ingress routes. */
function jsonNoContentResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: { "Content-Type": "application/json" },
  });
}

const NONE_HOSTED_ROUTE: HostedRouteResolution = {
  kind: "none",
  endpoint: null,
  relativePath: null,
};
