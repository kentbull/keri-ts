/**
 * TypeScript kf-boot core: transport status table, discovery and onboarding-session routes.
 *
 * Ports representative cases of kf-boot `tests/test_surfaces.py` and
 * `tests/test_onboarding_routes.py`, driven by the unchanged Tufa `KfBootClient` against
 * real in-process TypeScript witness and watcher backends.
 */
import { parseBytes, Vrsn_2_0 } from "cesr-ts";
import { run, type Task } from "effection";
import { assert, assertEquals, assertRejects } from "jsr:@std/assert";
import {
  acceptedEventReplayMessage,
  type AgentRuntime,
  createAgentRuntime,
  createHabery,
  exchange,
  FetchHttpClient,
  type Hab,
  type Habery,
  reply,
  systemClock,
} from "keri-ts/runtime";
import { discoverKfBoot, KfBootClient, type KfBootClient as Client } from "../src/operator/kfboot/client.ts";
import { bootServiceConfig, runBootService } from "../src/roles/boot-service.ts";
import { freePorts, type RunningService, SERVICE_PASSCODE, startWatcher, startWitness } from "./contract/services.ts";

/** One boot service over four TypeScript witnesses and one watcher. */
interface Provider {
  url: string;
  witnesses: RunningService[];
  watcher: RunningService;
  boot: Task<void>;
  stop(): Promise<void>;
}

/** Start the backends and the boot service with the launcher's `KF_BOOT_*` shape. */
export async function startProvider(folder: string, extra: Record<string, string> = {}): Promise<Provider> {
  const witnesses: RunningService[] = [];
  for (let index = 0; index < 4; index++) witnesses.push(await startWitness("typescript", folder, `witness-${index}`));
  const watcher = await startWatcher("typescript", folder);
  const [port] = freePorts(1);
  const url = `http://127.0.0.1:${port}`;
  const config = bootServiceConfig({
    HOST: "127.0.0.1",
    PORT: String(port),
    WITNESS_BACKENDS: witnesses.map((witness, index) => `w${index}|${witness.boot}|${witness.url}`).join(","),
    WAT_BOOT_URL: watcher.boot,
    WAT_PUBLIC_URL: watcher.url,
    ONBOARDING_PUBLIC_URL: url + "/onboarding",
    ACCOUNT_PUBLIC_URL: url + "/account",
    ...extra,
  });
  const boot = run(() => runBootService({ name: "boot", headDirPath: folder, passcode: SERVICE_PASSCODE, config }));
  const until = Date.now() + 30_000;
  while (true) {
    try {
      const response = await fetch(url + "/health");
      await response.body?.cancel();
      if (response.ok) break;
    } catch { /* not listening yet */ }
    if (Date.now() > until) throw new Error("Boot service did not become ready");
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return {
    url,
    witnesses,
    watcher,
    boot,
    stop: async () => {
      await boot.halt();
      await watcher.stop();
      for (const witness of witnesses) await witness.stop();
    },
  };
}

/** A wallet store with a KRAM-enabled protocol owner, as `tufa infra kf` composes it. */
export interface Wallet {
  hby: Habery;
  runtime: AgentRuntime;
  http: FetchHttpClient;
  client(hab: Hab, surface?: "onboarding" | "account"): Promise<Client>;
  close(): Promise<void>;
}

/** Open a temporary wallet store whose clients talk to `provider`. */
export async function wallet(provider: string): Promise<Wallet> {
  return await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true, skipSignator: true });
    const http = new FetchHttpClient();
    const runtime = yield* createAgentRuntime(hby, http, systemClock, {
      kram: { enabled: true, caches: { "~": [1000, 5000, 5000, 86400000, 5000, 5000, 86400000] } },
    });
    const discovery = yield* discoverKfBoot(http, provider);
    return {
      hby,
      runtime,
      http,
      client: (hab: Hab, surface: "onboarding" | "account" = "onboarding") =>
        Promise.resolve(new KfBootClient(hby, hab, runtime.protocol, http, discovery, undefined, surface)),
      close: () =>
        run(function*() {
          yield* runtime.close();
          yield* hby.close();
        }),
    };
  });
}

/** POST one complete message to a surface with explicit transport headers. */
async function post(
  url: string,
  body: Uint8Array | string,
  headers: Record<string, string>,
): Promise<{ status: number; text: string }> {
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : new Uint8Array(body),
  });
  return { status: response.status, text: await response.text() };
}

/** Split an endorsed message into body and `CESR-ATTACHMENT` header, as Tufa's egress does. */
function framed(message: Uint8Array): { body: Uint8Array; headers: Record<string, string> } {
  const frame = parseBytes(message)[0];
  const body = frame.body.raw;
  const attachment = new TextDecoder().decode(message.slice(body.length));
  return { body, headers: { "Content-Type": "application/cesr", "CESR-ATTACHMENT": attachment } };
}

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
