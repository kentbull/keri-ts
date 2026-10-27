/** Actual TLS sources and signed cache queries preserve the selected observation boundary. */
import { createTufaApp, sourceRequest, SourceTrust } from "@keri-ts/hosting";
import { Registrar } from "@keri-ts/registrar";
import { b, concatBytes, makeBlindState } from "cesr-ts";
import { call, run, spawn } from "effection";
import { assert, assertEquals, assertRejects, assertThrows } from "jsr:@std/assert";
import {
  blindate,
  createAgentRuntime,
  createHabery,
  FetchHttpClient,
  systemClock,
  TransportError,
  ValidationError,
} from "keri-ts/runtime";
import { createObservationBaser, Observer } from "../mod.ts";

import { author, certificate, framed, kel, serveTls, signed, wrongCertificate } from "./fixtures/service.ts";

Deno.test("observer isolates source scopes and serves only exact recent cached heads over TLS", async () => {
  await run(function*() {
    const issuer = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const host = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const observed = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const reader = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const a = issuer.makeHab("issuer-a"),
      bHab = issuer.makeHab("issuer-b"),
      observerHab = observed.makeHab("observer"),
      readerHab = reader.makeHab("reader");
    host.makeHab("registrar");
    const kram = {
      enabled: true,
      denials: [],
      caches: { "~": [1000, 5000, 60000, 300000, 5000, 60000, 300000] as const },
    };
    const hosted = yield* createAgentRuntime(host, new FetchHttpClient(), systemClock, { kram });
    const cached = yield* createAgentRuntime(observed, new FetchHttpClient(), systemClock, { kram });
    const records = yield* createObservationBaser({ name: crypto.randomUUID(), temp: true });
    const first = author(a, "A"), other = author(bHab, "B");
    for (const wire of observed.db.clonePreIter(observerHab.pre)) yield* hosted.reactor.processBytes(wire);
    for (const wire of reader.db.clonePreIter(readerHab.pre)) yield* cached.reactor.processBytes(wire);
    yield* hosted.reactor.processBytes(first.raw);
    const registrar = new Registrar(hosted.protocol, hosted.acdc!.store, {
      observers: [observerHab.pre],
      fullEvidence: true,
    });
    const pem = yield* call(() => Deno.readTextFile(certificate));
    let requestsA = 0,
      requestsB = 0,
      overrideA: Uint8Array | undefined,
      bodyB = other.raw,
      statusB = 200,
      redirectB = "";
    let scheduledAfter = Infinity, reached: (() => void) | undefined;
    const serverA = yield* call(() =>
      serveTls(pem, async req => {
        requestsA++;
        if (requestsA >= scheduledAfter) reached?.();
        if (overrideA) {
          return new Response(new Uint8Array(overrideA).buffer, { headers: { "Content-Type": "application/cesr" } });
        }
        return await registrar.handle(req);
      })
    );
    const serverB = yield* call(() =>
      serveTls(pem, async req => {
        requestsB++;
        await req.arrayBuffer();
        return new Response(new Uint8Array(bodyB).buffer, {
          status: statusB,
          headers: { "Content-Type": "application/cesr", ...(redirectB ? { Location: redirectB } : {}) },
        });
      })
    );
    const urlA = `https://127.0.0.1:${serverA.addr.port}/`, urlB = `https://127.0.0.1:${serverB.addr.port}/`;
    let now = Date.now();
    const sources = [urlA, urlB].map(url => ({ url, caFile: certificate, certName: "localhost" }));
    const service = new Observer(cached.protocol, cached.acdc!.store, records, {
      sources,
      readers: [readerHab.pre],
      maximumAgeMs: 1000,
      now: () => now,
    });
    const app = createTufaApp({ protocolHandler: service.handle });
    const server = yield* call(() => serveTls(pem, app.fetch));
    const target = new SourceTrust({
      url: `https://127.0.0.1:${server.addr.port}/`,
      caFile: certificate,
      certName: "localhost",
    });
    function* read(regid: string) {
      return yield* sourceRequest(target, signed(readerHab, "tels", { i: regid }), 1000);
    }
    try {
      assertThrows(
        () => new SourceTrust({ url: urlA.replace("https:", "http:"), caFile: certificate }),
        ValidationError,
      );
      assertEquals((yield* read(first.rip.said!)).status, 404);
      assertEquals(yield* service.pullOnce(observerHab, { timeoutMs: 1000 }), 2);
      const fresh = yield* read(first.rip.said!);
      assertEquals(fresh.status, 200);
      assertEquals(fresh.headers.get("Observer-Registry-Head"), first.update.said);
      assertEquals(fresh.headers.get("Observer-Observed-At"), new Date(now).toISOString());
      const beforeQueries = [requestsA, requestsB];
      assertEquals((yield* read(other.rip.said!)).status, 200);
      assertEquals([requestsA, requestsB], beforeQueries, "cache queries cannot cause a registrar pull");
      const old = records.observations.get([urlA])!;
      const revoked = makeBlindState({
        acdc: first.credential.said!,
        state: "revoked",
        sn: 2n,
        raw: b("fedcba9876543210"),
      });
      const successor = blindate(first.rip.said!, first.update.said!, revoked.d.nonce, { sn: 2 });
      a.interact({ data: [{ s: successor.sad!.n, d: successor.said! }] });
      const complete = concatBytes(
        kel(a),
        framed(first.rip),
        framed(first.update, first.opening),
        framed(successor, revoked),
      );
      overrideA = concatBytes(first.raw, framed(successor, revoked));
      now += 10;
      assertEquals(
        yield* service.pullOnce(observerHab, { timeoutMs: 1000 }),
        1,
        "A pending does not block completed source B",
      );
      assertEquals(records.observations.get([urlA]), old);
      assertEquals((yield* read(first.rip.said!)).status, 503, "pending successor blocks an older accepted prefix");
      assertEquals((yield* read(other.rip.said!)).status, 200);
      for (const hby of [issuer, host, observed, reader]) {
        yield* hby.ks.reopen();
        yield* hby.db.reopen();
      }
      yield* hosted.acdc!.baser.reopen();
      yield* cached.acdc!.baser.reopen();
      yield* records.reopen();
      assertEquals((yield* read(first.rip.said!)).status, 503);
      yield* cached.reactor.processBytes(concatBytes(...issuer.db.clonePreIter(a.pre)));
      yield* cached.protocol.processEscrowsOnce();
      assertEquals(service.pendingInScope([first.rip.said!]), false);
      assertEquals(cached.acdc!.store.head(first.rip.said!)?.qb64, successor.said);
      assertEquals((yield* read(first.rip.said!)).status, 503, "ordinary acceptance alone cannot renew an observation");
      overrideA = first.raw;
      now += 10;
      yield* service.pullOnce(observerHab, { timeoutMs: 1000 });
      assertEquals(records.observations.get([urlA]), old, "old prefix cannot renew a newer local head");
      assertEquals((yield* read(first.rip.said!)).status, 503);
      overrideA = complete;
      now += 10;
      assertEquals(yield* service.pullOnce(observerHab, { timeoutMs: 1000 }), 2);
      assertEquals((yield* read(first.rip.said!)).headers.get("Observer-Registry-Head"), successor.said);
      bodyB = concatBytes(other.raw, complete);
      now += 10;
      yield* service.pullOnce(observerHab, { timeoutMs: 1000 });
      const membership = records.observations.get([urlB])!;
      assertEquals(Object.keys(membership.heads).sort(), [first.rip.said!, other.rip.said!].sort());
      bodyB = other.raw;
      now += 10;
      yield* service.pullOnce(observerHab, { timeoutMs: 1000 });
      assertEquals(records.observations.get([urlB]), membership, "omitted previous membership cannot renew");
      for (
        const config of [{ ...sources[0], caFile: wrongCertificate }, { ...sources[0], certName: "wrong.example" }]
      ) {
        yield* call(() =>
          assertRejects(
            () => run(() => sourceRequest(new SourceTrust(config), signed(observerHab, "tels/bulk", {}), 1000)),
            TransportError,
          )
        );
      }
      statusB = 302;
      redirectB = urlA;
      const aBeforeRedirect = requestsA;
      now += 10;
      yield* service.pullOnce(observerHab, { timeoutMs: 1000 });
      assertEquals(requestsA, aBeforeRedirect + 1, "redirect must not reach another source");
      assertEquals(records.observations.get([urlB]), membership);
      now += 1001;
      const beforeStale = [requestsA, requestsB];
      assertEquals((yield* read(first.rip.said!)).status, 503);
      assertEquals((yield* read(other.rip.said!)).status, 503);
      assertEquals([requestsA, requestsB], beforeStale);
      scheduledAfter = requestsA + 2;
      let timer: ReturnType<typeof setTimeout>;
      const observedTwice = new Promise<void>((resolve, reject) => {
        reached = resolve;
        timer = setTimeout(() => reject(new Error("scheduled source acquisition did not recur")), 3000);
      });
      const worker = yield* spawn(() => service.run(observerHab, { intervalMs: 20, timeoutMs: 1000 }));
      try {
        yield* call(() => observedTwice);
      } finally {
        clearTimeout(timer!);
        yield* worker.halt();
      }
      assert(requestsA >= scheduledAfter);
    } finally {
      yield* call(() => server.shutdown());
      yield* call(() => app.close());
      yield* call(() => serverA.shutdown());
      yield* call(() => serverB.shutdown());
      yield* records.close(true);
      yield* cached.close();
      yield* hosted.close();
      yield* reader.close(true);
      yield* observed.close(true);
      yield* host.close(true);
      yield* issuer.close(true);
    }
  });
});
