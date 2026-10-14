/**
 * Generic CESR POST/PUT ingress for the Tufa HTTP edge.
 *
 * Explicit routes are classified before this module runs. This handler owns
 * the remaining raw CESR traffic and decides whether it belongs to local
 * witness ingestion, mailbox SSE query streaming, or normal runtime ingress.
 */
import { discardFrame, Ilks, ParserError, ResourceAdmissionError, ResourceLimitError, type SerderKERI } from "cesr-ts";
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

/** Wait for this request's reserved response while other runtime turns continue fairly. */
function* deferredDirectQueryResponse(
  context: ProtocolRequestContext,
  serder: SerderKERI,
  reply: QueryReply,
  publish: (response: Response) => void,
): Operation<Response | null> {
  const runtime = context.runtime!;
  const expires = Date.now() + DIRECT_QUERY_RESPONSE_WAIT_MS;
  do {
    let response: Response | null = null;
    yield* runtime.reactor.settle(undefined, { escrows: true }, function*() {
      const habitats = runtime.hby.habs.values();
      const first = habitats.next();
      const hab = context.policy.serviceHab ?? (first.done || !habitats.next().done ? null : first.value);
      if (hab) {
        const stream = runtime.deliveries.openReply(runtime, hab, reply);
        if (stream) {
          response = new Response(stream, {
            status: 200,
            headers: { "Content-Type": "application/cesr" },
          });
          publish(response);
        }
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
    await context.req.body?.cancel();
    return textResponse("Unacceptable content type.", 406);
  }
  let response: Response | undefined, operationFailure: { error: unknown } | undefined;
  const task = run(function*() {
    try {
      response = yield* call(() => ingest(context, hosted, (value) => response = value));
      return response;
    } catch (error) {
      operationFailure = { error };
      throw error;
    }
  });
  let stopping: Promise<void> | undefined;
  /** Own one halt and join its cleanup; notification observes but never consumes its failure. */
  const stop = () => {
    stopping ??= Promise.resolve(task.halt());
    void stopping.catch(() => {});
  };
  context.req.signal.addEventListener("abort", stop, { once: true });
  if (context.req.signal.aborted) stop();
  let primary: { error: unknown } | undefined;
  const cleanup: unknown[] = [];
  const note = (error: unknown) => {
    if (!cleanup.includes(error)) cleanup.push(error);
  };
  let haltedCleanly = false;
  try {
    await task;
  } catch (error) {
    primary = { error };
  } finally {
    context.req.signal.removeEventListener("abort", stop);
    try {
      await (stopping ?? Promise.resolve(task.halt()));
      haltedCleanly = true;
    } catch (error) {
      note(error);
    }
    // Admission may precede reader acquisition; cancellation failure is still this owner's responsibility.
    if (context.req.body && !context.req.body.locked) {
      try {
        await context.req.body.cancel();
      } catch (error) {
        if (error !== context.req.signal.reason) note(error);
      }
    }
  }
  const ownCancellation = context.req.signal.aborted && stopping && haltedCleanly
    && (!operationFailure || operationFailure.error === context.req.signal.reason);
  if (primary && !ownCancellation) {
    const error = primary.error;
    if (!context.req.signal.aborted && !cleanup.length) {
      if (error instanceof ResourceAdmissionError && error.reason === "busy") return textResponse(error.message, 503);
      if (error instanceof ResourceLimitError) return textResponse(error.message, 413);
      if (error instanceof ParserError || error instanceof ValidationError) return textResponse(error.message, 400);
    }
    if (!cleanup.includes(error)) cleanup.unshift(error);
  }
  // Published output is independent of ingress. A late abort must close it outside status/error mapping.
  if (response && (context.req.signal.aborted || cleanup.length)) {
    try {
      await response.body?.cancel();
    } catch (error) {
      note(error);
    }
  }
  if (cleanup.length === 1) throw cleanup[0];
  if (cleanup.length) throw new AggregateError(cleanup, "HTTP ingress cleanup failed");
  return context.req.signal.aborted ? textResponse("Request cancelled", 408) : response!;
}

/** Parse on demand, dispatch each completed child, and retain only the final response query. */
function* ingest(
  context: ProtocolRequestContext,
  hosted: HostedRouteResolution,
  publish: (response: Response) => void,
): Operation<Response> {
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
          yield* resource<void>(function*(provide) {
            try {
              yield* provide();
            } finally {
              yield* call(() => discardFrame(frame));
            }
          });
          if (query?.reply) {
            const previous = query.reply;
            // A later frame makes this an ordinary query; transfer its reply before releasing its reservation.
            yield* runtime.reactor.settle(undefined, {}, function*() {
              try {
                const batch = previous.takeAll();
                if (batch) {
                  try {
                    yield* drainRuntimeCues(runtime, context.policy.serviceHab, batch.cues);
                  } finally {
                    batch.release();
                  }
                }
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
              query.authorized = decision?.kind !== "drop" && decision?.kind !== "pending"
                && decision?.kind !== "missing"
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
    if (query.mailbox) {
      const response = querySseResponse(context, query.serder.said ?? null);
      publish(response);
      return response;
    }
    return query.reply
      ? (yield* deferredDirectQueryResponse(context, query.serder, query.reply, publish)) ?? jsonNoContentResponse()
      : jsonNoContentResponse();
  } finally {
    query?.reply?.close();
  }
}
