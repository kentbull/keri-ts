/**
 * TypeScript kf-boot core: transport status table, discovery and onboarding-session routes.
 *
 * Ports representative cases of kf-boot `tests/test_surfaces.py` and
 * `tests/test_onboarding_routes.py`, driven by the unchanged Tufa `KfBootClient` against
 * real in-process TypeScript witness and watcher backends.
 */
import { Vrsn_2_0 } from "cesr-ts";
import { run } from "effection";
import { assert, assertEquals, assertRejects } from "jsr:@std/assert";
import { acceptedEventReplayMessage, exchange, type Hab, reply } from "keri-ts/runtime";
import { bootServiceConfig } from "../src/roles/boot-service.ts";
import {
  framed,
  locksmithServiceSettings,
  onboard,
  post,
  settled,
  startProvider,
  wallet,
} from "./contract/kf-provider.ts";
import { startRegistries } from "./contract/services.ts";

Deno.test("boot service: discovery, health and the CESR transport table", async () => {
  const folder = await Deno.makeTempDir({ prefix: "tufa-boot-transport-" });
  const provider = await startProvider(folder);
  const store = await wallet(provider.url);
  try {
    const health = await (await fetch(provider.url + "/health")).json();
    assertEquals(health.status, "ok");
    const discovery = await (await fetch(provider.url + "/bootstrap/config")).json();
    assertEquals(discovery, {
      bootstrap: {
        account_options: [{ code: "1-of-1", witness_count: 1, toad: 1 }, { code: "3-of-4", witness_count: 4, toad: 3 }],
        watcher_required: true,
      },
      region: { id: "nyc", name: "New York" },
      surfaces: {
        onboarding: { path: "/onboarding", url: provider.url + "/onboarding" },
        account: { path: "/account", url: provider.url + "/account" },
      },
    });
    const options = await fetch(provider.url + "/onboarding", { method: "OPTIONS" });
    await options.body?.cancel();
    // kf-boot answers 200; the shared Tufa host answers every CORS preflight 204. Both are 2xx.
    assert(options.ok);

    const signer = store.hby.makeHab("signer"), stranger = store.hby.makeHab("stranger");
    const onboarding = provider.url + "/onboarding";
    const request = (hab: Hab, route: string, payload: Record<string, unknown> = {}) => {
      const [message] = exchange(route, payload, {
        sender: hab.pre,
        recipient: "",
        version: Vrsn_2_0,
        gvrsn: Vrsn_2_0,
      });
      return framed(hab.endorse(message, { gvrsn: Vrsn_2_0 }));
    };
    const inception = framed(acceptedEventReplayMessage(store.hby, signer.pre, 0, Vrsn_2_0).message);

    assertEquals(
      (await post(onboarding, inception.body, { ...inception.headers, "Content-Type": "application/json" })).status,
      406,
    );
    assertEquals((await post(onboarding, inception.body, { ...inception.headers, "CESR-Genus": "3" })).status, 400);
    assertEquals((await post(onboarding, "{not json", inception.headers)).status, 400);
    assertEquals((await post(onboarding, inception.body, { "Content-Type": "application/cesr" })).status, 412);
    const replyMessage = framed(signer.endorse(
      reply("/loc/scheme", { eid: signer.pre, scheme: "http", url: "http://x" }, {
        pre: signer.pre,
        pvrsn: Vrsn_2_0,
        gvrsn: Vrsn_2_0,
      }),
      { gvrsn: Vrsn_2_0 },
    ));
    assertEquals((await post(onboarding, replyMessage.body, replyMessage.headers)).status, 400);
    const unknown = request(signer, "/onboarding/nowhere");
    assertEquals((await post(onboarding, unknown.body, unknown.headers)).status, 404);
    const misplaced = request(signer, "/account/services");
    assertEquals((await post(onboarding, misplaced.body, misplaced.headers)).status, 404);
    const early = request(signer, "/onboarding/session/status", { session_id: "sess_x" });
    const unknownSender = await post(onboarding, early.body, early.headers);
    assertEquals(unknownSender.status, 401);
    assertEquals(JSON.parse(unknownSender.text).title, "Unknown sender key state");

    // Events are accepted (204); an event ahead of accepted state is pending (409).
    assertEquals((await post(onboarding, inception.body, inception.headers)).status, 204);
    stranger.interact();
    stranger.interact();
    const strangerIcp = framed(acceptedEventReplayMessage(store.hby, stranger.pre, 0, Vrsn_2_0).message);
    assertEquals((await post(onboarding, strangerIcp.body, strangerIcp.headers)).status, 204);
    const ahead = framed(acceptedEventReplayMessage(store.hby, stranger.pre, 2, Vrsn_2_0).message);
    const pending = await post(onboarding, ahead.body, ahead.headers);
    assertEquals(pending.status, 409);
    assertEquals(JSON.parse(pending.text).title, "Key state pending");

    // A known sender's request: missing session is 404, missing payload field 400, unsigned 401.
    const missing = request(signer, "/onboarding/session/status", { session_id: "sess_missing" });
    assertEquals((await post(onboarding, missing.body, missing.headers)).status, 404);
    const invalid = request(signer, "/onboarding/session/start", { account_aid: stranger.pre });
    assertEquals((await post(onboarding, invalid.body, invalid.headers)).status, 400);
    const unsigned = request(signer, "/onboarding/session/status", { session_id: "sess_missing" });
    assertEquals(
      (await post(onboarding, unsigned.body, { "Content-Type": "application/cesr", "CESR-ATTACHMENT": "" })).status,
      401,
    );
  } finally {
    await store.close();
    await provider.stop();
    await Deno.remove(folder, { recursive: true });
  }
});

Deno.test("boot service: session start provisions witnesses and watcher; reuse, conflicts and cancel", async () => {
  const folder = await Deno.makeTempDir({ prefix: "tufa-boot-session-" });
  const provider = await startProvider(folder);
  const store = await wallet(provider.url);
  try {
    const account = store.hby.makeHab("account"), signer = store.hby.makeHab("signer");
    const other = store.hby.makeHab("other-signer"), stranger = store.hby.makeHab("stranger");
    const client = await store.client(signer);
    const started = await run(() => client.start(account.pre, "account", "3-of-4"));
    const session = String(started.payload.session_id);
    assert(session.startsWith("sess_"));
    assertEquals(started.payload.state, "started");
    assertEquals(started.payload.account_tier, "org");
    const provision = started.payload.session_provision_operation as Record<string, unknown>;
    assertEquals(provision.kind, "session_provision");
    assertEquals(provision.requester, signer.pre);

    let state = started.payload;
    const until = Date.now() + 30_000;
    while (!(Array.isArray(state.witnesses) && state.witnesses.length === 4 && state.watcher)) {
      if (Date.now() > until) throw new Error("Provisioning did not complete: " + JSON.stringify(state));
      await new Promise(resolve => setTimeout(resolve, 100));
      state = (await run(() => client.session(session))).payload;
    }
    assertEquals(state.state, "witness_pool_allocated");
    const witnesses = state.witnesses as Record<string, unknown>[];
    assertEquals(new Set(witnesses.map(row => row.url)).size, 4, "each witness on a distinct backend");
    for (const row of witnesses) {
      assertEquals(Object.keys(row), [
        "kind",
        "eid",
        "cid",
        "name",
        "identifier_alias",
        "region_id",
        "region_name",
        "url",
        "boot_url",
        "public_host",
        "public_port",
        "status",
        "created_at",
        "oobis",
        "witness_url",
      ]);
      assertEquals(row.witness_url, row.url);
      assertEquals(row.cid, "");
    }
    const watcher = state.watcher as Record<string, unknown>;
    assertEquals(watcher.watcher_url, provider.watcher.url);
    assertEquals((state.session as Record<string, unknown>).session_id, session);

    // The provision operation is readable by the session principal, not a stranger.
    const finished = await run(() => client.operation(String(provision.operation_id)));
    assertEquals((finished.payload.operation as Record<string, unknown>).state, "succeeded");
    const strangerClient = await store.client(stranger);
    await assertRejects(() => run(() => strangerClient.operation(String(provision.operation_id))));
    await assertRejects(() => run(() => strangerClient.session(session)));

    // Same signer reuses the session; a different signer for the same account conflicts.
    const reused = await run(() => client.start(account.pre, "account", "3-of-4"));
    assertEquals(reused.payload.session_id, session);
    await assertRejects(() => run(() => client.start(account.pre, "account", "1-of-1")));
    const otherClient = await store.client(other);
    await assertRejects(() => run(() => otherClient.start(account.pre, "account", "3-of-4")));

    // Only the ephemeral signer cancels; cancelling is idempotent and closes the session.
    const cancelled = await run(() => client.cancel(session, "test"));
    assertEquals(cancelled.payload.state, "cancelled");
    assertEquals((await run(() => client.cancel(session))).payload.state, "cancelled");
    assertEquals((await run(() => client.session(session))).payload.state, "cancelled");
  } finally {
    await store.close();
    await provider.stop();
    await Deno.remove(folder, { recursive: true });
  }
});

Deno.test("boot service: configuration follows kf-boot validation", () => {
  const base = {
    WIT_BOOT_URL: "http://127.0.0.1:1",
    WIT_PUBLIC_URL: "http://127.0.0.1:2",
    WAT_BOOT_URL: "http://127.0.0.1:3",
    WAT_PUBLIC_URL: "http://127.0.0.1:4",
  };
  const single = bootServiceConfig(base);
  assertEquals(single.accountOptions, ["1-of-1"]);
  assertEquals(single.witnessBackends, [{
    id: "wit-1",
    bootUrl: "http://127.0.0.1:1",
    publicUrl: "http://127.0.0.1:2",
  }]);
  assertEquals(single.onboardingPublicUrl, "http://127.0.0.1:9723/onboarding");
  for (
    const bad of [
      { ...base, WITNESS_BACKENDS: "a|http://x" },
      { ...base, BOOTSTRAP_ACCOUNT_OPTIONS: "3-of-4" },
      { ...base, SESSION_TTL_SECONDS: "0" },
      { ...base, REGISTRAR_BOOT_URL: "http://127.0.0.1:5" },
      { WIT_BOOT_URL: "http://127.0.0.1:1", WIT_PUBLIC_URL: "http://127.0.0.1:2" },
    ]
  ) {
    let failed = false;
    try {
      bootServiceConfig(bad);
    } catch {
      failed = true;
    }
    assert(failed, JSON.stringify(bad));
  }
});

Deno.test("boot service: account create/complete, services, lists, watcher status and deletes", async () => {
  const folder = await Deno.makeTempDir({ prefix: "tufa-boot-account-" });
  const provider = await startProvider(folder, {}, { registries: true });
  const store = await wallet(provider.url);
  try {
    const account = store.hby.makeHab("account"), signer = store.hby.makeHab("signer");
    const stranger = store.hby.makeHab("stranger");
    const result = await onboard(store, account, signer, "3-of-4", folder + "/credentials.json");
    assertEquals(result.witnesses.length, 4);
    assertEquals(result.services.registrar.roles, ["publisher"]);
    assertEquals(result.services.observer.roles, ["reader"]);
    assertEquals(result.services.registrar.service, provider.registries!.registrar.aid);

    // Completed sessions stay readable by the ephemeral signer and the account; complete is idempotent.
    const ephemeral = await store.client(signer);
    const completed = await run(() =>
      ephemeral.request("/onboarding/complete", { session_id: result.sessionId, account_aid: account.pre })
    );
    assertEquals((completed.payload.account as Record<string, unknown>).status, "onboarded");
    assertEquals(completed.payload.state, "completed");
    const asAccount = await store.client(account);
    assertEquals((await run(() => asAccount.session(result.sessionId))).payload.state, "completed");
    await assertRejects(() => run(() => asAccount.cancel(result.sessionId)));
    await assertRejects(() => run(() => ephemeral.cancel(result.sessionId)));

    const permanent = await store.client(account, "account");
    const call = (route: string, payload: Record<string, unknown> = {}) =>
      run(() => permanent.request(route as never, payload)).then(reply => reply.payload);
    const services = await call("/account/services", {});
    const operation = await settled(permanent, String((services.operation as Record<string, unknown>).operation_id));
    assertEquals(operation.state, "succeeded");
    assertEquals(operation.kind, "account_services");
    assertEquals(operation.subject, `account:${account.pre}`);
    locksmithServiceSettings(operation.result as Record<string, unknown>, account.pre);
    // Re-activation re-PUTs the same roles and compares the acknowledgement.
    const again = await call("/account/services", { account_aid: account.pre });
    assertEquals(
      (await settled(permanent, String((again.operation as Record<string, unknown>).operation_id))).state,
      "succeeded",
    );
    await assertRejects(() => call("/account/services", { account_aid: account.pre, extra: true }));
    const strangerClient = await store.client(stranger, "account");
    await assertRejects(() => run(() => strangerClient.operation(String(operation.operation_id))));
    await assertRejects(() => run(() => strangerClient.request("/account/services" as never, {})));

    const witnesses = (await call("/account/witnesses")).witnesses as Record<string, unknown>[];
    assertEquals(witnesses.length, 4);
    assert(witnesses.every(row => row.cid === account.pre && !("boot_url" in row) && row.witness_url === row.url));
    const watchers = (await call("/account/watchers")).watchers as Record<string, unknown>[];
    assertEquals(watchers.map(row => row.eid), [result.watcher!.eid]);

    const status = await call("/account/watchers/status", { watcher_eid: result.watcher!.eid });
    const observed = await settled(permanent, String((status.operation as Record<string, unknown>).operation_id));
    assertEquals(observed.kind, "watcher_status_query");
    assertEquals((observed.result as Record<string, unknown>).watcher_id, result.watcher!.eid);
    assertEquals(((await call("/account/watchers")).watchers as Record<string, unknown>[])[0].status, "connected");
    await assertRejects(() => call("/account/watchers/status", { watcher_eid: witnesses[0].eid }));

    const removed = await call("/account/witnesses/delete", { witness_eid: String(witnesses[0].eid) });
    assertEquals(removed.deleted, false);
    assertEquals(
      (await settled(permanent, String((removed.operation as Record<string, unknown>).operation_id))).state,
      "succeeded",
    );
    assertEquals(((await call("/account/witnesses")).witnesses as unknown[]).length, 3);

    const deletion = await call("/account/delete");
    const deleted = await settled(permanent, String((deletion.operation as Record<string, unknown>).operation_id));
    assertEquals(deleted.state, "succeeded");
    assertEquals((deleted.result as Record<string, unknown>).session_ids, [result.sessionId]);
    assertEquals((await call("/account/delete")).deleted, true);
    await assertRejects(() => call("/account/witnesses"));
    const revoked = await fetch(provider.registries!.registrar.boot + "/accounts/" + account.pre);
    await revoked.body?.cancel();
    assertEquals(revoked.status, 404);
  } finally {
    await store.close();
    await provider.stop();
    await Deno.remove(folder, { recursive: true });
  }
});

Deno.test("boot service: a differing service acknowledgement fails the activation operation", async () => {
  const folder = await Deno.makeTempDir({ prefix: "tufa-boot-ack-" });
  const registries = await startRegistries("typescript", folder);
  const provider = await startProvider(folder, {
    BOOTSTRAP_ACCOUNT_OPTIONS: "1-of-1",
    REGISTRAR_BOOT_URL: registries.registrar.boot,
    REGISTRAR_PUBLIC_URL: registries.registrar.url,
    // The registrar acknowledges with its own AID, not this one.
    REGISTRAR_SERVICE_AID: registries.observer.aid!,
  }, { witnessCount: 1 });
  const store = await wallet(provider.url);
  try {
    const account = store.hby.makeHab("account"), signer = store.hby.makeHab("signer");
    await assertRejects(() => onboard(store, account, signer, "1-of-1", folder + "/credentials.json"));
    const permanent = await store.client(account, "account");
    const reply = await run(() => permanent.request("/account/services", {}));
    const operation = await settled(
      permanent,
      String((reply.payload.operation as Record<string, unknown>).operation_id),
    );
    assertEquals(operation.state, "failed");
    assertEquals(operation.last_error, "Credential-service activation acknowledgement differs from request");
    assertEquals(operation.result, { status_code: 409 });
  } finally {
    await store.close();
    await provider.stop();
    await registries.observer.stop();
    await registries.registrar.stop();
    await Deno.remove(folder, { recursive: true });
  }
});
