/** Business notification JSON and one scoped status-only HTTP attempt. */
import type { SerderACDC } from "cesr-ts";
import { call, type Operation } from "effection";
import { type HttpClient, TransportError, type VcStateRecordShape } from "keri-ts/runtime";
import { credentialSchema } from "./policy.ts";

export interface VerifierWebhookBody {
  action: "iss" | "rev";
  actor: string;
  data: Record<string, unknown>;
}

/** Project an accepted credential and selected revocation state without changing protocol evidence. */
export function webhookBody(
  creder: SerderACDC,
  action: "iss" | "rev",
  state: VcStateRecordShape | null,
): VerifierWebhookBody {
  const actor = creder.issuer ?? "";
  const data = action === "iss" ? presentationPayload(creder) : revocationPayload(creder, state);
  return { action, actor, data };
}

/** Preserve the supported legacy attribute projection; this adds no authentication. */
function presentationPayload(creder: SerderACDC): Record<string, unknown> {
  const attrs = isRecord(creder.attrib) ? creder.attrib : {};
  return {
    schema: credentialSchema(creder),
    issuer: creder.issuer,
    issueTimestamp: typeof attrs.dt === "string" ? attrs.dt : undefined,
    credential: creder.said,
    recipient: typeof attrs.i === "string" ? attrs.i : undefined,
    attributes: attrs,
    edge: creder.edge ?? undefined,
  };
}

/** Report the accepted TEL timestamp rather than the local delivery-attempt clock. */
function revocationPayload(creder: SerderACDC, state: VcStateRecordShape | null): Record<string, unknown> {
  return {
    schema: credentialSchema(creder),
    credential: creder.said,
    revocationTimestamp: state?.dt,
  };
}

/** Return HTTP success only after response cleanup; no receipt or exactly-once delivery is inferred. */
export function* postWebhook(
  http: HttpClient,
  now: () => number,
  hook: string,
  body: VerifierWebhookBody,
): Operation<boolean> {
  const raw = JSON.stringify(body);
  try {
    return yield* call(function*() {
      const response = yield* http.open(hook, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "sally-resource": String(body.data.schema ?? ""),
          "sally-timestamp": new Date(now()).toISOString(),
        },
        body: raw,
      });
      // Returning from this call scope closes the unread response before publishing success.
      return response.ok;
    });
  } catch (error) {
    if (error instanceof TransportError) return false;
    throw error;
  }
}

/** ACDC attributes are protocol/schema data; narrow the mapping before projecting webhook fields. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
