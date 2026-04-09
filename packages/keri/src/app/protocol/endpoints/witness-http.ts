import { ValidationError } from "../../../core/errors.ts";
import type { AgentRuntime } from "../../agent-runtime.ts";
import { readRequiredCesrRequestBytes } from "../../cesr-http.ts";
import { type Hab } from "../../habbing.ts";
import { processWitnessIngress, witnessQueryGet, witnessReceiptGet, witnessReceiptPost } from "../../witnessing.ts";
import { cesrResponse, textResponse } from "../responses.ts";
import type { ProtocolRequestContext, ProtocolRoute } from "../types.ts";

/** Classify witness-only `/receipts` and `/query` routes ahead of generic ingress. */
export function classifyWitnessHttpRoute(
  context: ProtocolRequestContext,
): ProtocolRoute | null {
  if (!context.runtime || !context.options.witnessHab) {
    return null;
  }
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
  return null;
}

/** Handle one witness `/receipts` POST request. */
export async function handleWitnessReceiptPost(
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
export function handleWitnessReceiptGet(
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
export function handleWitnessQueryGet(
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
