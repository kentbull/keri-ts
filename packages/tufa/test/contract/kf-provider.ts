/**
 * A running KF provider (boot service over witness, watcher and optional registry
 * backends) and a headless wallet, shared by the boot-service unit tests and the
 * cross-implementation boot-service contract (Suite A).
 *
 * The boot service is the in-process TypeScript implementation, or upstream Python
 * kf-boot spawned from `KF_BOOT_CONTRACT_PYTHON_BIN` with the same `KF_BOOT_*` block.
 */
import { parseBytes } from "cesr-ts";
import { run, suspend } from "effection";
import { assert, assertEquals } from "jsr:@std/assert";
import { createHabery } from "keri-ts/db/lmdb";
import {
  type AgentRuntime,
  createAgentRuntime,
  FetchHttpClient,
  type Hab,
  type Habery,
  type HttpClient,
  Receiptor,
  systemClock,
} from "keri-ts/runtime";
import { join } from "node:path";
import { spawnGuardedChild } from "../../../keri/test/support/child-lifetime.ts";
import { discoverKfBoot, KfBootClient, type KfBootClient as Client } from "../../src/operator/kfboot/client.ts";
import { onboardKfAccount } from "../../src/operator/kfboot/onboarding.ts";
import { bootServiceConfig, runBootService } from "../../src/roles/boot-service.ts";
import {
  freePorts,
  type RunningRegistries,
  type RunningService,
  SERVICE_PASSCODE,
  startRegistries,
  startWatcher,
  startWitness,
} from "./services.ts";

/** One boot service over four TypeScript witnesses and one watcher. */
export interface Provider {
  url: string;
  witnesses: RunningService[];
  watcher: RunningService;
  registries?: RunningRegistries;
  impl: "typescript" | "python";
  stop(): Promise<void>;
}

/** Start the backends and the boot service with the launcher's `KF_BOOT_*` shape. */
export async function startProvider(
  folder: string,
  extra: Record<string, string> = {},
  { witnessCount = 4, registries: withRegistries = false, impl = "typescript" as "typescript" | "python", http }: {
    witnessCount?: number;
    registries?: boolean;
    impl?: "typescript" | "python";
    /** Backend admin HTTP owner for the TypeScript boot service (fault injection). */
    http?: HttpClient;
  } = {},
): Promise<Provider> {
  const witnesses: RunningService[] = [];
  for (let index = 0; index < witnessCount; index++) {
    witnesses.push(await startWitness("typescript", folder, `witness-${index}`));
  }
  const watcher = await startWatcher("typescript", folder);
  const registries = withRegistries ? await startRegistries("typescript", folder) : undefined;
  const services: Record<string, string> = registries
    ? {
      REGISTRAR_BOOT_URL: registries.registrar.boot,
      REGISTRAR_PUBLIC_URL: registries.registrar.url,
      REGISTRAR_SERVICE_AID: registries.registrar.aid!,
      REGISTRAR_CA_FILE: registries.caFile,
      OBSERVER_BOOT_URL: registries.observer.boot,
      OBSERVER_PUBLIC_URL: registries.observer.url,
      OBSERVER_SERVICE_AID: registries.observer.aid!,
      OBSERVER_CA_FILE: registries.caFile,
    }
    : {};
  const [port] = freePorts(1);
  const url = `http://127.0.0.1:${port}`;
  const values = {
    HOST: "127.0.0.1",
    PORT: String(port),
    WITNESS_BACKENDS: witnesses.map((witness, index) => `w${index}|${witness.boot}|${witness.url}`).join(","),
    WAT_BOOT_URL: watcher.boot,
    WAT_PUBLIC_URL: watcher.url,
    ONBOARDING_PUBLIC_URL: url + "/onboarding",
    ACCOUNT_PUBLIC_URL: url + "/account",
    ...services,
    ...extra,
  };
  const stopBoot = impl === "typescript"
    ? (() => {
      const config = bootServiceConfig(values);
      const task = run(() =>
        runBootService({ name: "boot", headDirPath: folder, passcode: SERVICE_PASSCODE, config, http })
      );
      return () => task.halt();
    })()
    : await spawnPythonBoot(folder, values);
  const until = Date.now() + 60_000;
  while (true) {
    try {
      const response = await fetch(url + "/health");
      await response.body?.cancel();
      if (response.ok) break;
    } catch { /* not listening yet */ }
    if (Date.now() > until) {
      await stopBoot();
      const log = await Deno.readTextFile(join(folder, "kf-boot.log")).catch(() => "");
      throw new Error("Boot service did not become ready\n" + log.slice(-4000));
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return {
    url,
    witnesses,
    watcher,
    registries,
    impl,
    stop: async () => {
      await stopBoot();
      await registries?.observer.stop();
      await registries?.registrar.stop();
      await watcher.stop();
      for (const witness of witnesses) await witness.stop();
    },
  };
}

/**
 * Spawn upstream Python kf-boot (`KF_BOOT_CONTRACT_PYTHON_BIN`, e.g. kf-boot's
 * `.venv/bin/kf-boot`) with the same `KF_BOOT_*` block; HOME and stores stay in `folder`.
 */
async function spawnPythonBoot(folder: string, values: Record<string, string>): Promise<() => Promise<void>> {
  const bin = Deno.env.get("KF_BOOT_CONTRACT_PYTHON_BIN");
  if (!bin) throw new Error("KF_BOOT_CONTRACT_PYTHON_BIN is not set");
  const env: Record<string, string> = { HOME: folder };
  for (const [key, value] of Object.entries(values)) env[`KF_BOOT_${key}`] = value;
  // Python-only per-IP and per-account quotas are outside the contract; lift them for the run.
  const backends = (values.WITNESS_BACKENDS ?? "").split(",").filter(Boolean).length;
  const codes = (values.BOOTSTRAP_ACCOUNT_OPTIONS ?? "1-of-1,3-of-4").split(",")
    .filter(code => code === "1-of-1" || (code === "3-of-4" && backends >= 4));
  Object.assign(env, {
    KF_BOOT_BOOTSTRAP_API_REQUESTS_PER_MINUTE: "0",
    KF_BOOT_BOOTSTRAP_ACCOUNTS_PER_IP: "0",
    KF_BOOT_BOOTSTRAP_AIDS_PER_IP: "0",
    KF_BOOT_ACCOUNT_PROFILES: codes.map(code => `${code === "1-of-1" ? "trial" : "org"}|${code}|1|100000|0`).join(","),
    KF_BOOT_DB_PATH: join(folder, "kf-boot-db"),
    KF_BOOT_KERI_DIR: join(folder, "kf-boot-keri"),
    KF_BOOT_KERI_NAME: "kf-boot-contract",
  });
  const log = await Deno.open(join(folder, "kf-boot.log"), { write: true, create: true, append: true });
  const child = spawnGuardedChild(bin, {
    cwd: folder,
    env,
    stdout: "piped",
    stderr: "piped",
  });
  const drain = async (stream: ReadableStream<Uint8Array>) => {
    for await (const chunk of stream) await log.write(chunk);
  };
  const output = Promise.all([drain(child.stdout!), drain(child.stderr!)]).finally(() => log.close());
  return async () => {
    try {
      child.kill("SIGTERM");
    } catch { /* already exited */ }
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch { /* already exited */ }
    }, 10_000);
    await child.status;
    clearTimeout(timer);
    await output.catch(() => {});
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
  // Runtime-owned stores live in the creating scope, so one task holds them until close.
  let ready!: (value: Wallet) => void, fail!: (error: unknown) => void;
  const opened = new Promise<Wallet>((resolve, reject) => {
    ready = resolve;
    fail = reject;
  });
  const owner = run(function*() {
    try {
      const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true, skipSignator: true });
      const http = new FetchHttpClient();
      const runtime = yield* createAgentRuntime(hby, http, systemClock, {
        kram: { enabled: true, caches: { "~": [1000, 5000, 5000, 86400000, 5000, 5000, 86400000] } },
      });
      try {
        const discovery = yield* discoverKfBoot(http, provider);
        ready({
          hby,
          runtime,
          http,
          client: (hab: Hab, surface: "onboarding" | "account" = "onboarding") =>
            Promise.resolve(new KfBootClient(hby, hab, runtime.protocol, http, discovery, undefined, surface)),
          close: () => owner.halt(),
        });
        yield* suspend();
      } finally {
        yield* runtime.close();
        yield* hby.close();
      }
    } catch (error) {
      fail(error);
      throw error;
    }
  });
  return await opened;
}

/** POST one complete message to a surface with explicit transport headers. */
export async function post(
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
export function framed(message: Uint8Array): { body: Uint8Array; headers: Record<string, string> } {
  const frame = parseBytes(message)[0];
  const body = frame.body.raw;
  const attachment = new TextDecoder().decode(message.slice(body.length));
  return { body, headers: { "Content-Type": "application/cesr", "CESR-ATTACHMENT": attachment } };
}

/** Locksmith `localdev/services.py` `service_settings`, ported as the capability expectation. */
export function locksmithServiceSettings(payload: Record<string, unknown>, account: string): void {
  assertEquals(payload.account_aid, account);
  const capabilities = payload.services as Record<string, Record<string, unknown>>;
  assertEquals(Object.keys(capabilities).sort(), ["observer", "registrar"]);
  for (const [kind, role] of [["registrar", "publisher"], ["observer", "reader"]]) {
    const value = capabilities[kind];
    assertEquals(value.aid, account);
    assertEquals(value.roles, [role]);
    assert(typeof value.service === "string" && value.service.length === 44);
    const url = new URL(String(value.url));
    assert(
      url.protocol === "https:" && url.hostname && !url.username && !url.search && ["", "/"].includes(url.pathname),
    );
    assert(typeof value.ca_pem === "string" && value.ca_pem.startsWith("-----BEGIN CERTIFICATE-----"));
    assert(!String(value.ca_pem).includes("PRIVATE KEY"), "only certificates are handed to wallets");
  }
}

/** Wait for a signed operation to leave pending/running. */
export async function settled(client: Client, id: string): Promise<Record<string, unknown>> {
  const until = Date.now() + 30_000;
  while (true) {
    const operation = (await run(() => client.operation(id))).payload.operation as Record<string, unknown>;
    if (!["pending", "running"].includes(String(operation.state))) return operation;
    if (Date.now() > until) throw new Error("Operation did not settle: " + JSON.stringify(operation));
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

/** Run `tufa infra kf onboard`'s flow for `account` through `signer`. */
export async function onboard(
  store: Wallet,
  account: Hab,
  signer: Hab,
  profile: string,
  credentialFile: string,
  sessionId?: string,
) {
  const client = await store.client(signer);
  return await run(() =>
    onboardKfAccount({
      client,
      account,
      receiptor: new Receiptor(store.hby, store.runtime.protocol, store.runtime.http, store.runtime.clock),
      profile,
      sessionId,
      timeoutMs: 60_000,
      credentialFile,
    })
  );
}
