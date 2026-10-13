/**
 * Generic CESR POST/PUT ingress for the Tufa HTTP edge.
 *
 * Explicit routes are classified before this module runs. This handler owns
 * the remaining raw CESR traffic and decides whether it belongs to local
 * witness ingestion, mailbox SSE query streaming, or normal runtime ingress.
 */
import { discardFrame, Ilks, ParserError, ResourceLimitError, type SerderKERI } from "cesr-ts";
import { call, each, type Operation, resource, run } from "effection";
import {
  type AgentRuntime,
  type CueEmission,
  drainWitnessCues,
  type HostedRouteResolution,
  isCesrContentType,
  queryEnvelopeFromDispatch,
  type QueryReply,
  requestBytes,
  runtimeTurn,
  ValidationError,
} from "keri-ts/runtime";
import { jsonNoContentResponse, textResponse } from "../responses.ts";
import { drainRuntimeCues } from "../runtime-bridge.ts";
import type { CesrIngressRoute, ProtocolRequestContext, ProtocolRoute } from "../types.ts";

/** No hosted endpoint matched this generic ingress request. */
const NONE_HOSTED_ROUTE: HostedRouteResolution = {
  kind: "none",
  endpoint: null,
  relativePath: null,
};

/** Upper bound for a direct `/logs` query response to wait for replay cues. */
const DIRECT_QUERY_RESPONSE_WAIT_MS = 60_000;

/** Classify generic POST/PUT CESR ingress after all explicit HTTP routes. */
export function classifyGenericCesrIngressRoute(
  context: ProtocolRequestContext,
): ProtocolRoute | null {
  if (
    !context.runtime || (context.method !== "POST" && context.method !== "PUT")
  ) {
    return null;
  }
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

/**
 * Decide how one inspected CESR request should be ingested.
 *
 * This is the explicit replacement for the old inline witness-root boolean.
 */
export function classifyCesrIngressRoute(
  context: ProtocolRequestContext,
  hosted: HostedRouteResolution,
  serder: Pick<SerderKERI, "ilk" | "route" | "ked">,
): CesrIngressRoute {
  const mailboxAid = hosted.kind === "one"
    ? hosted.endpoint?.eid ?? null
    : null;
  const witnessHab = context.policy.witnessHab;

  if (
    witnessHab
    && hosted.kind === "one"
    && hosted.endpoint?.eid === witnessHab.pre
    && serder.ilk !== Ilks.qry
    && serder.ilk !== Ilks.exn
  ) {
    // Witness-hosted events are accepted locally by the witness processor, but
    // witness `qry` and peer `exn` traffic still belongs to runtime routing.
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

  return { kind: "runtimeIngress", mailboxAid };
}

/** Return the mailbox stream correlated with this already-authorized query. */
function querySseResponse(
  context: ProtocolRequestContext,
  said: string | null,
): Response {
  if (!said) {
    return textResponse("Query is missing said", 400);
  }
  return new Response(
    context.runtime!.mailboxDirector.streamQueryResponse(said),
    {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "close",
      },
    },
  );
}

/** Open lazy direct reply bytes under runtime ownership; the request signal ends with ingress. */
function directQueryResponse(runtime: AgentRuntime, emissions: readonly CueEmission[]): Response | null {
  const replies = emissions.filter((emission) =>
    emission.kind === "wire" && (emission.cue.kin === "replay" || emission.cue.kin === "reply")
  );
  if (replies.length === 0) return null;
  const messages = {
    /** Reopening preserves each reserved cue's order without concatenating its replay. */
    *[Symbol.iterator]() {
      for (const reply of replies) yield* reply.messages;
    },
  };
  return new Response(runtime.replyStreams.open(messages), {
    status: 200,
    headers: { "Content-Type": "application/cesr" },
  });
}

/** Wait for this request's reserved response while other runtime turns continue fairly. */
function* deferredDirectQueryResponse(
  context: ProtocolRequestContext,
  serder: SerderKERI,
  reply: QueryReply,
): Operation<Response | null> {
  const runtime = context.runtime!;
  const expires = Date.now() + DIRECT_QUERY_RESPONSE_WAIT_MS;
  do {
    let response: Response | null = null;
    yield* runtime.reactor.settle(undefined, { escrows: true }, function*() {
      const cue = reply.take();
      if (cue) {
        response = directQueryResponse(runtime, yield* drainRuntimeCues(runtime, context.policy.serviceHab, [cue]));
      }
    });
    if (response) return response;
    if (serder.route !== "logs") return null;
    yield* runtimeTurn();
  } while (Date.now() < expires);
  return null;
}

/** Run one request in a single owned Effection task and join it on disconnect. */
export async function handleGenericCesrIngress(
  context: ProtocolRequestContext,
  hosted: HostedRouteResolution,
): Promise<Response> {
  if (!isCesrContentType(context.req.headers.get("content-type"))) {
    await context.req.body?.cancel().catch(() => {});
    return textResponse("Unacceptable content type.", 406);
  }
  const task = run(() => ingest(context, hosted));
  /** Disconnect halts the sole task that owns this request source and its dispatches. */
  const stop = () => {
    void task.halt();
  };
  context.req.signal.addEventListener("abort", stop, { once: true });
  if (context.req.signal.aborted) stop();
  try {
    const response = await task;
    return context.req.signal.aborted ? textResponse("Request cancelled", 408) : response;
  } catch (error) {
    if (context.req.signal.aborted) return textResponse("Request cancelled", 408);
    if (error instanceof ResourceLimitError) return textResponse(error.message, 413);
    if (error instanceof ParserError || error instanceof ValidationError) return textResponse(error.message, 400);
    throw error;
  } finally {
    context.req.signal.removeEventListener("abort", stop);
    await task.halt();
    // Admission or header failure may precede acquisition of the request body reader.
    if (context.req.body && !context.req.body.locked) await context.req.body.cancel().catch(() => {});
  }
}

/** Parse on demand, dispatch each completed child, and retain only the final response query. */
function* ingest(context: ProtocolRequestContext, hosted: HostedRouteResolution): Operation<Response> {
  const runtime = context.runtime!;
  let seen = false;
  let query: { serder: SerderKERI; mailbox: boolean; authorized: boolean; reply?: QueryReply } | undefined;
  try {
    // This child scope closes its parser before an optional deferred query wait begins.
    yield* call(function*() {
      const channel = yield* runtime.reactor.frames(
        (signal) => requestBytes(context.req, { signal }),
        { signal: context.req.signal },
      );
      for (const frame of yield* each(channel.frames)) {
        yield* call(function*() {
          // Invalid trailing frames still own payloads even when they never reach runtime dispatch.
          if (frame.essr || frame.nests?.length) {
            yield* resource<void>(function*(provide) {
              try {
                yield* provide();
              } finally {
                yield* call(() => discardFrame(frame));
              }
            });
          }
          if (query?.reply) {
            const previous = query.reply;
            // A later frame makes this an ordinary query; transfer its reply before releasing its reservation.
            yield* runtime.reactor.settle(undefined, {}, function*() {
              try {
                const cue = previous.take();
                if (cue) yield* drainRuntimeCues(runtime, context.policy.serviceHab, [cue]);
              } finally {
                previous.close();
              }
            });
          }
          query = undefined;
          seen = true;
          const serder = frame.body as SerderKERI;
          const route = classifyCesrIngressRoute(context, hosted, serder);
          if (serder.ilk === Ilks.qry) {
            query = {
              serder,
              mailbox: route.kind === "mailboxQueryStream",
              authorized: false,
              reply: context.policy.directQueryResponses && route.kind !== "mailboxQueryStream" && serder.said
                ? runtime.reactor.replies.reserve(serder.said)
                : undefined,
            };
          }
          yield* runtime.reactor.settle(frame, {
            local: route.kind === "witnessLocalIngress",
            mailboxAid: route.kind === "witnessLocalIngress" ? hosted.endpoint?.eid : route.mailboxAid,
            escrows: true,
          }, function*(envelope, decision) {
            if (query) {
              // SAIDs exclude attachments: authorize this exact envelope, not an older query cue.
              query.authorized = decision?.kind !== "drop"
                && (!query.mailbox || runtime.reactor.kevery.isMailboxQueryAuthorized(
                  queryEnvelopeFromDispatch(envelope!),
                ));
            }
            if (route.kind === "witnessLocalIngress") {
              yield* drainWitnessCues(runtime, route.witnessHab, runtime.cues);
            } else {
              yield* drainRuntimeCues(runtime, context.policy.serviceHab, runtime.cues);
            }
          });
        });
        yield* each.next();
      }
    });
    if (!seen) return textResponse("Invalid CESR request", 400);
    if (!query) return jsonNoContentResponse();
    if (!query.authorized) return textResponse("Query requester is not authorized", 403);
    if (query.mailbox) return querySseResponse(context, query.serder.said ?? null);
    return query.reply
      ? (yield* deferredDirectQueryResponse(context, query.serder, query.reply)) ?? jsonNoContentResponse()
      : jsonNoContentResponse();
  } finally {
    query?.reply?.close();
  }
}
