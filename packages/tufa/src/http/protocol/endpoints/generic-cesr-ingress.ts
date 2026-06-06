/**
 * Generic CESR POST/PUT ingress for the Tufa HTTP edge.
 *
 * Explicit routes are classified before this module runs. This handler owns
 * the remaining raw CESR traffic and decides whether it belongs to local
 * witness ingestion, mailbox SSE query streaming, or normal runtime ingress.
 */
import { concatBytes, Ilks, type SerderKERI } from "cesr-ts";
import { run } from "effection";
import {
  type CueEmission,
  type HostedRouteResolution,
  inspectCesrRequest,
  processWitnessIngress,
  readRequiredCesrRequestBytes,
  runtimeTurn,
} from "keri-ts/runtime";
import { cesrResponse, jsonNoContentResponse, textResponse } from "../responses.ts";
import { drainRuntimeCues, processRuntimeRequest } from "../runtime-bridge.ts";
import type { CesrIngressRoute, ProtocolRequestContext, ProtocolRoute } from "../types.ts";

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

/** Collect immediate replay/reply wire cues into one direct CESR response. */
function directQueryResponse(
  emissions: readonly CueEmission[],
): Response | null {
  const messages: Uint8Array[] = [];
  for (const emission of emissions) {
    if (
      emission.kind === "wire"
      && (emission.cue.kin === "replay" || emission.cue.kin === "reply")
    ) {
      messages.push(...emission.msgs);
    }
  }
  return messages.length > 0
    ? cesrResponse(concatBytes(...messages), 200)
    : null;
}

/** Optionally wait for escrow replay to produce direct `/logs` response bytes. */
function* deferredDirectQueryResponse(
  context: ProtocolRequestContext,
  serder: SerderKERI,
  emissions: readonly CueEmission[],
) {
  if (!context.policy.directQueryResponses) {
    return null;
  }

  const immediate = directQueryResponse(emissions);
  if (immediate || serder.ilk !== Ilks.qry || serder.route !== "logs") {
    return immediate;
  }

  const runtime = context.runtime!;
  const expires = Date.now() + DIRECT_QUERY_RESPONSE_WAIT_MS;
  while (Date.now() < expires) {
    runtime.reactor.processEscrowsOnce();
    const replayEmissions = yield* drainRuntimeCues(
      runtime,
      context.policy.serviceHab,
    );
    const response = directQueryResponse(replayEmissions);
    if (response) {
      return response;
    }
    yield* runtimeTurn();
  }
  return null;
}

/** Handle one classified generic POST/PUT CESR ingress request. */
export async function handleGenericCesrIngress(
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

  switch (ingressRoute.kind) {
    case "witnessLocalIngress":
      await run(function*() {
        yield* processWitnessIngress(runtime, ingressRoute.witnessHab, bytes, {
          local: true,
        });
      });
      return jsonNoContentResponse();
    case "runtimeIngress": {
      let response: Response | null = null;
      await run(function*() {
        const emissions = yield* processRuntimeRequest(
          runtime,
          bytes,
          ingressRoute.mailboxAid,
          context.policy.serviceHab,
        );
        response = yield* deferredDirectQueryResponse(
          context,
          serder,
          emissions,
        );
      });
      return response ?? jsonNoContentResponse();
    }
    case "mailboxQueryStream":
      await run(function*() {
        yield* processRuntimeRequest(
          runtime,
          bytes,
          ingressRoute.mailboxAid,
          context.policy.serviceHab,
        );
      });
      return querySseResponse(context, serder.said ?? null);
  }
}
