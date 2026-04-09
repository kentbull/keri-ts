/**
 * Shared protocol-route composition for HTTP hosts.
 *
 * This module intentionally stays small: it builds request context, applies
 * explicit route precedence, and dispatches to endpoint modules. Transport
 * setup lives under `tufa/src/host`, while endpoint-specific HTTP semantics
 * live under `tufa/src/http/protocol`.
 */
import type { AgentRuntime, ProtocolHostPolicy } from "../../../keri/runtime.ts";
import { buildProtocolRequestContext } from "./protocol/context.ts";
import {
  classifyCesrIngressRoute,
  classifyGenericCesrIngressRoute,
  handleGenericCesrIngress,
} from "./protocol/endpoints/generic-cesr-ingress.ts";
import { classifyHealthRoute, handleHealthRoute } from "./protocol/endpoints/health.ts";
import { classifyMailboxAdminRoute, handleMailboxAdmin } from "./protocol/endpoints/mailbox-admin.ts";
import { classifyOobiRoute, handleOobiRoute, parseOobiRouteRequest } from "./protocol/endpoints/oobi.ts";
import {
  classifyWitnessHttpRoute,
  handleWitnessQueryGet,
  handleWitnessReceiptGet,
  handleWitnessReceiptPost,
} from "./protocol/endpoints/witness-http.ts";
import type { ProtocolHandler, ProtocolRequestContext, ProtocolRoute } from "./protocol/types.ts";

export { buildProtocolRequestContext } from "./protocol/context.ts";
export { classifyCesrIngressRoute } from "./protocol/endpoints/generic-cesr-ingress.ts";
export { parseOobiRouteRequest } from "./protocol/endpoints/oobi.ts";
export type {
  CesrIngressRoute,
  OobiRouteRequest,
  ProtocolHandler,
  ProtocolRequestContext,
  ProtocolRoute,
} from "./protocol/types.ts";

/** Build the shared protocol handler used by the Deno and Node HTTP hosts. */
export function createProtocolHandler(
  runtime?: AgentRuntime,
  policy: ProtocolHostPolicy = {},
): ProtocolHandler {
  return async (req: Request): Promise<Response> => {
    try {
      const context = buildProtocolRequestContext(req, runtime, policy);
      const route = classifyProtocolRoute(context);
      return await dispatchProtocolRoute(context, route);
    } catch (error) {
      return new Response(String(error), { status: 500 });
    }
  };
}

/** Classify one request by explicit endpoint precedence. */
export function classifyProtocolRoute(
  context: ProtocolRequestContext,
): ProtocolRoute {
  return classifyHealthRoute(context)
    ?? classifyMailboxAdminRoute(context)
    ?? classifyWitnessHttpRoute(context)
    ?? classifyOobiRoute(context)
    ?? classifyGenericCesrIngressRoute(context)
    ?? { kind: "notFound" };
}

/** Dispatch one already-classified route to its concrete response. */
async function dispatchProtocolRoute(
  context: ProtocolRequestContext,
  route: ProtocolRoute,
): Promise<Response> {
  switch (route.kind) {
    case "health":
      return handleHealthRoute();
    case "ambiguousHostedPath":
      return new Response(route.message, {
        status: 409,
        headers: { "Content-Type": "text/plain" },
      });
    case "mailboxAdmin":
      return await handleMailboxAdmin(
        context.runtime!,
        context.req,
        route.mailboxAid,
        context.policy.serviceHab,
      );
    case "witnessReceiptsPost":
      return await handleWitnessReceiptPost(
        context.runtime!,
        context.req,
        route.witnessHab,
      );
    case "witnessReceiptsGet":
      return handleWitnessReceiptGet(context, route.witnessHab);
    case "witnessQueryGet":
      return handleWitnessQueryGet(context, route.witnessHab);
    case "oobi":
      return handleOobiRoute(context, route.request);
    case "genericCesrIngress":
      return await handleGenericCesrIngress(context, route.hosted);
    case "notFound":
      return new Response("Not Found", {
        status: 404,
        headers: { "Content-Type": "text/plain" },
      });
  }
}
