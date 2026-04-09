import type { Hono, MiddlewareHandler } from "npm:hono@^4.7.11";
import { consoleLogger, type Logger } from "../../../keri/src/core/logger.ts";
import { normalizeProtocolPath } from "./protocol/context.ts";

/** Fixed CORS policy owned by the Stage 4 Tufa HTTP edge. */
export interface TufaCorsPolicy {
  readonly allowOrigin: string;
  readonly allowMethods: readonly string[];
  readonly allowHeaders: readonly string[];
  readonly exposeHeaders: readonly string[];
}

/** App-level Stage 4 policy for the Hono middleware envelope. */
export interface TufaHttpAppPolicy {
  readonly logger: Logger;
  readonly cors: TufaCorsPolicy;
}

/** Call-site options used to resolve the concrete app policy. */
export interface TufaHttpAppOptions {
  readonly logger?: Logger;
  readonly cors?: Partial<TufaCorsPolicy>;
}

export const DEFAULT_TUFA_CORS_POLICY: TufaCorsPolicy = Object.freeze({
  allowOrigin: "*",
  allowMethods: Object.freeze(["GET", "POST", "PUT", "OPTIONS"]),
  allowHeaders: Object.freeze([
    "Content-Type",
    "CESR-ATTACHMENT",
    "CESR-DESTINATION",
    "Oobi-Aid",
  ]),
  exposeHeaders: Object.freeze([
    "Content-Type",
    "KERI-AID",
    "Oobi-Aid",
  ]),
});

/** Resolve one app policy with Stage 4 defaults. */
export function resolveTufaHttpAppPolicy(
  options: TufaHttpAppOptions = {},
): TufaHttpAppPolicy {
  return {
    logger: options.logger ?? consoleLogger,
    cors: {
      allowOrigin: options.cors?.allowOrigin
        ?? DEFAULT_TUFA_CORS_POLICY.allowOrigin,
      allowMethods: options.cors?.allowMethods
        ?? DEFAULT_TUFA_CORS_POLICY.allowMethods,
      allowHeaders: options.cors?.allowHeaders
        ?? DEFAULT_TUFA_CORS_POLICY.allowHeaders,
      exposeHeaders: options.cors?.exposeHeaders
        ?? DEFAULT_TUFA_CORS_POLICY.exposeHeaders,
    },
  };
}

/** Install the Stage 4 middleware envelope onto one Hono app. */
export function installTufaHttpPolicy(
  app: Hono,
  policy: TufaHttpAppPolicy,
): void {
  app.use("*", createTufaHttpPolicyMiddleware(policy));
}

function createTufaHttpPolicyMiddleware(
  policy: TufaHttpAppPolicy,
): MiddlewareHandler {
  return async (context, next) => {
    const startedAt = performance.now();

    if (context.req.method === "OPTIONS") {
      const response = new Response(null, { status: 204 });
      applyTufaCorsHeaders(response.headers, policy.cors);
      logRequest(policy.logger, context.req.url, context.req.method, 204, startedAt);
      return response;
    }

    await next();
    applyTufaCorsHeaders(context.res.headers, policy.cors);
    logRequest(
      policy.logger,
      context.req.url,
      context.req.method,
      context.res.status,
      startedAt,
    );
  };
}

/** Apply the resolved Stage 4 CORS policy to one response header set. */
export function applyTufaCorsHeaders(
  headers: Headers,
  policy: TufaCorsPolicy,
): void {
  headers.set("Access-Control-Allow-Origin", policy.allowOrigin);
  headers.set(
    "Access-Control-Allow-Methods",
    policy.allowMethods.join(", "),
  );
  headers.set(
    "Access-Control-Allow-Headers",
    policy.allowHeaders.join(", "),
  );
  headers.set(
    "Access-Control-Expose-Headers",
    policy.exposeHeaders.join(", "),
  );
}

function logRequest(
  logger: Logger,
  rawUrl: string,
  method: string,
  status: number,
  startedAt: number,
): void {
  const pathname = normalizeProtocolPath(new URL(rawUrl).pathname);
  const durationMs = Math.max(0, performance.now() - startedAt).toFixed(1);
  logger.info(`${method} ${pathname} -> ${status} ${durationMs}ms`);
}
