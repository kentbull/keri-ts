import { action, type Operation } from "npm:effection@^3.6.0";
import type { OobiRecord } from "../core/records.ts";
import type { Habery } from "./habbing.ts";
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
  readonly hby: Habery;

  constructor(hby: Habery) {
    this.hby = hby;
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
    yield* this.processPendingAuth(url, record);
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
    const cid = record.cid
      ?? parseOobiUrl(url, record.oobialias ?? undefined).cid
      ?? null;
    const response = yield* fetchAuthResponse(url);
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

function* fetchAuthResponse(url: string): Operation<Response> {
  return yield* action((resolve, reject) => {
    const controller = new AbortController();
    let settled = false;
    fetch(url, { signal: controller.signal }).then((response) => {
      settled = true;
      resolve(response);
    }).catch(reject);
    return () => {
      if (!settled) {
        controller.abort();
      }
    };
  });
}

function* closeResponseBody(response: Response): Operation<void> {
  if (!response.body) {
    return;
  }

  yield* action((resolve, reject) => {
    response.body!.cancel().then(() => resolve(undefined)).catch(reject);
    return () => {};
  });
}
