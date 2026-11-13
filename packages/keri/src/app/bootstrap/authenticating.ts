import { call, type Operation, scoped } from "npm:effection@^3.6.0";
import type { OobiRecord } from "../../core/records.ts";
import type { Baser } from "../../db/basing.ts";
import type { Habery } from "../identity/habbing.ts";
import { persistResolvedContact } from "../identity/organizing.ts";
import { type DoerPacing, doEveryOnWrite, PROTOCOL_PACING } from "../runtime/doing.ts";
import { type RuntimeClock, systemClock } from "../runtime/runtime-clock.ts";
import { type HttpClient, isRequestableHttpUrl } from "../transport/http-client.ts";
import { isWellKnownOobiUrl, type OobiJobFailure, oobiJobFailure, parseOobiUrl } from "./oobiery.ts";

/** Terminal `rmfa.` state of one well-known authentication. */
type AuthState = "resolved" | `http-${number}` | OobiJobFailure;

/**
 * Return true when a well-known URL has been authorized into `wkas.`.
 *
 * @param db Borrowed authentication records; this read acquires no runtime or I/O lifetime.
 * @param url Exact requested OOBI/well-known URL whose durable state is inspected.
 * @returns Whether the documented authentication/convergence predicate currently holds.
 */
export function hasWellKnownAuth(
  db: Baser,
  url: string,
): boolean {
  const cid = parseOobiUrl(url).cid;
  if (!cid) {
    return false;
  }
  return db.wkas.get(cid).some((record) => record.url === url);
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
  /** Borrowed local identities and durable well-known authentication records. */
  readonly hby: Habery;
  /** HTTP implementation selected when this authenticator is composed. */
  readonly http: HttpClient;

  /**
   * Bind the local authentication store and its configured HTTP dependency.
   *
   * @param hby Borrowed local identities and accepted-state stores.
   * @param http Borrowed HTTP implementation selected by composition.
   */
  constructor(hby: Habery, http: HttpClient) {
    this.hby = hby;
    this.http = http;
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
  *authDo(clock: RuntimeClock = systemClock, pacing: Readonly<DoerPacing> = PROTOCOL_PACING): Operation<never> {
    return yield* doEveryOnWrite(clock, pacing, this.hby.db, () => this.processOnce());
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

  /**
   * Fetch one `mfa.` record and persist the terminal auth result. A URL the HTTP client refuses, a refused or failed
   * request, or a non-OK status each end this authentication as failed in `rmfa.` and remove its `mfa.` row, so the
   * next pass takes the next one; any other error is a fault and propagates.
   *
   * @param url Exact pending well-known authentication URL.
   * @param record Durable mfa record retained until response handling and cleanup establish terminal state.
   */
  private *processPendingAuth(
    url: string,
    record: OobiRecord,
  ): Operation<void> {
    const cid = record.cid
      ?? parseOobiUrl(url, record.oobialias ?? undefined).cid
      ?? null;
    const state = yield* this.authenticate(url);
    const date = new Date().toISOString();
    const ok = state === "resolved";

    this.hby.db.mfa.rem(url);
    this.hby.db.rmfa.pin(url, {
      ...record,
      date,
      state,
      cid,
    });

    if (ok && cid) {
      this.hby.db.wkas.add(cid, { url, dt: date });
      persistResolvedContact(this.hby, cid, {
        alias: record.oobialias,
        oobi: url,
      });
    }
  }

  /**
   * Request one well-known URL and read only its status; the response owner still joins body cleanup.
   *
   * @param url Pending well-known authentication URL.
   * @returns The terminal state: `resolved` for an OK status, `http-<status>` otherwise, or the
   *   {@link OobiJobFailure} of a URL the client refuses or a refused or failed request.
   */
  private *authenticate(url: string): Operation<AuthState> {
    if (!isRequestableHttpUrl(url)) return "url-refused";
    const http = this.http;
    try {
      return yield* scoped(function*(): Operation<AuthState> {
        const response = yield* http.open(url);
        return response.ok ? "resolved" : `http-${response.status}`;
      });
    } catch (error) {
      const failure = oobiJobFailure(error);
      if (failure === null) throw error;
      return failure;
    }
  }
}
