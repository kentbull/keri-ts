import { call, type Operation, scoped } from "npm:effection@^3.6.0";
import type { OobiRecord } from "../core/records.ts";
import type { Habery } from "./habbing.ts";
import type { HttpClient } from "./http-client.ts";
import { isWellKnownOobiUrl, parseOobiUrl } from "./oobiery.ts";
import { persistResolvedContact } from "./organizing.ts";
import { runtimeTurn } from "./runtime-turn.ts";

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

  /** Bind the local authentication store and its configured HTTP dependency. */
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
    // Only HTTP status is needed; the response owner still joins body cleanup.
    const cid = record.cid
      ?? parseOobiUrl(url, record.oobialias ?? undefined).cid
      ?? null;
    const http = this.http;
    const response = yield* scoped(function*() {
      const response = yield* http.open(url);
      return { ok: response.ok, status: response.status };
    });
    const date = new Date().toISOString();
    const state = response.ok ? "resolved" : `http-${response.status}`;

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
