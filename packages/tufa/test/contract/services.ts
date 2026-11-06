/**
 * Start the services a KF boot provider administers, in either implementation.
 *
 * TypeScript roles run in-process as the role tests already do. Python roles are opt-in:
 * each is spawned from its venv entrypoint only when the named variable is set, with
 * `HOME` pointed at the test folder so KERIpy keystores never touch a developer's
 * `~/.keri`. Launch arguments mirror Locksmith's `scripts/local-provider.sh` and
 * `scripts/local-registries.sh`.
 *
 * Python entrypoints (all optional):
 * - `WITNESS_HK_BIN`   witness-hk `.venv/bin/witopnet`
 * - `WATCHER_HK_BIN`   watcher-hk `.venv/bin/watopnet`
 * - `KF_REGISTRAR_BIN` kf-registrar `.venv/bin/kf-registrar` (its venv `python` creates identities)
 * - `KF_OBSERVER_BIN`  kf-observer `.venv/bin/kf-observer`
 */
import { concatBytes, Vrsn_2_0 } from "cesr-ts";
import { run, type Task } from "effection";
import { createHabery } from "keri-ts/runtime";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type GuardedChild, spawnGuardedChild } from "../../../keri/test/support/child-lifetime.ts";
import { runHostedWatchers } from "../../src/roles/hosted-watcher.ts";
import { runHostedWitnesses } from "../../src/roles/hosted-witness.ts";
import { runObserver, runRegistrar } from "../../src/roles/registry-services.ts";

/** Which implementation backs one role. */
export type ServiceImpl = "typescript" | "python";

/** Environment variable naming each role's optional Python entrypoint. */
export const PYTHON_BINS = {
  witness: "WITNESS_HK_BIN",
  watcher: "WATCHER_HK_BIN",
  registrar: "KF_REGISTRAR_BIN",
  observer: "KF_OBSERVER_BIN",
} as const;

/** A started service: private boot URL, public URL and its own stop. */
export interface RunningService {
  impl: ServiceImpl;
  boot: string;
  url: string;
  /** Service AID for registrar/observer; allocations carry their own for witness/watcher. */
  aid?: string;
  stop(): Promise<void>;
}

/** Registrar and observer started together, like the launcher's registry pair. */
export interface RunningRegistries {
  registrar: RunningService;
  observer: RunningService;
  /** PEM trusted for both public HTTPS listeners. */
  ca: string;
  caFile: string;
}

/** Shared passcode for every test keystore. */
export const SERVICE_PASSCODE = "abcdefghijklmnopqrstu";

/** Test TLS identity (key and self-signed `localhost` certificate in one file). */
export const LOCALHOST_PEM = fileURLToPath(new URL("../verifier/localhost.pem", import.meta.url));

/** Implementations to run for a role: TypeScript always, Python when its entrypoint is configured. */
export function implementations(role: keyof typeof PYTHON_BINS): ServiceImpl[] {
  return Deno.env.get(PYTHON_BINS[role]) ? ["typescript", "python"] : ["typescript"];
}

/** Reserve distinct loopback ports together, then release them for the services to bind. */
export function freePorts(count: number): number[] {
  const listeners = Array.from({ length: count }, () => Deno.listen({ hostname: "127.0.0.1", port: 0 }));
  try {
    return listeners.map(listener => (listener.addr as Deno.NetAddr).port);
  } finally {
    for (const listener of listeners) listener.close();
  }
}

/** Wait until `probe` succeeds, failing early when the owning task or process has failed. */
async function ready(probe: () => Promise<boolean>, failed: () => unknown, label: string): Promise<void> {
  const until = Date.now() + 60_000;
  while (Date.now() < until) {
    const failure = failed();
    if (failure) throw new Error(`${label} failed during startup`, { cause: failure });
    try {
      if (await probe()) return;
    } catch { /* The listener is not bound yet. */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`${label} did not become ready`);
}

/** Any 2xx from `GET /health` (witness-hk answers 204, TypeScript roles 200 JSON). */
async function healthy(url: string): Promise<boolean> {
  const response = await fetch(url + "/health", { signal: AbortSignal.timeout(1000) });
  await response.body?.cancel();
  return response.ok;
}

/** TCP accept on a port (watcher-hk serves no `/health`). */
async function listening(port: number): Promise<boolean> {
  const connection = await Deno.connect({ hostname: "127.0.0.1", port });
  connection.close();
  return true;
}

/** Run one TypeScript role in its own root task until stopped. */
async function inProcess(
  impl: "typescript",
  task: () => Task<void>,
  coordinates: { boot: string; url: string; aid?: string },
  probe: () => Promise<boolean>,
  label: string,
): Promise<RunningService> {
  const owner = task();
  let failure: unknown;
  owner.then(() => {}, error => failure = error ?? new Error(`${label} stopped`));
  await ready(probe, () => failure, label);
  return { impl, ...coordinates, stop: async () => await owner.halt() };
}

/** Spawn one Python service whose output goes to a log file in the test folder. */
async function spawned(
  bin: string,
  args: string[],
  folder: string,
  label: string,
  coordinates: { boot: string; url: string; aid?: string },
  probe: () => Promise<boolean>,
  env: Record<string, string> = {},
): Promise<RunningService> {
  const log = await Deno.open(join(folder, `${label}.log`), { write: true, create: true, append: true });
  const child: GuardedChild = spawnGuardedChild(bin, {
    args,
    cwd: dirname(dirname(dirname(bin))),
    env: { ...env, HOME: folder },
    stdout: "piped",
    stderr: "piped",
  });
  /** Drain one pipe into the shared log; an undrained pipe would block the child. */
  const drain = async (stream: ReadableStream<Uint8Array>) => {
    for await (const chunk of stream) await log.write(chunk);
  };
  const output = Promise.all([drain(child.stdout), drain(child.stderr)]).finally(() => log.close());
  let exited: unknown;
  child.status.then(status => exited = new Error(`${label} exited with ${status.code}`));
  const stop = async () => {
    try {
      child.kill("SIGTERM");
    } catch { /* Already exited. */ }
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch { /* Already exited. */ }
    }, 10_000);
    await child.status;
    clearTimeout(timer);
    await output.catch(() => {});
  };
  try {
    await ready(probe, () => exited, label);
  } catch (error) {
    await stop();
    const text = await Deno.readTextFile(join(folder, `${label}.log`)).catch(() => "");
    throw new Error(`${(error as Error).message}\n${text.slice(-4000)}`, { cause: error });
  }
  return { impl: "python", ...coordinates, stop };
}

/** Python entrypoint for a role, required when the Python implementation is selected. */
function pythonBin(role: keyof typeof PYTHON_BINS): string {
  const bin = Deno.env.get(PYTHON_BINS[role]);
  if (!bin) throw new Error(`${PYTHON_BINS[role]} is not set`);
  return bin;
}

/** Write the `curls` config witness-hk and watcher-hk read for their public OOBI URL. */
async function hkConfig(folder: string, name: "witopnet" | "watopnet", url: string): Promise<string> {
  const dir = join(folder, `${name}-config`);
  await Deno.mkdir(join(dir, "keri/cf/main"), { recursive: true });
  const dt = new Date().toISOString().replace("Z", "+00:00");
  await Deno.writeTextFile(
    join(dir, `keri/cf/main/${name}.json`),
    JSON.stringify({ dt, [name]: { dt, curls: [url] } }),
  );
  return dir;
}

/** Start a witness provider: `POST/DELETE /witnesses` on boot, witness service on the public port. */
export async function startWitness(impl: ServiceImpl, folder: string, name = "witness"): Promise<RunningService> {
  const [boot, port] = freePorts(2);
  const coordinates = { boot: `http://127.0.0.1:${boot}`, url: `http://127.0.0.1:${port}` };
  if (impl === "typescript") {
    return await inProcess(
      impl,
      () =>
        run(() =>
          runHostedWitnesses({
            name,
            headDirPath: folder,
            passcode: SERVICE_PASSCODE,
            publicUrl: coordinates.url,
            httpPort: port,
            httpHost: "127.0.0.1",
            bootPort: boot,
          })
        ),
      coordinates,
      () => healthy(coordinates.boot),
      name,
    );
  }
  const config = await hkConfig(join(folder, name), "witopnet", coordinates.url + "/");
  return await spawned(
    pythonBin("witness"),
    [
      "marshal",
      "start",
      "--base",
      name,
      "--config-dir",
      config,
      "--host",
      "127.0.0.1",
      "--http",
      String(port),
      "--boothost",
      "127.0.0.1",
      "--bootport",
      String(boot),
    ],
    folder,
    name,
    coordinates,
    () => healthy(coordinates.boot),
  );
}

/** Start a watcher provider: `POST /watchers`, status and delete on boot; CESR ingress on the public port. */
export async function startWatcher(impl: ServiceImpl, folder: string, name = "watcher"): Promise<RunningService> {
  const [boot, port] = freePorts(2);
  const coordinates = { boot: `http://127.0.0.1:${boot}`, url: `http://127.0.0.1:${port}` };
  if (impl === "typescript") {
    return await inProcess(
      impl,
      () =>
        run(() =>
          runHostedWatchers({
            name,
            headDirPath: folder,
            passcode: SERVICE_PASSCODE,
            publicUrl: coordinates.url,
            httpPort: port,
            httpHost: "127.0.0.1",
            bootPort: boot,
            pollIntervalMs: 250,
          })
        ),
      coordinates,
      () => healthy(coordinates.boot),
      name,
    );
  }
  const config = await hkConfig(join(folder, name), "watopnet", coordinates.url + "/");
  return await spawned(
    pythonBin("watcher"),
    [
      "start",
      "--base",
      name,
      "--config-dir",
      config,
      "--host",
      "127.0.0.1",
      "--http",
      String(port),
      "--boothost",
      "127.0.0.1",
      "--bootport",
      String(boot),
    ],
    folder,
    name,
    coordinates,
    async () => await listening(boot) && await listening(port),
  );
}

/** KERIpy identity bootstrap for the Python registry pair, as `local_registry_bootstrap.py` does. */
const PYTHON_IDENTITIES = `
import sys
from keri import Vrsn_2_0
from keri.app import Habery
out = open(sys.argv[2], "wb")
for service in ("registrar", "observer"):
    hby = Habery(name=f"localdev-{service}", base=service, bran=sys.argv[1], version=Vrsn_2_0)
    try:
        hab = hby.habByName(service) or hby.makeHab(service)
        print(f"{service}={hab.pre}")
        out.write(bytes(hab.replay(gvrsn=Vrsn_2_0)))
    finally:
        hby.close()
out.close()
`;

/** Start a registrar and an observer that pulls from it; both expose `/accounts/{aid}` on boot. */
export async function startRegistries(impl: ServiceImpl, folder: string): Promise<RunningRegistries> {
  const [registrarBoot, registrarPort, observerBoot, observerPort] = freePorts(4);
  const registrarAt = { boot: `http://127.0.0.1:${registrarBoot}`, url: `https://localhost:${registrarPort}` };
  const observerAt = { boot: `http://127.0.0.1:${observerBoot}`, url: `https://localhost:${observerPort}` };
  const ca = await Deno.readTextFile(LOCALHOST_PEM);
  if (impl === "typescript") {
    const identities = await run(function*() {
      const made: Record<string, { aid: string; kel: Uint8Array }> = {};
      for (const service of ["registrar", "observer"]) {
        const hby = yield* createHabery({
          name: service,
          headDirPath: folder,
          bran: SERVICE_PASSCODE,
          skipConfig: true,
          skipSignator: true,
        });
        try {
          const hab = hby.habByName(service) ?? hby.makeHab(service);
          made[service] = { aid: hab.pre, kel: concatBytes(...hby.db.clonePreIter(hab.pre, 0, Vrsn_2_0)) };
        } finally {
          yield* hby.close();
        }
      }
      return made;
    });
    const common = {
      headDirPath: folder,
      passcode: SERVICE_PASSCODE,
      httpHost: "127.0.0.1",
      tls: { key: ca, cert: ca },
    };
    const registrar = await inProcess(
      impl,
      () =>
        run(() =>
          runRegistrar({
            ...common,
            name: "registrar",
            alias: "registrar",
            publicUrl: registrarAt.url,
            httpPort: registrarPort,
            bootPort: registrarBoot,
            observers: [identities.observer.aid],
            initialEvidence: [identities.observer.kel],
          })
        ),
      { ...registrarAt, aid: identities.registrar.aid },
      () => healthy(registrarAt.boot),
      "registrar",
    );
    try {
      const observer = await inProcess(
        impl,
        () =>
          run(() =>
            runObserver({
              ...common,
              name: "observer",
              alias: "observer",
              publicUrl: observerAt.url,
              httpPort: observerPort,
              bootPort: observerBoot,
              sources: [{ url: registrarAt.url + "/", caFile: LOCALHOST_PEM }],
              initialEvidence: [identities.registrar.kel],
              pollIntervalMs: 1000,
              timeoutMs: 1000,
            })
          ),
        { ...observerAt, aid: identities.observer.aid },
        () => healthy(observerAt.boot),
        "observer",
      );
      return { registrar, observer, ca, caFile: LOCALHOST_PEM };
    } catch (error) {
      await registrar.stop();
      throw error;
    }
  }
  const registrarBin = pythonBin("registrar"), observerBin = pythonBin("observer");
  const kelFile = join(folder, "public-bootstrap.cesr");
  const bootstrap = await new Deno.Command(join(dirname(registrarBin), "python"), {
    args: ["-I", "-c", PYTHON_IDENTITIES, SERVICE_PASSCODE, kelFile],
    env: { HOME: folder },
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (bootstrap.code !== 0) throw new Error(new TextDecoder().decode(bootstrap.stderr));
  const aids = Object.fromEntries(
    new TextDecoder().decode(bootstrap.stdout).trim().split("\n").map(line => line.split("=")),
  );
  const tls = ["--keypath", LOCALHOST_PEM, "--certpath", LOCALHOST_PEM, "--cafilepath", LOCALHOST_PEM];
  const env = { KLI_KEYSTORE_PASSCODE: SERVICE_PASSCODE };
  const registrar = await spawned(
    registrarBin,
    [
      "start",
      "--name",
      "localdev-registrar",
      "--alias",
      "registrar",
      "--base",
      "registrar",
      "--host",
      "127.0.0.1",
      "--http",
      String(registrarPort),
      "--boothost",
      "127.0.0.1",
      "--bootport",
      String(registrarBoot),
      "--observer",
      aids.observer,
      "--kel",
      kelFile,
      ...tls,
      "--no-prompt",
    ],
    folder,
    "registrar",
    { ...registrarAt, aid: aids.registrar },
    () => healthy(registrarAt.boot),
    env,
  );
  try {
    const observer = await spawned(
      observerBin,
      [
        "start",
        "--name",
        "localdev-observer",
        "--alias",
        "observer",
        "--base",
        "observer",
        "--host",
        "127.0.0.1",
        "--http",
        String(observerPort),
        "--bootport",
        String(observerBoot),
        "--registrar",
        registrarAt.url + "/",
        "--registrar-ca",
        LOCALHOST_PEM,
        "--kel",
        kelFile,
        "--poll",
        "1",
        "--timeout",
        "5",
        ...tls,
        "--no-prompt",
      ],
      folder,
      "observer",
      { ...observerAt, aid: aids.observer },
      () => healthy(observerAt.boot),
      env,
    );
    return { registrar, observer, ca, caFile: LOCALHOST_PEM };
  } catch (error) {
    await registrar.stop();
    throw error;
  }
}
