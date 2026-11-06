/**
 * Private JSON administration clients for the services a KF boot provider allocates.
 *
 * Port of kf-boot's `HioBootClient` (`kfboot/boot_client.py`): JSON request bodies with
 * `Content-Type: application/json`, an optional `Idempotency-Key` header (no upstream
 * service reads it; idempotency belongs to the boot service's own store), any status at
 * or above 400 is a typed failure, and JSON replies must be objects. The same clients
 * drive the TypeScript boot service and the cross-implementation service-admin contract,
 * so Python (witness-hk, watcher-hk, kf-registrar, kf-observer) and TypeScript roles are
 * interchangeable behind one boot URL.
 */
import { type Operation } from "effection";
import { type HttpClient, ValidationError } from "keri-ts/runtime";

/** Default per-request deadline, matching `KF_BOOT_BOOT_API_TIMEOUT_SECONDS`' default of 10s. */
export const BOOT_API_TIMEOUT_MS = 10_000;

/** A private service refused or failed a request; `status` is null when no response arrived. */
export class BootApiError extends Error {
  constructor(message: string, readonly status: number | null, readonly body = "") {
    super(message);
    this.name = "BootApiError";
  }
}

/** Witness or watcher allocation coordinates (`{"cid","eid","oobis"}`). */
export interface ServiceAllocation {
  cid: string;
  eid: string;
  oobis: string[];
}

/** One registrar/observer account enrollment acknowledgement (`{"aid","roles","service"}`). */
export interface ServiceEnrollment {
  aid: string;
  roles: string[];
  service: string;
}

/** Optional per-request idempotency key, forwarded but never interpreted by services. */
export interface IdempotentRequest {
  idempotencyKey?: string;
}

/** Shared transport: one private boot URL, JSON in and out, typed failures. */
class ServiceAdmin {
  readonly base: string;

  constructor(base: string, readonly http: HttpClient, readonly timeoutMs = BOOT_API_TIMEOUT_MS) {
    const url = new URL(base);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new ValidationError("Service boot URL must be an HTTP(S) origin without credentials.");
    }
    this.base = url.href.replace(/\/+$/, "");
  }

  /** Issue one request and return the decoded status and text body; failures carry the service's text. */
  protected *send(
    method: string,
    path: string,
    json?: Record<string, unknown>,
    idempotencyKey = "",
  ): Operation<{ status: number; text: string }> {
    const headers: Record<string, string> = {};
    if (json !== undefined) {
      headers["Content-Type"] = "application/json";
      if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    }
    let response;
    try {
      response = yield* this.http.request(this.base + path, {
        method,
        headers,
        body: json === undefined ? null : JSON.stringify(json),
        redirect: "error",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      throw new BootApiError(`Boot API request failed: ${(error as Error)?.message ?? error}`, null);
    }
    const text = new TextDecoder().decode(response.body).trim();
    if (response.status >= 400) throw new BootApiError(text || `HTTP ${response.status}`, response.status, text);
    return { status: response.status, text };
  }

  /** Require a JSON object reply, as `_responseJson` does. */
  protected *json(
    method: string,
    path: string,
    body?: Record<string, unknown>,
    idempotencyKey = "",
  ): Operation<Record<string, unknown>> {
    const { status, text } = yield* this.send(method, path, body, idempotencyKey);
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch (error) {
      throw new BootApiError(`Invalid JSON from boot API: ${(error as Error).message}`, status, text);
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new BootApiError("Invalid JSON from boot API: expected object", status, text);
    }
    return value as Record<string, unknown>;
  }
}

/** Require the coordinates the boot service records for an allocated witness or watcher. */
function allocation(value: Record<string, unknown>, status: number | null = 200): ServiceAllocation {
  const { cid, eid, oobis } = value;
  if (
    typeof cid !== "string" || typeof eid !== "string" || !eid || !Array.isArray(oobis)
    || !oobis.every(oobi => typeof oobi === "string")
  ) throw new BootApiError("Allocation reply lacks cid, eid or oobis", status, JSON.stringify(value));
  return { cid, eid, oobis: oobis as string[] };
}

/** witness-hk boot API: `POST /witnesses`, `DELETE /witnesses/{eid}`. */
export class WitnessAdmin extends ServiceAdmin {
  /** Allocate one witness for the account controller. */
  *allocate(aid: string, options: IdempotentRequest = {}): Operation<ServiceAllocation> {
    return allocation(yield* this.json("POST", "/witnesses", { aid }, options.idempotencyKey));
  }

  /** Retire one allocated witness; 404 for an unknown witness is a typed failure. */
  *remove(eid: string): Operation<void> {
    yield* this.send("DELETE", `/witnesses/${eid}`);
  }
}

/** watcher-hk boot API: `POST /watchers`, `GET /watchers/{eid}/status`, `DELETE /watchers/{eid}`. */
export class WatcherAdmin extends ServiceAdmin {
  /** Allocate one watcher, optionally queueing resolution of the controller's OOBI. */
  *allocate(aid: string, options: IdempotentRequest & { oobi?: string } = {}): Operation<ServiceAllocation> {
    const body: Record<string, unknown> = { aid };
    if (options.oobi) body.oobi = options.oobi;
    return allocation(yield* this.json("POST", "/watchers", body, options.idempotencyKey));
  }

  /** Return the watcher's observation JSON (`watcher_id`, `controller_id`, `aids`, `summary`). */
  *status(eid: string): Operation<Record<string, unknown>> {
    return yield* this.json("GET", `/watchers/${eid}/status`);
  }

  /** Retire one allocated watcher. */
  *remove(eid: string): Operation<void> {
    yield* this.send("DELETE", `/watchers/${eid}`);
  }
}

/** kf-registrar / kf-observer boot API: `PUT|GET|DELETE /accounts/{aid}`. */
export class RegistryAdmin extends ServiceAdmin {
  /** Enroll exactly the supplied public KEL (qb64 text) and roles. */
  *enroll(aid: string, roles: readonly string[], kel: string, options: IdempotentRequest = {}): Operation<
    ServiceEnrollment
  > {
    return enrollment(yield* this.json("PUT", `/accounts/${aid}`, { roles: [...roles], kel }, options.idempotencyKey));
  }

  /** Read one enrollment; 404 when the account is not enrolled. */
  *account(aid: string): Operation<ServiceEnrollment> {
    return enrollment(yield* this.json("GET", `/accounts/${aid}`));
  }

  /** Revoke one dynamic enrollment; services delete idempotently. */
  *remove(aid: string): Operation<void> {
    yield* this.send("DELETE", `/accounts/${aid}`);
  }
}

/** Require the acknowledgement fields kf-boot compares before activating a capability. */
function enrollment(value: Record<string, unknown>): ServiceEnrollment {
  const { aid, roles, service } = value;
  if (
    typeof aid !== "string" || typeof service !== "string" || !Array.isArray(roles)
    || !roles.every(role => typeof role === "string")
  ) throw new BootApiError("Enrollment reply lacks aid, roles or service", 200, JSON.stringify(value));
  return { aid, roles: roles as string[], service };
}
