/** Actual watcher introduction and polling against an independently hosted witness. */
import { concatBytes, Matter, parseBytes, SerderKERI, Vrsn_2_0 } from "cesr-ts";
import { call, run, sleep, spawn, type Task } from "effection";
import { assertEquals } from "jsr:@std/assert";
import {
  acceptedEventReplayMessage,
  createAgentRuntime,
  createHabery,
  FetchHttpClient,
  query,
  reply,
  settleRuntimeIngress,
  systemClock,
} from "keri-ts/runtime";
import { TOTP } from "npm:otpauth@9.4.1";
import { runHostedWatchers } from "../src/roles/hosted-watcher.ts";
import { runHostedWitnesses } from "../src/roles/hosted-witness.ts";

/** Reserve distinct ports together, then release them immediately before service startup. */
function localPorts(): number[] {
  const listeners = Array.from({ length: 4 }, () => Deno.listen({ hostname: "127.0.0.1", port: 0 }));
  try {
    return listeners.map(listener => listener.addr.port);
  } finally {
    for (const listener of listeners) listener.close();
  }
}

Deno.test("KF watcher observes real witness state, acquires advances and survives restart", async () => {
  const folder = await Deno.makeTempDir({ prefix: "tufa-kf-watcher-" });
  const [witnessPort, witnessBoot, watcherPort, watcherBoot] = localPorts();
  const witnessUrl = `http://127.0.0.1:${witnessPort}`, witnessAdmin = `http://127.0.0.1:${witnessBoot}`;
  const watcherUrl = `http://127.0.0.1:${watcherPort}`, watcherAdmin = `http://127.0.0.1:${watcherBoot}`;
  const client = Deno.createHttpClient({});
  const common = { headDirPath: folder, passcode: "abcdefghijklmnopqrstu", httpHost: "127.0.0.1" };
  const watcherOptions = {
    ...common,
    name: "watcher-provider",
    publicUrl: watcherUrl,
    httpPort: watcherPort,
    bootPort: watcherBoot,
    pollIntervalMs: 100,
  };
  const fetchAt = (url: string, init?: RequestInit) => fetch(url, { ...init, client });
  try {
    await run(function*() {
      const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true, skipSignator: true });
      const controller = hby.makeHab("controller"), stranger = hby.makeHab("stranger");
      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
      let witnessTask: Task<void> | undefined, watcherTask: Task<void> | undefined;
      const waitReady = function*(base: string) {
        const until = Date.now() + 10_000;
        while (Date.now() < until) {
          try {
            const res = yield* call(() => fetchAt(base + "/health"));
            yield* call(() => res.arrayBuffer());
            if (res.ok) return;
          } catch { /* Provider storage opens before its listener is acquired. */ }
          yield* sleep(25);
        }
        throw new Error("Backend did not become ready");
      };
      const allocate = async (base: string, resource: string) => {
        const res = await fetchAt(base + "/" + resource, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ aid: controller.pre }),
        });
        assertEquals(res.status, 200);
        return await res.json() as { eid: string; cid: string; oobis: string[] };
      };
      try {
        witnessTask = yield* spawn(() =>
          runHostedWitnesses({
            ...common,
            name: "witness-provider",
            publicUrl: witnessUrl,
            httpPort: witnessPort,
            bootPort: witnessBoot,
          })
        );
        watcherTask = yield* spawn(() => runHostedWatchers(watcherOptions));
        yield* waitReady(witnessAdmin);
        yield* waitReady(watcherAdmin);
        const witness = yield* call(() => allocate(witnessAdmin, "witnesses"));
        const watcher = yield* call(() => allocate(watcherAdmin, "watchers"));
        const inception = acceptedEventReplayMessage(hby, controller.pre, 0, Vrsn_2_0).message;
        const form = new FormData();
        form.set("kel", new Blob([new Uint8Array(inception)]), "inception.cesr");
        const registration = yield* call(() =>
          fetchAt(witnessUrl + "/aids", {
            method: "POST",
            headers: { "CESR-DESTINATION": witness.eid },
            body: form,
          })
        );
        const credentials = yield* call(() => registration.json());
        assertEquals(registration.status, 200);
        const plain = hby.mgr.decrypt(credentials.totp, { verfers: controller.kever!.verfers });
        const secret = new TextDecoder().decode(new Matter({ qb64b: plain }).raw);
        const oobi = yield* call(() => fetchAt(witness.oobis[0]));
        const witnessEvidence = new Uint8Array(yield* call(() => oobi.arrayBuffer()));
        yield* settleRuntimeIngress(runtime, [witnessEvidence]);
        const receipt = function*(message: Uint8Array) {
          const timestamp = Date.now();
          const res = yield* call(() =>
            fetchAt(witnessUrl + "/receipts", {
              method: "POST",
              headers: {
                "Content-Type": "application/cesr",
                "CESR-DESTINATION": witness.eid,
                Authorization: new TOTP({ secret }).generate({ timestamp }) + "#" + new Date(timestamp).toISOString(),
              },
              body: new Uint8Array(message),
            })
          );
          const body = new Uint8Array(yield* call(() => res.arrayBuffer()));
          assertEquals(res.status, 200);
          yield* settleRuntimeIngress(runtime, [body]);
          assertEquals(hby.db.fullyWitnessed(controller.kever!.serder), true);
        };
        yield* receipt(controller.rotate({ adds: [witness.eid], toad: 1 }));
        const postWatcher = async (message: Uint8Array) =>
          await fetchAt(watcherUrl + "/", {
            method: "POST",
            headers: { "Content-Type": "application/cesr", "CESR-DESTINATION": watcher.eid },
            body: new Uint8Array(message),
          });

        // Match Locksmith's introduction: public KEL plus a signed watcher-add reply and account witness OOBI.
        const observedOobi = witnessUrl + `/oobi/${controller.pre}/witness/${witness.eid}`;
        const observedResponse = yield* call(() => fetchAt(observedOobi));
        yield* call(() => observedResponse.arrayBuffer());
        assertEquals(observedResponse.status, 200);
        const introduction = concatBytes(witnessEvidence, ...hby.db.clonePreIter(controller.pre, 0, Vrsn_2_0));
        const introduced = yield* call(() => postWatcher(introduction));
        yield* call(() => introduced.arrayBuffer());
        assertEquals(introduced.status, 204);
        const watched = reply(`/watcher/${watcher.eid}/add`, {
          cid: controller.pre,
          oid: controller.pre,
          oobi: observedOobi,
        }, { pre: controller.pre, pvrsn: Vrsn_2_0, gvrsn: Vrsn_2_0 });
        const added = yield* call(() => postWatcher(controller.endorse(watched, { gvrsn: Vrsn_2_0 })));
        yield* call(() => added.arrayBuffer());
        assertEquals(added.status, 204);
        const waitObserved = function*(sn: number) {
          const until = Date.now() + 10_000;
          let status;
          while (Date.now() < until) {
            const res = yield* call(() => fetchAt(watcherAdmin + `/watchers/${watcher.eid}/status`));
            status = yield* call(() => res.json());
            assertEquals(res.status, 200);
            const state = status.aids[controller.pre]?.witnesses[witness.eid];
            if (state?.response_received && state.state === "even" && state.sequence_number === sn) return status;
            yield* sleep(25);
          }
          throw new Error("Watcher did not converge: " + JSON.stringify(status));
        };
        yield* waitObserved(1);

        // Only the witness receives the new event; the watcher must acquire and verify its KEL independently.
        yield* receipt(controller.interact());
        const status = yield* waitObserved(2);
        assertEquals(status.aids[controller.pre].witnesses[witness.eid].digest, controller.kever!.serder.said);
        const queryMessage = (signer: typeof controller) =>
          signer.endorse(
            query("ksn", { i: controller.pre, src: watcher.eid }, {
              pre: signer.pre,
              pvrsn: Vrsn_2_0,
              gvrsn: Vrsn_2_0,
            }),
            { gvrsn: Vrsn_2_0 },
          );
        const forbidden = yield* call(() => postWatcher(queryMessage(stranger)));
        yield* call(() => forbidden.arrayBuffer());
        assertEquals(forbidden.status, 403);
        const stateResponse = yield* call(() => postWatcher(queryMessage(controller)));
        const stateBytes = new Uint8Array(yield* call(() => stateResponse.arrayBuffer()));
        assertEquals(stateResponse.status, 200);
        const stateReply = parseBytes(stateBytes)[0].body as SerderKERI;
        assertEquals(stateReply.pvrsn.major, 2);
        assertEquals((stateReply.ked!.a as Record<string, unknown>).s, "2");

        // A normal stop/reopen preserves the allocation, controller policy and latest verified observations.
        yield* watcherTask.halt();
        watcherTask = yield* spawn(() => runHostedWatchers(watcherOptions));
        yield* waitReady(watcherAdmin);
        const retained = yield* waitObserved(2);
        assertEquals(retained.controller_id, controller.pre);
        const removed = yield* call(() => fetchAt(watcherAdmin + `/watchers/${watcher.eid}`, { method: "DELETE" }));
        yield* call(() => removed.arrayBuffer());
        assertEquals(removed.status, 204);
        const gone = yield* call(() => fetchAt(watcher.oobis[0]));
        yield* call(() => gone.arrayBuffer());
        assertEquals(gone.status, 404);
      } finally {
        if (watcherTask) yield* watcherTask.halt();
        if (witnessTask) yield* witnessTask.halt();
        yield* runtime.close();
        yield* hby.close();
      }
    });
  } finally {
    client.close();
    await Deno.remove(folder, { recursive: true });
  }
});
