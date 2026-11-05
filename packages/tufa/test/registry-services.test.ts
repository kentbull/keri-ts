/** Normal HTTPS service owners with durable private enrollment and real KEL/TEL evidence. */
import { concatBytes, t, Vrsn_2_0 } from "cesr-ts";
import { call, run, sleep, spawn, type Task } from "effection";
import { assertEquals } from "jsr:@std/assert";
import { buildCesrStreamRequest, createHabery } from "keri-ts/runtime";
import { fileURLToPath } from "node:url";
import { author, signed } from "../../observer/test/fixtures/service.ts";
import { runObserver, runRegistrar } from "../src/roles/registry-services.ts";

/** Keep all four listeners distinct without borrowing a developer's active service ports. */
function localPorts(): number[] {
  const listeners = Array.from({ length: 4 }, () => Deno.listen({ hostname: "127.0.0.1", port: 0 }));
  try {
    return listeners.map(listener => listener.addr.port);
  } finally {
    for (const listener of listeners) listener.close();
  }
}

Deno.test("registry service enrollment survives restart and revokes wallet access without stopping source pulls", async () => {
  const folder = await Deno.makeTempDir({ prefix: "tufa-registry-services-" });
  const certificate = fileURLToPath(new URL("./verifier/localhost.pem", import.meta.url));
  const pem = await Deno.readTextFile(certificate);
  const client = Deno.createHttpClient({ caCerts: [pem] });
  const [registrarPort, registrarBoot, observerPort, observerBoot] = localPorts();
  const registrarUrl = `https://localhost:${registrarPort}`, observerUrl = `https://localhost:${observerPort}`;
  const registrarAdmin = `http://127.0.0.1:${registrarBoot}`, observerAdmin = `http://127.0.0.1:${observerBoot}`;
  const common = {
    headDirPath: folder,
    passcode: "abcdefghijklmnopqrstu",
    httpHost: "127.0.0.1",
    tls: { key: pem, cert: pem },
  };
  const fetchAt = (url: string, init?: RequestInit) => fetch(url, { ...init, client });
  try {
    await run(function*() {
      const accountStore = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
      const account = accountStore.makeHab("account");
      const registrarStore = yield* createHabery({
        name: "registrar",
        headDirPath: folder,
        bran: common.passcode,
        skipConfig: true,
        skipSignator: true,
      });
      const registrarHab = registrarStore.makeHab("registrar");
      const observerStore = yield* createHabery({
        name: "observer",
        headDirPath: folder,
        bran: common.passcode,
        skipConfig: true,
        skipSignator: true,
      });
      const observerHab = observerStore.makeHab("observer");
      const registrarAid = registrarHab.pre, observerAid = observerHab.pre;
      const observerKel = concatBytes(...observerStore.db.clonePreIter(observerAid, 0, Vrsn_2_0));
      yield* registrarStore.close();
      yield* observerStore.close();
      const registrarOptions = {
        ...common,
        name: "registrar",
        alias: "registrar",
        publicUrl: registrarUrl,
        httpPort: registrarPort,
        bootPort: registrarBoot,
        observers: [observerAid],
        initialEvidence: [observerKel],
      };
      const observerOptions = {
        ...common,
        name: "observer",
        alias: "observer",
        publicUrl: observerUrl,
        httpPort: observerPort,
        bootPort: observerBoot,
        sources: [{ url: registrarUrl + "/", caFile: certificate }],
        pollIntervalMs: 100,
        timeoutMs: 1000,
        maximumAgeMs: 5000,
      };
      let registrarTask: Task<void> | undefined, observerTask: Task<void> | undefined;
      const waitReady = function*(base: string) {
        const until = Date.now() + 10_000;
        while (Date.now() < until) {
          try {
            const res = yield* call(() => fetchAt(base + "/health"));
            yield* call(() => res.arrayBuffer());
            if (res.ok) return;
          } catch { /* The owner opens its persistent stores before listening. */ }
          yield* sleep(25);
        }
        throw new Error("Registry service did not become ready");
      };
      const start = function*() {
        registrarTask = yield* spawn(() => runRegistrar(registrarOptions));
        yield* waitReady(registrarUrl);
        observerTask = yield* spawn(() => runObserver(observerOptions));
        yield* waitReady(observerUrl);
      };
      const enroll = async (base: string, aid: string, roles: string[], kel: Uint8Array) => {
        const res = await fetchAt(base + "/accounts/" + aid, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roles, kel: t(kel) }),
        });
        assertEquals(res.status, 200);
        return await res.json();
      };
      const publish = (stream: Uint8Array) =>
        fetchAt(registrarUrl + "/ingest", {
          method: "POST",
          ...buildCesrStreamRequest(signed(account, "tels/publish", { stream: t(stream) })),
        });
      const read = (regid: string) =>
        fetchAt(observerUrl + "/", {
          method: "POST",
          ...buildCesrStreamRequest(signed(account, "tels", { i: regid })),
        });
      try {
        yield* start();
        const credential = author(account, "enrolled account");

        // Running the service does not enroll an account; ordinary signed requests still fail closed.
        const deniedPublish = yield* call(() => publish(credential.raw));
        yield* call(() => deniedPublish.arrayBuffer());
        assertEquals(deniedPublish.status, 403);
        const deniedRead = yield* call(() => read(credential.rip.said!));
        yield* call(() => deniedRead.arrayBuffer());
        assertEquals(deniedRead.status, 403);
        const accountKel = concatBytes(...accountStore.db.clonePreIter(account.pre, 0, Vrsn_2_0));
        const publisher = yield* call(() => enroll(registrarAdmin, account.pre, ["publisher"], accountKel));
        const reader = yield* call(() => enroll(observerAdmin, account.pre, ["reader"], accountKel));
        assertEquals(publisher, { aid: account.pre, roles: ["publisher"], service: registrarAid });
        assertEquals(reader, { aid: account.pre, roles: ["reader"], service: observerAid });

        // Public routes cannot grant roles. The independent Observer pulls accepted evidence over verified TLS.
        const publicEnrollment = yield* call(() =>
          fetchAt(observerUrl + "/accounts/" + account.pre, {
            method: "PUT",
            body: "{}",
          })
        );
        yield* call(() => publicEnrollment.arrayBuffer());
        assertEquals(publicEnrollment.status, 404);
        const published = yield* call(() => publish(credential.raw));
        const publishedBody = yield* call(() => published.json());
        assertEquals(published.status, 200);
        assertEquals(publishedBody.heads[credential.rip.said!], credential.update.said);
        const waitRead = function*(observedAfter = 0) {
          const until = Date.now() + 10_000;
          while (Date.now() < until) {
            const res = yield* call(() => read(credential.rip.said!));
            const evidence = new Uint8Array(yield* call(() => res.arrayBuffer()));
            if (res.status === 200 && Date.parse(res.headers.get("Observer-Observed-At")!) > observedAfter) {
              assertEquals(res.headers.get("Observer-Registry-Head"), credential.update.said);
              assertEquals(evidence.length > 0, true);
              return;
            }
            yield* sleep(25);
          }
          throw new Error("Observer did not acquire the enrolled publication");
        };
        yield* waitRead();

        // Close both real owners, reopen the same stores and use the retained role grants.
        yield* observerTask!.halt();
        yield* registrarTask!.halt();
        yield* start();
        const retained = yield* call(() => fetchAt(registrarAdmin + "/accounts/" + account.pre));
        assertEquals(yield* call(() => retained.json()), publisher);
        const republished = yield* call(() => publish(credential.raw));
        yield* call(() => republished.arrayBuffer());
        assertEquals(republished.status, 200);
        yield* waitRead();

        // Wallet revocation changes only its grant; the configured service-to-service reader remains authorized.
        const revokePublisher = yield* call(() =>
          fetchAt(registrarAdmin + "/accounts/" + account.pre, { method: "DELETE" })
        );
        yield* call(() => revokePublisher.arrayBuffer());
        assertEquals(revokePublisher.status, 204);
        const afterRevoke = yield* call(() => publish(credential.raw));
        yield* call(() => afterRevoke.arrayBuffer());
        assertEquals(afterRevoke.status, 403);
        yield* waitRead(Date.now());
        const revokeReader = yield* call(() =>
          fetchAt(observerAdmin + "/accounts/" + account.pre, { method: "DELETE" })
        );
        yield* call(() => revokeReader.arrayBuffer());
        assertEquals(revokeReader.status, 204);
        const afterReaderRevoke = yield* call(() => read(credential.rip.said!));
        yield* call(() => afterReaderRevoke.arrayBuffer());
        assertEquals(afterReaderRevoke.status, 403);
      } finally {
        if (observerTask) yield* observerTask.halt();
        if (registrarTask) yield* registrarTask.halt();
        yield* accountStore.close(true);
      }
    });
  } finally {
    client.close();
    await Deno.remove(folder, { recursive: true });
  }
});
