import type { AgentRuntime, ProtocolHostPolicy } from "keri-ts/runtime";
import { Hono } from "npm:hono@^4.7.11";
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
): Hono & { close(): Promise<void> } {
  const app = new Hono();
  const policy = resolveTufaHttpAppPolicy(options.app);
  let handler = options.protocolHandler;
  let ownsHandler = false;
  if (!handler) {
    handler = createProtocolHandler(options.runtime, options.protocolPolicy ?? {});
    ownsHandler = true;
  }

  installTufaHttpPolicy(app, policy);
  installTufaHttpErrorHandling(app, policy);

  app.all("*", async (context) => {
    return await handler(context.req.raw);
  });

  return Object.assign(app, {
    /** Join the default protocol handler's file responses; injected handlers stay caller-owned. */
    async close() {
      if (ownsHandler) await handler.close?.();
    },
  });
}
