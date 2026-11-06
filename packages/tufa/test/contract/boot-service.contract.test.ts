/**
 * Suite A: the KF boot-service contract Locksmith and Tufa rely on, per implementation.
 *
 * The same assertions run against the TypeScript boot service (always) and upstream
 * Python kf-boot when `KF_BOOT_CONTRACT_PYTHON_BIN` names its entrypoint, e.g.
 *
 *   KF_BOOT_CONTRACT_PYTHON_BIN=$KERI/worktrees/kf-boot-tsinfra-9c4da78/.venv/bin/kf-boot \
 *   deno task test:contract
 *
 * Backends are the in-process TypeScript witness, watcher, registrar and observer roles.
 * Drivers: the Tufa client (`discoverKfBoot`, `KfBootClient`, `onboardKfAccount`), which
 * already encodes every reply-shape requirement, plus raw `fetch` for the transport table.
 * Python's per-IP and per-account quotas are lifted for the run (see `kf-provider.ts`);
 * they are Python-only features outside this contract.
 */
import { Vrsn_2_0 } from "cesr-ts";
import { run } from "effection";
import { assert, assertEquals, assertRejects } from "jsr:@std/assert";
import { acceptedEventReplayMessage, exchange, type Hab } from "keri-ts/runtime";
import {
  framed,
  locksmithServiceSettings,
  onboard,
  post,
  settled,
  startProvider,
  wallet,
} from "./kf-provider.ts";

const IMPLEMENTATIONS: ("typescript" | "python")[] = Deno.env.get("KF_BOOT_CONTRACT_PYTHON_BIN")
  ? ["typescript", "python"]
  : ["typescript"];

/** HTTP status carried by a refused signed request (`CesrHttpRefusal`). */
async function refusal(operation: () => Promise<unknown>): Promise<number | undefined> {
  const error = await assertRejects(operation);
  return (error as { status?: number }).status;
}

/** One signed exn split for raw HTTP, as Tufa's egress sends it. */
function signed(hab: Hab, route: string, payload: Record<string, unknown> = {}) {
  const [message] = exchange(route, payload, { sender: hab.pre, recipient: "", version: Vrsn_2_0, gvrsn: Vrsn_2_0 });
  return framed(hab.endorse(message, { gvrsn: Vrsn_2_0 }));
}

for (const impl of IMPLEMENTATIONS) {
  Deno.test(`boot service contract: discovery and transport (${impl})`, async () => {
    const folder = await Deno.makeTempDir({ prefix: `tufa-boot-contract-transport-${impl}-` });
    const provider = await startProvider(folder, {}, { impl });
    const store = await wallet(provider.url);
    try {
      const health = await fetch(provider.url + "/health");
      assertEquals((await health.json()).status, "ok");
      const discovery = await (await fetch(provider.url + "/bootstrap/config")).json();
      assertEquals(discovery.bootstrap, {
        account_options: [{ code: "1-of-1", witness_count: 1, toad: 1 }, { code: "3-of-4", witness_count: 4, toad: 3 }],
        watcher_required: true,
      });
      assertEquals(discovery.region, { id: "nyc", name: "New York" });
      assertEquals(discovery.surfaces.onboarding, { path: "/onboarding", url: provider.url + "/onboarding" });
      assertEquals(discovery.surfaces.account, { path: "/account", url: provider.url + "/account" });

      const onboarding = provider.url + "/onboarding";
      const signer = store.hby.makeHab("signer"), ahead = store.hby.makeHab("ahead");
      const inception = framed(acceptedEventReplayMessage(store.hby, signer.pre, 0, Vrsn_2_0).message);
      const status = async (body: Uint8Array | string, headers: Record<string, string>) =>
        (await post(onboarding, body, headers)).status;
      assertEquals(await status(inception.body, { ...inception.headers, "Content-Type": "text/plain" }), 406);
      assertEquals(await status(inception.body, { "Content-Type": "application/cesr" }), 412);
      assertEquals(await status("{not json", inception.headers), 400);
      const early = signed(signer, "/onboarding/session/status", { session_id: "sess_x" });
      assertEquals(await status(early.body, early.headers), 401);
      assertEquals(await status(inception.body, inception.headers), 204);
      const misplaced = signed(signer, "/account/services");
      assertEquals(await status(misplaced.body, misplaced.headers), 404);
      const unknown = signed(signer, "/onboarding/nowhere");
      assertEquals(await status(unknown.body, unknown.headers), 404);
      ahead.interact();
      ahead.interact();
      const aheadIcp = framed(acceptedEventReplayMessage(store.hby, ahead.pre, 0, Vrsn_2_0).message);
      assertEquals(await status(aheadIcp.body, aheadIcp.headers), 204);
      const pending = framed(acceptedEventReplayMessage(store.hby, ahead.pre, 2, Vrsn_2_0).message);
      assertEquals(await status(pending.body, pending.headers), 409);
      const missing = signed(signer, "/onboarding/session/status", { session_id: "sess_missing" });
      assertEquals(await status(missing.body, missing.headers), 404);
    } finally {
      await store.close();
      await provider.stop();
      await Deno.remove(folder, { recursive: true });
    }
  });

  Deno.test(`boot service contract: account creation waits for provisioning (${impl})`, async () => {
    const folder = await Deno.makeTempDir({ prefix: `tufa-boot-contract-pending-${impl}-` });
    // Witness providers that accept connections but never answer keep provisioning in flight.
    // (An unreachable port is not used: hio's TCP client on macOS crashes kf-boot on refusal.)
    const listeners = [0, 1, 2, 3].map(() => Deno.listen({ hostname: "127.0.0.1", port: 0 }));
    const held: Deno.Conn[] = [];
    const accepting = listeners.map(async listener => {
      try {
        for await (const connection of listener) held.push(connection);
      } catch { /* closed */ }
    });
    const backends = listeners.map((listener, index) => {
      const port = (listener.addr as Deno.NetAddr).port;
      return `w${index}|http://127.0.0.1:${port}|http://127.0.0.1:${port + 1}`;
    });
    const provider = await startProvider(folder, { WITNESS_BACKENDS: backends.join(",") }, { witnessCount: 0, impl });
    const store = await wallet(provider.url);
    try {
      const account = store.hby.makeHab("account"), signer = store.hby.makeHab("signer");
      const client = await store.client(signer);
      const started = await run(() => client.start(account.pre, "account", "3-of-4"));
      const operation = started.payload.session_provision_operation as Record<string, unknown>;
      assertEquals([operation.kind, operation.requester], ["session_provision", signer.pre]);
      assert(["pending", "running"].includes(String(operation.state)));
      assertEquals(started.payload.witnesses, []);
      assertEquals(started.payload.watcher, null);
      const session = String(started.payload.session_id);
      assertEquals(
        await refusal(() =>
          run(() => client.request("/onboarding/account/create", { session_id: session, account_aid: account.pre }))
        ),
        409,
      );
      assertEquals((await run(() => client.cancel(session))).payload.state, "cancelled");
    } finally {
      await store.close();
      await provider.stop();
      for (const listener of listeners) listener.close();
      for (const connection of held) connection.close();
      await Promise.all(accepting);
      await Deno.remove(folder, { recursive: true });
    }
  });

  Deno.test(`boot service contract: onboarding, services, watcher status and principals (${impl})`, async () => {
    const folder = await Deno.makeTempDir({ prefix: `tufa-boot-contract-onboard-${impl}-` });
    const provider = await startProvider(folder, {}, { impl, registries: true });
    const store = await wallet(provider.url);
    try {
      const account = store.hby.makeHab("account"), signer = store.hby.makeHab("signer");
      const stranger = store.hby.makeHab("stranger");
      const result = await onboard(store, account, signer, "3-of-4", folder + "/credentials.json");
      assertEquals(result.witnesses.length, 4);
      assert(result.watcher);
      locksmithServiceSettings({ account_aid: account.pre, services: result.services }, account.pre);

      const ephemeral = await store.client(signer);
      const session = await run(() => ephemeral.session(result.sessionId));
      assertEquals(session.payload.state, "completed");
      for (const key of ["session", "witnesses", "watcher", "witness_count", "toad", "region_id", "account_aid"]) {
        assert(key in session.payload, key);
      }
      // Completion is idempotent; a completed session cannot be cancelled.
      const again = await run(() =>
        ephemeral.request("/onboarding/complete", { session_id: result.sessionId, account_aid: account.pre })
      );
      assertEquals((again.payload.account as Record<string, unknown>).status, "onboarded");
      assertEquals(await refusal(() => run(() => ephemeral.cancel(result.sessionId))), 409);

      const permanent = await store.client(account, "account");
      const services = await run(() => permanent.request("/account/services", {}));
      const activation = services.payload.operation as Record<string, unknown>;
      assertEquals([activation.kind, activation.subject], ["account_services", `account:${account.pre}`]);
      const activated = await settled(permanent, String(activation.operation_id));
      assertEquals(activated.state, "succeeded");
      locksmithServiceSettings(activated.result as Record<string, unknown>, account.pre);
      assertEquals(
        await refusal(() => run(() => permanent.request("/account/services", { account_aid: account.pre, x: 1 }))),
        400,
      );

      const status = await run(() =>
        permanent.request("/account/watchers/status", { watcher_id: result.watcher!.eid })
      );
      assertEquals(status.payload.watcher_id, result.watcher!.eid);
      const observed = await settled(
        permanent,
        String((status.payload.operation as Record<string, unknown>).operation_id),
      );
      assertEquals(observed.kind, "watcher_status_query");
      const report = observed.result as Record<string, unknown>;
      for (const key of ["watcher_id", "controller_id", "aids", "summary"]) assert(key in report, key);
      assertEquals(report.controller_id, account.pre);

      const strangerClient = await store.client(stranger, "account");
      assertEquals(await refusal(() => run(() => strangerClient.operation(String(activation.operation_id)))), 401);
      const strangerSession = await store.client(stranger);
      assertEquals(await refusal(() => run(() => strangerSession.session(result.sessionId))), 401);
    } finally {
      await store.close();
      await provider.stop();
      await Deno.remove(folder, { recursive: true });
    }
  });
}
