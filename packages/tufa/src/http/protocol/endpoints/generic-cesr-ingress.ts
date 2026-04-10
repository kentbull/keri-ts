import { Ilks, type SerderKERI } from "cesr-ts";
import { run } from "effection";
import {
  type HostedRouteResolution,
  inspectCesrRequest,
  normalizeMbxTopicCursor,
  processWitnessIngress,
  readRequiredCesrRequestBytes,
} from "keri-ts/runtime";
import { jsonNoContentResponse, textResponse } from "../responses.ts";
import { processRuntimeRequest, publishQueryCatchupReplay } from "../runtime-bridge.ts";
import type { CesrIngressRoute, ProtocolRequestContext, ProtocolRoute } from "../types.ts";

const NONE_HOSTED_ROUTE: HostedRouteResolution = {
  kind: "none",
  endpoint: null,
  relativePath: null,
};

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

/** Handle one generic POST/PUT CESR ingress request. */
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
    case "runtimeIngress":
      await run(function*() {
        yield* processRuntimeRequest(
          runtime,
          bytes,
          ingressRoute.mailboxAid,
          context.policy.serviceHab,
        );
      });
      return jsonNoContentResponse();
    case "mailboxQueryStream":
      await run(function*() {
        yield* processRuntimeRequest(
          runtime,
          bytes,
          ingressRoute.mailboxAid,
          context.policy.serviceHab,
        );
      });
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
      await run(function*() {
        const current = yield* processRuntimeRequest(
          runtime,
          bytes,
          ingressRoute.mailboxAid,
          context.policy.serviceHab,
        );
        if (ingressRoute.pre) {
          yield* publishQueryCatchupReplay(
            runtime,
            current,
            ingressRoute.pre,
            context.policy.serviceHab,
          );
        }
      });
      return jsonNoContentResponse();
  }
}
