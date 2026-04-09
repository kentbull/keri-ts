import { Hono } from "npm:hono@^4.7.11";
import type { AgentRuntime, ProtocolHostPolicy } from "../../../keri/runtime.ts";
import { installTufaHttpErrorHandling } from "./error-mapping.ts";
import { installTufaHttpPolicy, resolveTufaHttpAppPolicy, type TufaHttpAppOptions } from "./policy.ts";
import { createProtocolHandler } from "./protocol-handler.ts";
import type { ProtocolHandler } from "./protocol/types.ts";

/** Construction options for the Stage 4 Tufa HTTP app edge. */
export interface CreateTufaAppOptions {
  readonly runtime?: AgentRuntime;
  readonly protocolPolicy?: ProtocolHostPolicy;
  readonly app?: TufaHttpAppOptions;
  readonly protocolHandler?: ProtocolHandler;
}

/**
 * Build the Stage 4 Hono shell for the Tufa HTTP edge.
 *
 * Stage 4 keeps route semantics inside the protocol handler while moving
 * cross-cutting HTTP policy into explicit Tufa-owned middleware and error
 * mapping.
 */
export function createTufaApp(
  options: CreateTufaAppOptions = {},
): Hono {
  const app = new Hono();
  const policy = resolveTufaHttpAppPolicy(options.app);
  const handler = options.protocolHandler
    ?? createProtocolHandler(options.runtime, options.protocolPolicy ?? {});

  installTufaHttpPolicy(app, policy);
  installTufaHttpErrorHandling(app, policy);

  app.all("*", async (context) => {
    return await handler(context.req.raw);
  });

  return app;
}
