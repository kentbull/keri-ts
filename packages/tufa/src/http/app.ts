import { Hono } from "npm:hono@^4.7.11";
import type { AgentRuntime, ProtocolHostPolicy } from "../../../keri/runtime.ts";
import { createProtocolHandler } from "./protocol-handler.ts";

/**
 * Build the thin Hono shell for the Tufa HTTP edge.
 *
 * Stage 3 scope is intentionally narrow: Hono owns the edge contract and
 * testing surface, while the existing protocol composition keeps route
 * precedence and response semantics parity-stable underneath.
 */
export function createTufaApp(
  runtime?: AgentRuntime,
  policy: ProtocolHostPolicy = {},
): Hono {
  const app = new Hono();
  const handler = createProtocolHandler(runtime, policy);

  app.all("*", async (context) => {
    return await handler(context.req.raw);
  });

  return app;
}
