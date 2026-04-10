import { textResponse } from "../responses.ts";
import type { ProtocolRequestContext, ProtocolRoute } from "../types.ts";

/** Classify `/health` before any runtime-aware routing. */
export function classifyHealthRoute(
  context: ProtocolRequestContext,
): ProtocolRoute | null {
  return context.pathname === "/health" ? { kind: "health" } : null;
}

/** Return the fixed health response. */
export function handleHealthRoute(): Response {
  return textResponse("ok", 200);
}
