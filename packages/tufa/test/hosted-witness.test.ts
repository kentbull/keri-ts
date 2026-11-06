/** Actual private/public backend lifecycle and controller protocol use; no substituted service objects. */
import { Matter, parseBytes, SerderKERI, Siger, Vrsn_2_0 } from "cesr-ts";
import { call, run, sleep, spawn, type Task } from "effection";
import { assertEquals, assertExists, assertRejects } from "jsr:@std/assert";
import {
  acceptedEventReplayMessage,
  createAgentRuntime,
  createHabery,
  envelopeFromFrame,
  FetchHttpClient,
  messagize,
  Receiptor,
  registerWithWitness,
  settleRuntimeIngress,
  systemClock,
} from "keri-ts/runtime";
import { Secret, TOTP } from "npm:otpauth@9.4.1";
import { mailboxAddCommand } from "../src/cli/commands/mailbox.ts";
import { rotateWithCredentialsCommand } from "../src/cli/commands/rotate.ts";
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
      const controllerStore = {
        name: "controller",
        headDirPath: folder,
        bran: options.passcode,
        skipConfig: true,
        skipSignator: true,
      };
      const hby = yield* createHabery(controllerStore);
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
      const register = async (eid: string, inception: Uint8Array, file = false) => {
        const form = new FormData();
        if (file) form.set("kel", new Blob([new Uint8Array(inception)]), "inception.cesr");
        else form.set("kel", new TextDecoder().decode(inception));
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
        // File and text parts both authenticate through the ordinary controller checks.
        const fileRegistration = yield* call(() =>
          register(second.eid, acceptedEventReplayMessage(hby, other.pre, 0, Vrsn_2_0).message, true)
        );
        yield* call(() => fileRegistration.arrayBuffer());
        assertEquals(fileRegistration.status, 200);
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
        const oobi = yield* call(() => fetchAt(credentials.oobi));
        const evidence = new Uint8Array(yield* call(() => oobi.arrayBuffer()));
        assertEquals(oobi.status, 200);
        assertEquals(parseBytes(evidence).every(frame => (frame.body as SerderKERI).pvrsn.major === 2), true);
        yield* settleRuntimeIngress(runtime, [evidence]);

        // The normal finite command selects one allocation at the shared public origin.
        const mailboxClient = yield* createHabery({ name: "mailbox-client", headDirPath: folder, skipConfig: true });
        const reader = mailboxClient.makeHab("reader");
        const readerRuntime = yield* createAgentRuntime(mailboxClient, new FetchHttpClient(), systemClock);
        try {
          yield* settleRuntimeIngress(readerRuntime, [evidence]);
        } finally {
          yield* readerRuntime.close();
          yield* mailboxClient.close();
        }
        yield* mailboxAddCommand({
          name: "mailbox-client",
          headDirPath: folder,
          alias: reader.name,
          mailbox: first.eid,
        });

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
        // As in witness-hk, a missing code escrows the new event instead of refusing it.
        const missing = yield* call(() => post(rotation, false));
        yield* call(() => missing.arrayBuffer());
        assertEquals(missing.status, 202);
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

        // Reopened normal rotation refuses another account's artifact before advancing its KEL.
        const credentialFile = `${folder}/witness-credentials.json`, before = controller.kever!.sn;
        const artifact = {
          account: other.pre,
          provider: publicUrl,
          server: first.eid,
          witnesses: [{
            eid: first.eid,
            url: publicUrl,
            secret,
          }],
        };
        yield* runtime.close();
        yield* hby.close();
        const rotationArgs = {
          name: controllerStore.name,
          headDirPath: folder,
          passcode: options.passcode,
          alias: "controller",
          endpoint: true,
          witnessCredentials: credentialFile,
        };
        yield* call(() => Deno.writeTextFile(credentialFile, JSON.stringify(artifact), { mode: 0o600 }));
        yield* call(() =>
          assertRejects(() => run(() => rotateWithCredentialsCommand(rotationArgs)), Error, "another account")
        );
        const unchanged = yield* createHabery(controllerStore);
        try {
          assertEquals(unchanged.habByName("controller")!.kever!.sn, before);
        } finally {
          yield* unchanged.close();
        }
        artifact.account = controller.pre;
        yield* call(() => Deno.writeTextFile(credentialFile, JSON.stringify(artifact), { mode: 0o600 }));
        // The plaintext seed keeps credentialed rotations working although Keeper rotation erases
        // the inception key the registration response was encrypted to.
        for (let count = 1; count <= 3; count++) {
          yield* rotateWithCredentialsCommand(rotationArgs);
          const rotated = yield* createHabery(controllerStore);
          try {
            const account = rotated.habByName("controller")!;
            assertEquals(account.kever!.sn, before + count);
            assertEquals(rotated.db.fullyWitnessed(account.kever!.serder), true);
            const saved = JSON.parse(yield* call(() => Deno.readTextFile(credentialFile)));
            assertEquals(saved.witnesses.length, 1);
            assertEquals(saved.witnesses[0].secret === secret, true);
          } finally {
            yield* rotated.close();
          }
        }

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
        if (hby.db.opened) {
          yield* runtime.close();
          yield* hby.close();
        }
      }
    });
  } finally {
    client.close();
    await Deno.remove(folder, { recursive: true });
  }
});

Deno.test("KF witness backend follows witness-hk registration and receipt outcomes", async () => {
  const folder = await Deno.makeTempDir({ prefix: "tufa-kf-witness-hk-" });
  const [httpPort, bootPort] = ports();
  const publicUrl = `http://127.0.0.1:${httpPort}`, bootUrl = `http://127.0.0.1:${bootPort}`;
  const client = Deno.createHttpClient({});
  const passcode = "abcdefghijklmnopqrstu";
  const fetchAt = (url: string, init?: RequestInit) => fetch(url, { ...init, client });
  /** Read the whole response so no body outlives its assertion. */
  const status = async (response: Promise<Response>) => {
    const done = await response;
    await done.arrayBuffer();
    return done.status;
  };
  const allocate = async (aid: string) => {
    const response = await fetchAt(bootUrl + "/witnesses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ aid }),
    });
    assertEquals(response.status, 200);
    return (await response.json() as { eid: string }).eid;
  };
  /** KERIpy and Locksmith send the KEL (and an optional secret) as multipart text fields. */
  const register = (eid: string, kel: Uint8Array, secret?: string) => {
    const form = new FormData();
    form.set("kel", new TextDecoder().decode(kel));
    if (secret !== undefined) form.set("secret", secret);
    return fetchAt(publicUrl + "/aids", { method: "POST", headers: { "CESR-DESTINATION": eid }, body: form });
  };
  const code = (secret: string) => {
    const timestamp = Date.now();
    return new TOTP({ secret }).generate({ timestamp }) + "#" + new Date(timestamp).toISOString();
  };
  const post = (eid: string, bytes: Uint8Array, authorization?: string, path = "/receipts", method = "POST") => {
    const headers: Record<string, string> = { "Content-Type": "application/cesr", "CESR-DESTINATION": eid };
    if (authorization) headers.Authorization = authorization;
    return fetchAt(publicUrl + path, { method, headers, body: new Uint8Array(bytes) });
  };
  const concat = (messages: Iterable<Uint8Array>) => {
    const parts = [...messages], out = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  };
  try {
    await run(function*() {
      const hby = yield* createHabery({
        name: "controller",
        headDirPath: folder,
        bran: passcode,
        skipConfig: true,
        skipSignator: true,
      });
      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
      const server = yield* spawn(() =>
        runHostedWitnesses({
          name: "provider",
          headDirPath: folder,
          passcode,
          publicUrl,
          httpPort,
          httpHost: "127.0.0.1",
          bootPort,
        })
      );
      try {
        const until = Date.now() + 10_000;
        while ((yield* call(() => status(fetchAt(bootUrl + "/health")).catch(() => 0))) !== 200) {
          if (Date.now() > until) throw new Error("Backend did not start");
          yield* sleep(25);
        }
        const kel = (pre: string) => concat(hby.db.clonePreIter(pre, 0, Vrsn_2_0));
        const secretOf = (cipher: string, verfers = hby.habByName("controller")!.kever!.verfers) =>
          new TextDecoder().decode(new Matter({ qb64b: hby.mgr.decrypt(cipher, { verfers }) }).raw);
        const controller = hby.makeHab("controller"), other = hby.makeHab("other"), fresh = hby.makeHab("fresh");
        const multi = hby.makeHab("multi", undefined, { icount: 2, isith: "2", ncount: 2, nsith: "2" });
        const unregistered = hby.makeHab("unregistered");
        const witness = yield* call(() => allocate(controller.pre));
        const freshWitness = yield* call(() => allocate(fresh.pre));
        const multiWitness = yield* call(() => allocate(multi.pre));
        const otherWitness = yield* call(() => allocate(other.pre));
        const idleWitness = yield* call(() => allocate(unregistered.pre));

        // Unknown destinations are 400 on registration and receipts, 404 elsewhere.
        const unknown = other.pre;
        assertEquals(yield* call(() => status(register(unknown, kel(controller.pre)))), 400);
        assertEquals(yield* call(() => status(post(unknown, kel(controller.pre)))), 400);
        assertEquals(
          yield* call(() =>
            status(fetchAt(publicUrl + "/ksn?pre=" + controller.pre, { headers: { "CESR-DESTINATION": unknown } }))
          ),
          404,
        );

        // An unverifiable first event registers nothing until the controller is accepted.
        const damage = (message: Uint8Array) => {
          const original = envelopeFromFrame(parseBytes(message)[0]);
          const signature = original.sigers[0], altered = signature.raw.slice();
          altered[0] ^= 1;
          return messagize(original.serder, {
            sigers: [new Siger({ code: signature.code, raw: altered, index: signature.index, ondex: signature.ondex })],
            gvrsn: Vrsn_2_0,
          });
        };
        const freshInception = acceptedEventReplayMessage(hby, fresh.pre, 0, Vrsn_2_0).message;
        assertEquals(yield* call(() => status(register(freshWitness, damage(freshInception)))), 400);
        assertEquals(yield* call(() => status(register(freshWitness, freshInception))), 200);
        // Once accepted, any first frame re-registers the allocated controller (upstream contract).
        assertEquals(yield* call(() => status(register(freshWitness, damage(freshInception)))), 200);

        // The first frame names the subject; another AID's KEL is refused even with ours behind it.
        assertEquals(
          yield* call(() => status(register(witness, concat([kel(other.pre), kel(controller.pre)])))),
          400,
        );

        // Full KEL after a rotation: registration answers to the current keys.
        controller.rotate();
        controller.interact();
        const registered = yield* call(() => register(witness, kel(controller.pre)));
        assertEquals(registered.status, 200);
        const secret = secretOf((yield* call(() => registered.json())).totp);
        assertEquals(secret.length, 32);

        // /receipts: one event only, the registered controller only, and only after registration.
        const rotation = controller.rotate({ adds: [witness], toad: 1 });
        assertEquals(yield* call(() => status(post(witness, concat([rotation, rotation]), code(secret)))), 400);
        assertEquals(yield* call(() => status(post(witness, kel(other.pre), code(secret)))), 403);
        const idleRotation = unregistered.rotate({ adds: [idleWitness], toad: 1 });
        assertEquals(yield* call(() => status(post(idleWitness, idleRotation))), 412);

        // An invalid code escrows the new event; a valid one receipts it; an accepted event is receipted anyway.
        assertEquals(yield* call(() => status(post(witness, rotation, "000000#" + new Date().toISOString()))), 202);
        assertEquals(hby.db.fullyWitnessed(controller.kever!.serder), false);
        const valid = yield* call(() => post(witness, rotation, code(secret)));
        const receipt = new Uint8Array(yield* call(() => valid.arrayBuffer()));
        assertEquals(valid.status, 200);
        yield* settleRuntimeIngress(runtime, [receipt]);
        assertEquals(hby.db.fullyWitnessed(controller.kever!.serder), true);
        assertEquals(yield* call(() => status(post(witness, rotation, "000000#" + new Date().toISOString()))), 200);

        // `/` accepts ordinary KERI input with or without a code (204).
        const interaction = controller.interact();
        assertEquals(yield* call(() => status(post(witness, interaction, undefined, "/"))), 204);
        assertEquals(yield* call(() => status(post(witness, interaction, code(secret), "/", "PUT"))), 204);

        // A supplied secret is used as given; a non-base32 one only makes every code invalid.
        const unusable = "0".repeat(32);
        assertEquals(yield* call(() => status(register(otherWitness, kel(other.pre), unusable))), 200);
        const otherRotation = other.rotate({ adds: [otherWitness], toad: 1 });
        assertEquals(yield* call(() => status(post(otherWitness, otherRotation, code(secret)))), 202);
        // Re-registration with a usable supplied secret (Locksmith's batch secret) repairs it.
        const batch = new Secret({ size: 20 }).base32;
        assertEquals(yield* call(() => status(register(otherWitness, kel(other.pre), batch))), 200);
        assertEquals(yield* call(() => status(post(otherWitness, otherRotation, code(batch)))), 200);

        // A multi-key controller gets one ciphertext per current key, in key order.
        const multiRegistered = yield* call(() => register(multiWitness, kel(multi.pre)));
        assertEquals(multiRegistered.status, 200);
        const credentials: { totp: string; totps: string[] } = yield* call(() => multiRegistered.json());
        assertEquals(credentials.totps.length, 2);
        assertEquals(credentials.totp, credentials.totps[0]);
        const keys = multi.kever!.verfers;
        assertEquals(secretOf(credentials.totps[0], [keys[0]]), secretOf(credentials.totps[1], [keys[1]]));
      } finally {
        yield* server.halt();
        yield* runtime.close();
        yield* hby.close();
      }
    });
  } finally {
    client.close();
    await Deno.remove(folder, { recursive: true });
  }
});

Deno.test("registerWithWitness registers and re-registers a rotated controller with the hosted witness", async () => {
  const folder = await Deno.makeTempDir({ prefix: "tufa-kf-witness-register-" });
  const [httpPort, bootPort] = ports();
  const publicUrl = `http://127.0.0.1:${httpPort}`, bootUrl = `http://127.0.0.1:${bootPort}`;
  const client = Deno.createHttpClient({});
  const passcode = "abcdefghijklmnopqrstu";
  const fetchAt = (url: string, init?: RequestInit) => fetch(url, { ...init, client });
  try {
    await run(function*() {
      const hby = yield* createHabery({
        name: "controller",
        headDirPath: folder,
        bran: passcode,
        skipConfig: true,
        skipSignator: true,
      });
      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
      const server = yield* spawn(() =>
        runHostedWitnesses({
          name: "provider",
          headDirPath: folder,
          passcode,
          publicUrl,
          httpPort,
          httpHost: "127.0.0.1",
          bootPort,
        })
      );
      try {
        const until = Date.now() + 10_000;
        while (true) {
          const health = yield* call(() =>
            fetchAt(bootUrl + "/health").then(r => r.arrayBuffer().then(() => r.ok), () => false)
          );
          if (health) break;
          if (Date.now() > until) throw new Error("Backend did not start");
          yield* sleep(25);
        }
        const account = hby.makeHab("account");
        const allocated = yield* call(() =>
          fetchAt(bootUrl + "/witnesses", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ aid: account.pre }),
          }).then(r => r.json() as Promise<{ eid: string; oobis: string[] }>)
        );
        const witness = { eid: allocated.eid, url: publicUrl };
        const evidence = yield* call(() => fetchAt(allocated.oobis[0]).then(r => r.arrayBuffer()));
        yield* settleRuntimeIngress(runtime, [new Uint8Array(evidence)]);
        const receiptor = new Receiptor(hby, runtime.protocol, runtime.http, runtime.clock);
        const witnessed = function*(secret: string) {
          const timestamp = Date.now();
          const auths = {
            [witness.eid]: new TOTP({ secret }).generate({ timestamp }) + "#" + new Date(timestamp).toISOString(),
          };
          yield* receiptor.receipt(account.pre, { sn: account.kever!.sn, auths });
          return hby.db.fullyWitnessed(account.kever!.serder);
        };

        // Register at inception, then rotate onto the witness and twice more with the same secret.
        const first = yield* registerWithWitness(account, witness, runtime.http);
        assertEquals(first.oobi, allocated.oobis[0]);
        assertEquals(first.secret.length, 32);
        account.rotate({ adds: [witness.eid], toad: 1 });
        assertEquals(yield* witnessed(first.secret), true);
        for (let count = 0; count < 2; count++) {
          account.rotate();
          assertEquals(yield* witnessed(first.secret), true);
        }

        // The secret is lost: re-registration with the full KEL answers to the current keys.
        const renewed = yield* registerWithWitness(account, witness, runtime.http);
        assertEquals(renewed.secret.length, 32);
        account.interact();
        assertEquals(yield* witnessed(renewed.secret), true);

        // A supplied batch secret (Locksmith's batch mode) is what the witness then uses.
        const batch = new Secret({ size: 20 }).base32;
        assertEquals((yield* registerWithWitness(account, witness, runtime.http, { secret: batch })).secret, batch);
        account.interact();
        assertEquals(yield* witnessed(batch), true);
      } finally {
        yield* server.halt();
        yield* runtime.close();
        yield* hby.close();
      }
    });
  } finally {
    client.close();
    await Deno.remove(folder, { recursive: true });
  }
});
