/** Foreign publication/query uses real signatures, HTTP hosting and ordinary native intake. */
import { createTufaApp } from "@keri-ts/hosting";
import {
  b,
  BlindState,
  concatBytes,
  Counter,
  Diger,
  makeBlindState,
  parseBytes,
  SerderACDC,
  t,
  Vrsn_2_0,
} from "cesr-ts";
import { call, run } from "effection";
import { assert, assertEquals } from "jsr:@std/assert";
import {
  acdcmap,
  blindate,
  buildCesrRequest,
  buildCesrStreamRequest,
  createAgentRuntime,
  createHabery,
  FetchHttpClient,
  type Hab,
  query,
  regcept,
  systemClock,
} from "keri-ts/runtime";
import { Registrar } from "../mod.ts";

/** Preserve original event bytes and deliberately public expanded opening attachments. */
function framed(event: SerderACDC, opening?: ReturnType<typeof makeBlindState>): Uint8Array {
  const proof = opening
    ? Counter.enclose({ code: "BlindedStateQuadruples", version: Vrsn_2_0, qb64: BlindState.qb64b(opening) })
    : new Uint8Array();
  return concatBytes(event.raw, Counter.enclose({ code: "AttachmentGroup", version: Vrsn_2_0, qb64: proof }));
}
/** Every request is freshly signed immediately before ordinary transport. */
function signed(hab: Hab, route: string, q: Record<string, unknown>): Uint8Array {
  return hab.endorse(query(route, q, { pre: hab.pre, version: Vrsn_2_0 }), { gvrsn: Vrsn_2_0 });
}

Deno.test("registrar serves foreign published public history only after shared acceptance", async () => {
  await run(function*() {
    const issuer = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const host = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const reader = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const publisher = issuer.makeHab("publisher"), observer = reader.makeHab("observer");
    host.makeHab("registrar");
    const hosted = yield* createAgentRuntime(host, new FetchHttpClient(), systemClock, {
      kram: { enabled: true, denials: [], caches: { "~": [1000, 5000, 60000, 300000, 5000, 60000, 300000] } },
    });
    const independent = yield* createAgentRuntime(reader, new FetchHttpClient(), systemClock);
    const registrar = new Registrar(hosted.protocol, hosted.acdc!.store, {
      publishers: [publisher.pre],
      observers: [observer.pre],
      fullEvidence: true,
    });
    const app = createTufaApp({ protocolHandler: registrar.handle });
    const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, app.fetch);
    const url = `http://127.0.0.1:${server.addr.port}`;
    try {
      // Public role-key bootstrap uses the same ordinary protocol ingress, no accepted-row seeding.
      for (const owner of [issuer, reader]) {
        for (const hab of owner.habs.values()) {
          for (const wire of owner.db.clonePreIter(hab.pre)) yield* hosted.reactor.processBytes(wire);
        }
      }
      const rip = regcept(publisher.pre);
      const credential = acdcmap(publisher.pre, { regid: rip.said!, attribute: { d: "", name: "public" } });
      const opening = makeBlindState({ acdc: credential.said!, state: "issued", sn: 1n, raw: b("0123456789abcdef") });
      const update = blindate(rip.said!, rip.said!, opening.d.nonce);
      publisher.interact({ data: [{ s: rip.sad!.n, d: rip.said! }, { s: update.sad!.n, d: update.said! }] });
      const stream = t(concatBytes(framed(rip), framed(update, opening)));
      const denied = yield* call(() =>
        fetch(`${url}/ingest`, {
          method: "POST",
          ...buildCesrStreamRequest(signed(observer, "tels/publish", { stream })),
        })
      );
      assertEquals(denied.status, 403);
      yield* call(() => denied.text());
      const pending = yield* call(() =>
        fetch(`${url}/ingest`, {
          method: "POST",
          ...buildCesrStreamRequest(signed(publisher, "tels/publish", { stream })),
        })
      );
      assertEquals(pending.status, 202);
      const staged = yield* call(() => pending.json());
      assertEquals(staged.pending[rip.said!], 2);
      assertEquals(hosted.acdc!.store.head(rip.said!), null);
      // Reopen the actual stores, then deliver only the missing real KEL anchor.
      yield* host.ks.reopen();
      yield* host.db.reopen();
      yield* hosted.acdc!.baser.reopen();
      const kel = t(concatBytes(...issuer.db.clonePreIter(publisher.pre)));
      const complete = yield* call(() =>
        fetch(`${url}/ingest`, {
          method: "POST",
          ...buildCesrStreamRequest(signed(publisher, "tels/publish", { stream: kel })),
        })
      );
      assertEquals(complete.status, 200);
      yield* call(() => complete.json());
      assertEquals(hosted.acdc!.store.head(rip.said!)?.qb64, update.said);
      assertEquals(host.habs.has(publisher.pre), false, "hosting never creates a foreign controlling habitat");
      const oldOpening = hosted.acdc!.store.opening(update.said!);
      const rival = makeBlindState({ acdc: credential.said!, state: "revoked", sn: 2n, raw: b("fedcba9876543210") });
      const refused = yield* call(() =>
        fetch(`${url}/ingest`, {
          method: "POST",
          ...buildCesrStreamRequest(signed(publisher, "tels/publish", { stream: t(framed(update, rival)) })),
        })
      );
      assertEquals(refused.status, 422, "accepted body presence cannot hide refusal of its supplied opening");
      yield* call(() => refused.json());
      assertEquals(hosted.acdc!.store.head(rip.said!)?.qb64, update.said);
      assertEquals(hosted.acdc!.store.opening(update.said!), oldOpening);
      const response = yield* call(() =>
        fetch(`${url}/`, { method: "POST", ...buildCesrRequest(signed(observer, "tels/bulk", { i: rip.said! })) })
      );
      assertEquals(response.status, 200);
      assertEquals(response.headers.get("content-type"), "application/cesr");
      const evidence = new Uint8Array(yield* call(() => response.arrayBuffer()));
      yield* independent.reactor.processBytes(evidence);
      assertEquals(
        independent.acdc!.store.head(rip.said!)?.qb64,
        update.said,
        "requested registry resolves to its exact accepted head",
      );
      assertEquals(independent.acdc!.store.event(update.said!)!.raw, hosted.acdc!.store.event(update.said!)!.raw);
      assert(independent.acdc!.store.opening(update.said!), "the deliberately public opening survives ordinary intake");
      const wrong = new Diger({ raw: crypto.getRandomValues(new Uint8Array(32)), code: "E" }).qb64;
      const unknown = yield* call(() =>
        fetch(`${url}/`, { method: "POST", ...buildCesrStreamRequest(signed(observer, "tels/bulk", { i: wrong })) })
      );
      assertEquals(unknown.status, 404);
      yield* call(() => unknown.text());
      assertEquals(independent.acdc!.store.head(wrong), null);
      const wallet = yield* call(() =>
        fetch(`${url}/`, { method: "POST", ...buildCesrStreamRequest(signed(observer, "tels", { i: rip.said! })) })
      );
      assertEquals(wallet.status, 403);
      yield* call(() => wallet.text());
      const raw = signed(observer, "tels/bulk", { i: rip.said! });
      const trailing = yield* call(() =>
        fetch(`${url}/`, { method: "POST", ...buildCesrStreamRequest(concatBytes(raw, raw)) })
      );
      assertEquals(trailing.status, 400);
      yield* call(() => trailing.text());
      const media = yield* call(() =>
        fetch(`${url}/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      );
      assertEquals(media.status, 406);
      yield* call(() => media.text());
      const unsigned = query("tels/bulk", { i: rip.said! }, { pre: observer.pre, version: Vrsn_2_0 });
      const noProof = yield* call(() =>
        fetch(`${url}/`, {
          method: "POST",
          ...buildCesrStreamRequest(
            concatBytes(
              unsigned.raw,
              Counter.enclose({ code: "AttachmentGroup", version: Vrsn_2_0, qb64: new Uint8Array() }),
            ),
          ),
        })
      );
      assertEquals(noProof.status, 401);
      yield* call(() => noProof.text());
    } finally {
      yield* call(() => server.shutdown());
      yield* call(() => app.close());
      yield* independent.close();
      yield* hosted.close();
      yield* reader.close(true);
      yield* host.close(true);
      yield* issuer.close(true);
    }
  });
});
