/**
 * TypeScript kf-boot session cleanup: an expired onboarding session's witnesses and watcher
 * are deleted on their backends by the periodic sweep, which then stamps
 * `resources_cleaned_at` so the same account AID can start again (kf-boot `expiring.py`
 * `_processSessionCleanupDo`). A failed teardown keeps the session pending and is retried.
 */
import { type Operation, run } from "effection";
import { assert, assertEquals, assertRejects } from "jsr:@std/assert";
import { FetchHttpClient, type Hab, type HttpClient, type HttpRequestInit, type HttpResponse } from "keri-ts/runtime";
import type { KfBootClient } from "../src/operator/kfboot/client.ts";
import { startProvider, wallet } from "./contract/kf-provider.ts";

/** Backend admin client whose DELETEs answer 503 while `failing` is set. */
class FlakyDeletes extends FetchHttpClient implements HttpClient {
  failing = false;
  override request(url: string, init: HttpRequestInit = {}): Operation<HttpResponse> {
    if (this.failing && init.method === "DELETE") {
      const body = new TextEncoder().encode("Backend unavailable");
      return (function*() {
        return { status: 503, ok: false, headers: new Headers(), body };
      })();
    }
    return super.request(url, init);
  }
}

/** Outlast the 2 s session lease; status reads of an open session would refresh it. */
const lapse = () => new Promise((resolve) => setTimeout(resolve, 2_500));

/** Poll session status until `done`; status reads of a closed session never refresh its lease. */
async function until(
  client: KfBootClient,
  session: string,
  done: (payload: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 30_000;
  while (true) {
    const payload = (await run(() => client.session(session))).payload;
    if (done(payload)) return payload;
    if (Date.now() > deadline) throw new Error("Session did not reach the expected state: " + JSON.stringify(payload));
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Start a session and wait (refreshing its lease) until every witness and the watcher exist. */
async function provisioned(client: KfBootClient, account: Hab, profile: string, count: number) {
  const started = await run(() => client.start(account.pre, "account", profile));
  const session = String(started.payload.session_id);
  const state = await until(
    client,
    session,
    (payload) => Array.isArray(payload.witnesses) && payload.witnesses.length === count && !!payload.watcher,
  );
  return {
    session,
    witnesses: (state.witnesses as Record<string, unknown>[]).map((row) => ({
      eid: String(row.eid),
      boot: String(row.boot_url),
    })),
    watcher: { eid: String((state.watcher as Record<string, unknown>).eid), boot: "" },
  };
}

/** Status of a DELETE straight to a backend's admin API: 404 proves the allocation is gone. */
async function backendDelete(boot: string, path: string): Promise<number> {
  const response = await fetch(`${boot}${path}`, { method: "DELETE" });
  await response.body?.cancel();
  return response.status;
}

Deno.test("boot service: the sweep reclaims an expired session's resources and unblocks a restart", async () => {
  const folder = await Deno.makeTempDir({ prefix: "tufa-boot-cleanup-" });
  const http = new FlakyDeletes();
  const provider = await startProvider(folder, { SESSION_TTL_SECONDS: "2", CLEANUP_INTERVAL_SECONDS: "0.2" }, {
    http,
  });
  const store = await wallet(provider.url);
  try {
    const health = await (await fetch(provider.url + "/health")).json();
    assertEquals(health.cleanup, { configured: true, expected_running: true, running: true });

    // Four witnesses and a watcher, then the session lapses before account/create.
    const account = store.hby.makeHab("account"), signer = store.hby.makeHab("signer");
    const client = await store.client(signer);
    const first = await provisioned(client, account, "3-of-4", 4);
    await lapse();
    const cleaned = await until(client, first.session, (payload) => !!payload.resources_cleaned_at);
    assertEquals(cleaned.state, "expired");
    assertEquals(cleaned.witnesses, []);
    assertEquals(cleaned.watcher, null);
    for (const witness of first.witnesses) {
      assertEquals(await backendDelete(witness.boot, `/witnesses/${witness.eid}`), 404, "witness deleted");
    }
    assertEquals(await backendDelete(provider.watcher.boot, `/watchers/${first.watcher.eid}`), 404, "watcher deleted");

    // The same account AID starts a fresh session.
    const restarted = await run(() => client.start(account.pre, "account", "3-of-4"));
    assert(restarted.payload.session_id !== first.session);
    assertEquals(restarted.payload.state, "started");
    await run(() => client.cancel(String(restarted.payload.session_id)));

    // A failed teardown leaves the session pending (409 on restart) and is retried.
    const blocked = store.hby.makeHab("blocked"), other = store.hby.makeHab("other-signer");
    const otherClient = await store.client(other);
    http.failing = true;
    const second = await provisioned(otherClient, blocked, "1-of-1", 1);
    await lapse();
    const failed = await until(
      otherClient,
      second.session,
      (payload) => String(payload.failure_reason).startsWith("Cleanup failed after expiry"),
    );
    assertEquals(failed.state, "expired");
    assertEquals(failed.resources_cleaned_at, "");
    const refused = await assertRejects(() => run(() => otherClient.start(blocked.pre, "blocked", "1-of-1")));
    assertEquals((refused as { status?: number }).status, 409);

    http.failing = false;
    await until(otherClient, second.session, (payload) => !!payload.resources_cleaned_at);
    assertEquals(await backendDelete(second.witnesses[0].boot, `/witnesses/${second.witnesses[0].eid}`), 404);
    assertEquals(await backendDelete(provider.watcher.boot, `/watchers/${second.watcher.eid}`), 404);
    const resumed = await run(() => otherClient.start(blocked.pre, "blocked", "1-of-1"));
    assertEquals(resumed.payload.state, "started");
    await run(() => otherClient.cancel(String(resumed.payload.session_id)));
  } finally {
    await store.close();
    await provider.stop();
    await Deno.remove(folder, { recursive: true });
  }
});
