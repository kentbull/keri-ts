/** Actual private/public backend lifecycle and controller protocol use; no substituted service objects. */
import { Matter, parseBytes, SerderKERI, Siger, Vrsn_2_0 } from "cesr-ts";
import { call, run, sleep, spawn, type Task } from "effection";
import { assertEquals, assertExists } from "jsr:@std/assert";
import {
  acceptedEventReplayMessage,
  createAgentRuntime,
  createHabery,
  envelopeFromFrame,
  FetchHttpClient,
  messagize,
  settleRuntimeIngress,
  systemClock,
} from "keri-ts/runtime";
import { TOTP } from "npm:otpauth@9.4.1";
import { runHostedWitnesses } from "../src/roles/hosted-witness.ts";

/** Select distinct local ports before opening the real listeners. */
function ports(): [number, number] {
  const first = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const second = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  try {
    return [first.addr.port, second.addr.port];
  } finally {
    first.close();
    second.close();
  }
}

Deno.test("KF witness backend registers, receipts, reopens and deletes isolated allocations", async () => {
  const folder = await Deno.makeTempDir({ prefix: "tufa-kf-witness-" });
  const [httpPort, bootPort] = ports();
  const publicUrl = `http://127.0.0.1:${httpPort}`, bootUrl = `http://127.0.0.1:${bootPort}`;
  const client = Deno.createHttpClient({});
  const options = {
    name: "provider",
    headDirPath: folder,
    passcode: "abcdefghijklmnopqrstu",
    publicUrl,
    httpPort,
    httpHost: "127.0.0.1",
    bootPort,
  };
  try {
    await run(function*() {
      const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true, skipSignator: true });
      const controller = hby.makeHab("controller"), other = hby.makeHab("other");
      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
      let server: Task<void> | undefined;
      const fetchAt = (url: string, init?: RequestInit) => fetch(url, { ...init, client });
      const start = function*() {
        server = yield* spawn(() => runHostedWitnesses(options));
        const until = Date.now() + 10_000;
        while (true) {
          try {
            const response = yield* call(() => fetchAt(bootUrl + "/health"));
            yield* call(() => response.arrayBuffer());
            if (response.ok) break;
          } catch { /* The listener is acquired after the retained witnesses reopen. */ }
          if (Date.now() > until) throw new Error("Backend did not start");
          yield* sleep(25);
        }
      };
      const allocate = async (aid: string) => {
        const response = await fetchAt(bootUrl + "/witnesses", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ aid }),
        });
        assertEquals(response.status, 200);
        return await response.json() as { eid: string; cid: string; oobis: string[] };
      };
      const register = async (eid: string, inception: Uint8Array) => {
        const form = new FormData();
        form.set("kel", new Blob([new Uint8Array(inception)]), "inception.cesr");
        return await fetchAt(publicUrl + "/aids", {
          method: "POST",
          headers: { "CESR-DESTINATION": eid },
          body: form,
        });
      };
      try {
        yield* start();
        const first = yield* call(() => allocate(controller.pre));
        const second = yield* call(() => allocate(other.pre));
        assertEquals(first.cid, controller.pre);
        assertEquals(first.eid === second.eid, false);
        const inception = acceptedEventReplayMessage(hby, controller.pre, 0, Vrsn_2_0).message;

        // The public boot route cannot allocate; one tenant cannot register another's inception.
        const publicBoot = yield* call(() => fetchAt(publicUrl + "/witnesses", { method: "POST" }));
        yield* call(() => publicBoot.arrayBuffer());
        assertEquals(publicBoot.status, 400);
        const wrong = yield* call(() => register(second.eid, inception));
        yield* call(() => wrong.arrayBuffer());
        assertEquals(wrong.status, 400);
        const registration = yield* call(() => register(first.eid, inception));
        const credentials = yield* call(() => registration.json());
        assertEquals(registration.status, 200);
        assertEquals(credentials.oobi, first.oobis[0]);
        const plain = hby.mgr.decrypt(credentials.totp, { verfers: controller.kever!.verfers });
        const secret = new TextDecoder().decode(new Matter({ qb64b: plain }).raw);
        assertEquals(secret.length, 32);

        // A retained accepted KEL must not authenticate a new registration with a damaged signature.
        const original = envelopeFromFrame(parseBytes(inception)[0]);
        const signature = original.sigers[0], altered = signature.raw.slice();
        altered[0] ^= 1;
        const damaged = messagize(original.serder, {
          sigers: [new Siger({ code: signature.code, raw: altered, index: signature.index, ondex: signature.ondex })],
          gvrsn: Vrsn_2_0,
        });
        const badSignature = yield* call(() => register(first.eid, damaged));
        yield* call(() => badSignature.arrayBuffer());
        assertEquals(badSignature.status, 403);
        const oobi = yield* call(() => fetchAt(credentials.oobi));
        const evidence = new Uint8Array(yield* call(() => oobi.arrayBuffer()));
        assertEquals(oobi.status, 200);
        assertEquals(parseBytes(evidence).every(frame => (frame.body as SerderKERI).pvrsn.major === 2), true);
        yield* settleRuntimeIngress(runtime, [evidence]);

        // Rotate onto the allocated witness, then verify the returned v2 receipt independently.
        const rotation = controller.rotate({ adds: [first.eid], toad: 1 });
        const post = async (bytes: Uint8Array, authorized: boolean, path = "/receipts") => {
          const headers: Record<string, string> = { "Content-Type": "application/cesr", "CESR-DESTINATION": first.eid };
          if (authorized) {
            const timestamp = Date.now();
            headers.Authorization = new TOTP({ secret }).generate({ timestamp }) + "#"
              + new Date(timestamp).toISOString();
          }
          return await fetchAt(publicUrl + path, { method: "POST", headers, body: new Uint8Array(bytes) });
        };
        const missing = yield* call(() => post(rotation, false));
        yield* call(() => missing.arrayBuffer());
        assertEquals(missing.status, 403);
        const receipt = yield* call(() => post(rotation, true));
        const receiptBytes = new Uint8Array(yield* call(() => receipt.arrayBuffer()));
        assertEquals(receipt.status, 200);
        assertEquals((parseBytes(receiptBytes)[0].body as SerderKERI).pvrsn.major, 2);
        yield* settleRuntimeIngress(runtime, [receiptBytes]);
        assertEquals(hby.db.fullyWitnessed(controller.kever!.serder), true);

        // Reopen the actual provider stores; the same encrypted code and witness AID must still work.
        yield* server!.halt();
        yield* start();
        const interaction = controller.interact();
        const resumed = yield* call(() => post(interaction, true));
        const resumedBytes = new Uint8Array(yield* call(() => resumed.arrayBuffer()));
        assertEquals(resumed.status, 200);
        yield* settleRuntimeIngress(runtime, [resumedBytes]);
        assertEquals(hby.db.fullyWitnessed(controller.kever!.serder), true);
        const state = yield* call(() =>
          fetchAt(publicUrl + "/ksn?pre=" + controller.pre, { headers: { "CESR-DESTINATION": first.eid } })
        );
        const stateBytes = new Uint8Array(yield* call(() => state.arrayBuffer()));
        assertEquals(state.status, 200);
        assertEquals((parseBytes(stateBytes)[0].body as SerderKERI).pvrsn.major, 2);
        const log = yield* call(() =>
          fetchAt(publicUrl + "/log?pre=" + controller.pre + "&s=2", { headers: { "CESR-DESTINATION": first.eid } })
        );
        const logBytes = new Uint8Array(yield* call(() => log.arrayBuffer()));
        assertEquals(log.status, 200);
        assertEquals(parseBytes(logBytes).map(frame => (frame.body as SerderKERI).sn), [0, 1, 2]);

        // Deleting one allocation removes its routes without closing the other tenant's store.
        const removed = yield* call(() => fetchAt(bootUrl + "/witnesses/" + first.eid, { method: "DELETE" }));
        yield* call(() => removed.arrayBuffer());
        assertEquals(removed.status, 204);
        const gone = yield* call(() => fetchAt(first.oobis[0]));
        yield* call(() => gone.arrayBuffer());
        assertEquals(gone.status, 404);
        const retained = yield* call(() => fetchAt(second.oobis[0]));
        const retainedBytes = new Uint8Array(yield* call(() => retained.arrayBuffer()));
        assertEquals(retained.status, 200);
        assertExists(parseBytes(retainedBytes)[0]);
      } finally {
        if (server) yield* server.halt();
        yield* runtime.close();
        yield* hby.close();
      }
    });
  } finally {
    client.close();
    await Deno.remove(folder, { recursive: true });
  }
});
