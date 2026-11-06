/**
 * Full-TypeScript KF provider end to end, every role a `tufa` subprocess, plus the
 * `tufa infra kf onboard --session` recovery path.
 *
 * Topology (Locksmith's `local-provider.sh` / `local-registries.sh` shape): four
 * `tufa witness backend`, one `tufa watcher backend`, `tufa registrar start` and
 * `tufa observer start` (self-signed localhost TLS), and `tufa boot backend` configured
 * through `KF_BOOT_*` variables. A headless wallet then runs `tufa init`, `tufa incept`
 * (account and onboarding signer), `tufa infra kf discover` and
 * `tufa infra kf onboard --profile 3-of-4`.
 *
 * Recovery: rotate with the credentials file, delete the file, re-run onboard with
 * `--session`; it re-reads the completed session as the ephemeral signer, re-registers
 * every witness with the full KEL (fresh seeds), skips account creation, completes
 * idempotently, re-observes the watcher and re-activates services. Rotating again with
 * the new seeds must be fully witnessed. A variant loses one row only.
 *
 * Recovery relies on the boot service retaining completed sessions for the ephemeral
 * principal (kf-boot does today: completed sessions get no deletion task). If upstream
 * kf-boot starts purging them (`KF_BOOT_CLOSED_SESSION_RETENTION_SECONDS`), `--session`
 * recovery needs an account-principal fallback on the account surface.
 */
import { assert, assertEquals } from "jsr:@std/assert";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type GuardedChild, spawnGuardedChild } from "../../../keri/test/support/child-lifetime.ts";
import { packageRoot } from "../test-helpers.ts";

const PASSCODE = "abcdefghijklmnopqrstu";
const PEM = fileURLToPath(new URL("../verifier/localhost.pem", import.meta.url));

/** Reserve distinct loopback ports together. */
function freePorts(count: number): number[] {
  const listeners = Array.from({ length: count }, () => Deno.listen({ hostname: "127.0.0.1", port: 0 }));
  try {
    return listeners.map(listener => (listener.addr as Deno.NetAddr).port);
  } finally {
    for (const listener of listeners) listener.close();
  }
}

/** One finite `tufa` invocation; failures carry its output. */
async function tufa(args: string[], env: Record<string, string> = {}): Promise<string> {
  const output = await new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-all", "--unstable-ffi", "mod.ts", ...args],
    cwd: packageRoot(),
    env: { DENO_CERT: PEM, ...env },
    stdout: "piped",
    stderr: "piped",
  }).output();
  const stdout = new TextDecoder().decode(output.stdout), stderr = new TextDecoder().decode(output.stderr);
  if (output.code !== 0) throw new Error(`tufa ${args.slice(0, 3).join(" ")} failed:\n${stdout}\n${stderr}`);
  return stdout;
}

/** The last JSON object line a command printed. */
function jsonLine(output: string): Record<string, unknown> {
  const line = output.split(/\r?\n/).map(text => text.trim()).filter(text => text.startsWith("{")).at(-1);
  if (!line) throw new Error("No JSON output:\n" + output);
  return JSON.parse(line);
}

/** A long-lived `tufa` service whose output goes to a log file. */
class Service {
  private constructor(readonly label: string, private readonly child: GuardedChild, readonly log: string) {}

  /** Spawn and drain stdout/stderr so the child never blocks on a full pipe. */
  static async start(folder: string, label: string, args: string[], env: Record<string, string> = {}) {
    const log = join(folder, `${label}.log`);
    const file = await Deno.open(log, { write: true, create: true, append: true });
    const child = spawnGuardedChild(Deno.execPath(), {
      args: ["run", "--allow-all", "--unstable-ffi", "mod.ts", ...args],
      cwd: packageRoot(),
      env: { DENO_CERT: PEM, ...env },
      stdout: "piped",
      stderr: "piped",
    });
    const drain = async (stream: ReadableStream<Uint8Array>) => {
      for await (const chunk of stream) await file.write(chunk);
    };
    const service = new Service(label, child, log);
    service.output = Promise.all([drain(child.stdout!), drain(child.stderr!)]).finally(() => file.close());
    return service;
  }

  private output: Promise<unknown> = Promise.resolve();

  /** Wait for an HTTP 2xx at `url`, failing early if the process exits. */
  async ready(url: string, client?: Deno.HttpClient): Promise<void> {
    let exited = false;
    this.child.status.then(() => exited = true);
    const until = Date.now() + 90_000;
    while (Date.now() < until) {
      if (exited) throw new Error(`${this.label} exited:\n${await Deno.readTextFile(this.log)}`);
      try {
        const response = await fetch(url, { client, signal: AbortSignal.timeout(1000) });
        await response.body?.cancel();
        if (response.ok) return;
      } catch { /* not listening yet */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`${this.label} not ready:\n${await Deno.readTextFile(this.log)}`);
  }

  /** SIGTERM, then SIGKILL after ten seconds; join the output drain. */
  async stop(): Promise<void> {
    try {
      this.child.kill("SIGTERM");
    } catch { /* already exited */ }
    const timer = setTimeout(() => {
      try {
        this.child.kill("SIGKILL");
      } catch { /* already exited */ }
    }, 10_000);
    await this.child.status;
    clearTimeout(timer);
    await this.output.catch(() => {});
  }
}

/** Witness seeds by witness AID from a credentials file. */
async function seeds(file: string): Promise<Map<string, string>> {
  const saved = JSON.parse(await Deno.readTextFile(file)) as { witnesses: { eid: string; secret: string }[] };
  return new Map(saved.witnesses.map(row => [row.eid, row.secret]));
}

Deno.test("KF boot e2e: all-TypeScript provider onboarding and --session recovery", async () => {
  const folder = await Deno.makeTempDir({ prefix: "tufa-kf-boot-e2e-" });
  const state = join(folder, "tufa");
  const services: Service[] = [];
  const tls = Deno.createHttpClient({ caCerts: [await Deno.readTextFile(PEM)] });
  const start = async (label: string, args: string[], health: string, env: Record<string, string> = {}) => {
    const service = await Service.start(folder, label, args, env);
    services.push(service);
    await service.ready(health, health.startsWith("https:") ? tls : undefined);
    return service;
  };
  const store = (name: string) => ["--name", name, "--head-dir", state, "--passcode", PASSCODE];
  try {
    // Provider backends.
    const backends: string[] = [];
    for (let index = 0; index < 4; index++) {
      const [boot, port] = freePorts(2);
      await start(`witness-${index}`, [
        "witness",
        "backend",
        ...store(`localdev-witness-${index}`),
        "--url",
        `http://127.0.0.1:${port}`,
        "--http",
        String(port),
        "--boot-port",
        String(boot),
      ], `http://127.0.0.1:${boot}/health`);
      backends.push(`w${index}|http://127.0.0.1:${boot}|http://127.0.0.1:${port}`);
    }
    const [watcherBoot, watcherPort] = freePorts(2);
    await start("watcher", [
      "watcher",
      "backend",
      ...store("localdev-watcher"),
      "--url",
      `http://127.0.0.1:${watcherPort}`,
      "--http",
      String(watcherPort),
      "--boot-port",
      String(watcherBoot),
      "--poll-interval",
      "1",
    ], `http://127.0.0.1:${watcherBoot}/health`);

    // Registry identities through normal Tufa commands, as local_registry_bootstrap.tufa_identity does.
    const aids: Record<string, string> = {};
    const kels: Uint8Array[] = [];
    for (const service of ["registrar", "observer"]) {
      await tufa(["init", ...store(`localdev-${service}`)]);
      await tufa(["incept", ...store(`localdev-${service}`), "--alias", service, "--transferable"]);
      aids[service] = (await tufa(["aid", ...store(`localdev-${service}`), "--alias", service])).trim();
      kels.push(new TextEncoder().encode(await tufa(["export", ...store(`localdev-${service}`), "--alias", service])));
    }
    const bootstrap = join(folder, "public-bootstrap.cesr");
    await Deno.writeFile(bootstrap, new Uint8Array(kels.flatMap(kel => [...kel])));
    const [registrarBoot, registrarPort, observerBoot, observerPort] = freePorts(4);
    await start("registrar", [
      "registrar",
      "start",
      ...store("localdev-registrar"),
      "--alias",
      "registrar",
      "--url",
      `https://localhost:${registrarPort}`,
      "--http",
      String(registrarPort),
      "--boot-port",
      String(registrarBoot),
      "--observer",
      aids.observer,
      "--kel",
      bootstrap,
      "--tls-key",
      PEM,
      "--tls-cert",
      PEM,
    ], `https://localhost:${registrarPort}/health`);
    await start("observer", [
      "observer",
      "start",
      ...store("localdev-observer"),
      "--alias",
      "observer",
      "--url",
      `https://localhost:${observerPort}`,
      "--http",
      String(observerPort),
      "--boot-port",
      String(observerBoot),
      "--registrar",
      `https://localhost:${registrarPort}`,
      "--registrar-ca",
      PEM,
      "--kel",
      bootstrap,
      "--poll-interval",
      "1",
      "--tls-key",
      PEM,
      "--tls-cert",
      PEM,
    ], `https://localhost:${observerPort}/health`);

    // The boot service takes the launcher's KF_BOOT_* block; only the port comes from a flag.
    const [bootPort] = freePorts(1);
    const provider = `http://127.0.0.1:${bootPort}`;
    await start(
      "boot",
      ["boot", "backend", ...store("localdev-boot"), "--port", String(bootPort)],
      provider + "/health",
      {
        KF_BOOT_HOST: "127.0.0.1",
        KF_BOOT_WITNESS_BACKENDS: backends.join(","),
        KF_BOOT_WAT_BOOT_URL: `http://127.0.0.1:${watcherBoot}`,
        KF_BOOT_WAT_PUBLIC_URL: `http://127.0.0.1:${watcherPort}`,
        KF_BOOT_ONBOARDING_PUBLIC_URL: provider + "/onboarding",
        KF_BOOT_ACCOUNT_PUBLIC_URL: provider + "/account",
        KF_BOOT_REGISTRAR_BOOT_URL: `http://127.0.0.1:${registrarBoot}`,
        KF_BOOT_REGISTRAR_PUBLIC_URL: `https://localhost:${registrarPort}`,
        KF_BOOT_REGISTRAR_SERVICE_AID: aids.registrar,
        KF_BOOT_REGISTRAR_CA_FILE: PEM,
        KF_BOOT_OBSERVER_BOOT_URL: `http://127.0.0.1:${observerBoot}`,
        KF_BOOT_OBSERVER_PUBLIC_URL: `https://localhost:${observerPort}`,
        KF_BOOT_OBSERVER_SERVICE_AID: aids.observer,
        KF_BOOT_OBSERVER_CA_FILE: PEM,
      },
    );

    // Headless wallet.
    const wallet = store("wallet");
    await tufa(["init", ...wallet]);
    for (const alias of ["account", "onboarding"]) {
      await tufa(["incept", ...wallet, "--alias", alias, "--transferable", "--toad", "0"]);
    }
    const discovery = jsonLine(await tufa(["infra", "kf", "discover", "--url", provider]));
    assertEquals(discovery.watcherRequired, true);
    const credentials = join(folder, "credentials.json");
    const onboard = async (session?: string) =>
      jsonLine(
        await tufa([
          "infra",
          "kf",
          "onboard",
          ...wallet,
          "--alias",
          "account",
          "--onboarding-alias",
          "onboarding",
          "--credentials",
          credentials,
          "--url",
          provider,
          "--profile",
          "3-of-4",
          "--timeout",
          "120",
          ...(session ? ["--session", session] : []),
        ]),
      );
    const rotate = () => tufa(["rotate", ...wallet, "--alias", "account", "--witness-credentials", credentials]);

    const result = await onboard();
    const services_ = result.services as Record<string, Record<string, unknown>>;
    assertEquals(services_.registrar.roles, ["publisher"]);
    assertEquals(services_.observer.roles, ["reader"]);
    assertEquals(services_.registrar.service, aids.registrar);
    assertEquals((result.witnesses as unknown[]).length, 4);
    assert(result.watcher);
    const session = String(result.sessionId);
    const original = await seeds(credentials);
    assertEquals(original.size, 4);

    // Recovery after rotation and a lost credentials file.
    await rotate();
    await Deno.remove(credentials);
    const recovered = await onboard(session);
    assertEquals(recovered.sessionId, session);
    assertEquals(recovered.account, result.account);
    assertEquals((recovered.services as Record<string, Record<string, unknown>>).observer.roles, ["reader"]);
    const fresh = await seeds(credentials);
    assertEquals([...fresh.keys()].sort(), [...original.keys()].sort());
    assert([...fresh].every(([eid, secret]) => secret !== original.get(eid)), "re-registration issues new seeds");
    await rotate();

    // Variant: one lost row re-registers only that witness.
    const saved = JSON.parse(await Deno.readTextFile(credentials));
    const lost = saved.witnesses.pop().eid;
    await Deno.writeTextFile(credentials, JSON.stringify(saved) + "\n", { mode: 0o600 });
    await onboard(session);
    const repaired = await seeds(credentials);
    assertEquals(repaired.size, 4);
    for (const [eid, secret] of repaired) {
      if (eid === lost) assert(secret !== fresh.get(eid));
      else assertEquals(secret, fresh.get(eid));
    }
    await rotate();
  } finally {
    for (const service of services.reverse()) await service.stop();
    tls.close();
    await Deno.remove(folder, { recursive: true });
  }
});
