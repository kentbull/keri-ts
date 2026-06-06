import { AppError, DatabaseError, PathError, ValidationError } from "keri-ts/runtime";
import type { Context, Hono } from "npm:hono@^4.7.11";
import { applyTufaCorsHeaders } from "./policy.ts";
import type { TufaHttpAppPolicy } from "./policy.ts";
import { textResponse } from "./protocol/responses.ts";

/** Map one unhandled edge error into the Stage 4 HTTP response contract. */
export function mapTufaHttpError(
  error: unknown,
  policy: TufaHttpAppPolicy,
): Response {
  if (error instanceof ValidationError) {
    return textResponse(error.message, 400);
  }

  logUnhandledHttpError(error, policy);
  return textResponse("Internal Server Error", 500);
}

/** Install the centralized Stage 4 app-level error mapping. */
export function installTufaHttpErrorHandling(
  app: Hono,
  policy: TufaHttpAppPolicy,
): void {
  app.onError((error: Error, _context: Context) => {
    const response = mapTufaHttpError(error, policy);
    applyTufaCorsHeaders(response.headers, policy.cors);
    return response;
  });
}

function logUnhandledHttpError(
  error: unknown,
  policy: TufaHttpAppPolicy,
): void {
  if (error instanceof PathError || error instanceof DatabaseError) {
    policy.logger.error("Unhandled HTTP app error", error, error.context);
    return;
  }
  if (error instanceof AppError) {
    policy.logger.error("Unhandled HTTP app error", error, error.context);
    return;
  }
  policy.logger.error("Unhandled HTTP app error", error);
}
