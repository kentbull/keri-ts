import { ResourceAdmissionError } from "cesr-ts";
import { call, type Operation, resource } from "npm:effection@^3.6.0";
import type { OobiRecord } from "../core/records.ts";
import type { Habery } from "./habbing.ts";
import { closeResponseBody, fetchResponseHandle } from "./httping.ts";
import { isWellKnownOobiUrl, parseOobiUrl } from "./oobiery.ts";
import { persistResolvedContact } from "./organizing.ts";
import { resolveRuntimeServices, type RuntimeServices } from "./runtime-services.ts";
import { runtimeTurn } from "./runtime-turn.ts";

interface AuthenticatorOptions {
  services?: RuntimeServices;
}

/**
 * Well-known OOBI authenticator for one `Habery`.
 *
 * KERIpy correspondence:
 * - mirrors the `Authenticator` flow that advances `woobi.` -> `mfa.` ->
 *   `rmfa.` and writes `wkas.`
 *
 * Ownership model:
 * - `woobi.` holds queued well-known auth work
 * - `mfa.` holds one pending HTTP authorization request
 * - `rmfa.` holds terminal well-known auth results
 * - `wkas.` records successful `(cid, url)` authorizations
 */
export class Authenticator {
  readonly hby: Habery;
  readonly services: RuntimeServices;

  constructor(hby: Habery, options: AuthenticatorOptions = {}) {
    const services = options.services ?? resolveRuntimeServices({ resources: hby.db.resources });
    if (services.resources !== hby.db.resources) {
      throw new RangeError("Authenticator requires its Habery's resource policy");
    }
    this.hby = hby;
    this.services = services;
  }

  /** Process one bounded auth step if queued well-known work exists. */
  *processOnce(): Operation<void> {
    if (this.promoteQueuedWellKnown()) {
      return;
    }

    const item = this.nextPendingAuth();
    if (!item) {
      return;
    }

    const [url, record] = item;
    // Each authentication owns a finite response scope inside the long-lived worker.
    yield* call(() => this.processPendingAuth(url, record));
  }

  /** Continuous auth doer for long-lived runtime hosts. */
  *authDo(): Operation<never> {
    while (true) {
      yield* this.processOnce();
      yield* runtimeTurn();
    }
  }

  /** Promote one eligible `woobi.` record into the fetchable `mfa.` queue. */
  private promoteQueuedWellKnown(): boolean {
    for (const [keys, record] of this.hby.db.woobi.getTopItemIter()) {
      const url = keys[0];
      if (!url) {
        continue;
      }

      const cid = record.cid
        ?? parseOobiUrl(url, record.oobialias ?? undefined).cid
        ?? null;
      if (!isWellKnownOobiUrl(url) || !cid) {
        this.hby.db.woobi.rem(url);
        this.hby.db.rmfa.pin(url, {
          ...record,
          date: new Date().toISOString(),
          state: "invalid-well-known",
          cid,
        });
        return true;
      }

      if (!this.hby.db.getKever(cid)) {
        continue;
      }

      this.hby.db.woobi.rem(url);
      this.hby.db.mfa.pin(url, {
        ...record,
        date: new Date().toISOString(),
        state: "auth-pending",
        cid,
      });
      return true;
    }

    return false;
  }

  /** Return the next pending `mfa.` auth record, if any. */
  private nextPendingAuth(): [string, OobiRecord] | null {
    for (const [keys, record] of this.hby.db.mfa.getTopItemIter()) {
      const url = keys[0];
      if (!url) {
        continue;
      }
      return [url, record];
    }

    return null;
  }

  /** Fetch one `mfa.` record and persist the terminal auth result. */
  private *processPendingAuth(
    url: string,
    record: OobiRecord,
  ): Operation<void> {
    // This endpoint uses only HTTP status, never an unbounded body collector.
    // Logical request/handle allowance does not bound native headers or fetch buffers.
    const admission = this.services.resources.reserve({ streams: 1, bytes: 64 * 1024 + 128 + 2 * url.length });
    if (admission.kind === "refuse") {
      if (admission.reason === "busy") return; // Leave the existing durable pending head untouched.
      throw new ResourceAdmissionError("Well-known HTTP request exceeds configured capacity", admission.reason);
    }
    // Registered before fetch: its response and late cleanup finish before this permit returns.
    yield* resource<void>(function*(provide) {
      try {
        yield* provide();
      } finally {
        admission.reservation.release();
      }
    });
    const cid = record.cid
      ?? parseOobiUrl(url, record.oobialias ?? undefined).cid
      ?? null;
    const response = yield* fetchAuthResponse(url, this.services);
    const date = new Date().toISOString();
    const state = response.ok ? "resolved" : `http-${response.status}`;
    yield* closeResponseBody(response);

    this.hby.db.mfa.rem(url);
    this.hby.db.rmfa.pin(url, {
      ...record,
      date,
      state,
      cid,
    });

    if (response.ok && cid) {
      this.hby.db.wkas.add(cid, { url, dt: date });
      persistResolvedContact(this.hby, cid, {
        alias: record.oobialias,
        oobi: url,
      });
    }
  }
}

function* fetchAuthResponse(
  url: string,
  services: RuntimeServices,
): Operation<Response> {
  const { response } = yield* fetchResponseHandle(url, {}, {
    services,
  });
  return response;
}
