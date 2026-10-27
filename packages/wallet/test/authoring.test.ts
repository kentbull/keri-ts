/** Authoring uses three independent witnesses and the normal receipt endpoints, not accepted-row insertion. */
import { call, run } from "effection";
import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert";
import {
  acdcmap,
  createAgentRuntime,
  createHabery,
  FetchHttpClient,
  NativeRegery,
  Receiptor,
  Roles,
  Schemes,
  systemClock,
  ValidationError,
} from "keri-ts/runtime";
import { createProtocolHandler } from "../../hosting/mod.ts";
import { createWalletBaser, Wallet, WalletAuthor } from "../mod.ts";
import { RegistryCustody } from "../src/custody.ts";

Deno.test("native author retries exact pending seals, requires witness quorum and retains public/derived issuance across reopen", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: crypto.randomUUID(),
      temp: true,
      skipConfig: true,
      bran: "MyPasscodeARealSecret",
    });
    const peers = [];
    for (let i = 0; i < 3; i++) {
      peers.push(yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true }));
    }
    const witnesses = peers.map((peer) => peer.makeHab("witness", undefined, { transferable: false }));
    const issuer = hby.makeHab("issuer", undefined, { wits: witnesses.map((wit) => wit.pre), toad: 2 });
    const http = new FetchHttpClient(), runtime = yield* createAgentRuntime(hby, http, systemClock);
    const observers = [];
    for (const peer of peers) observers.push(yield* createAgentRuntime(peer, http, systemClock));
    const handlers = observers.map((observer, i) =>
      createProtocolHandler(observer, {
        hostedPrefixes: [witnesses[i].pre],
        serviceHab: witnesses[i],
        witnessHab: witnesses[i],
      })
    );
    let receiptLimit = 3;
    const servers = handlers.map((handler, i) =>
      Deno.serve(
        { hostname: "127.0.0.1", port: 0, onListen() {} },
        (request) =>
          i >= receiptLimit && new URL(request.url).pathname === "/receipts"
            ? new Response("withheld", { status: 403 })
            : handler(request),
      )
    );
    const db = yield* createWalletBaser({ name: crypto.randomUUID(), temp: true });
    let rgy = runtime.acdc!;
    const wallet = new Wallet({ hby, registry: rgy.store, exc: runtime.exc, db });
    const receiptor = new Receiptor(hby, runtime.protocol, http, systemClock);
    let author = new WalletAuthor(wallet, rgy, receiptor);
    try {
      for (const [i, witness] of witnesses.entries()) {
        for (const wire of peers[i].db.clonePreIter(witness.pre)) yield* runtime.reactor.processBytes(wire);
        yield* runtime.reactor.processBytes(
          witness.makeLocScheme(`http://127.0.0.1:${servers[i].addr.port}/`, witness.pre, Schemes.http),
        );
        yield* runtime.reactor.processBytes(witness.makeEndRole(witness.pre, Roles.controller, true));
      }
      yield* receiptor.receipt(issuer.pre, { sn: 0 });
      receiptLimit = 1;
      yield* call(() => assertRejects(() => run(() => author.incept("native", issuer.pre))));
      const sealing = issuer.kever!.serder;
      assertEquals([rgy.registryByName("native")!.sn, hby.db.fullyWitnessed(sealing)], [-1n, false]);
      receiptLimit = 2;
      // Receipt collection still propagates the third endpoint refusal, but two genuine signatures establish quorum.
      yield* call(() => assertRejects(() => run(() => author.incept("native", issuer.pre))));
      assertEquals(hby.db.wigs.get([issuer.pre, sealing.said!]).map((signature) => signature.index).sort(), [0, 1]);
      assertEquals(hby.db.fullyWitnessed(sealing), true);
      const rip = yield* author.incept("native", issuer.pre);
      assertEquals(issuer.kever!.serder.said, sealing.said, "retry collects receipts for the same signed KEL event");
      receiptLimit = 3;
      yield* receiptor.receipt(issuer.pre, { sn: sealing.sn! }); // Catch up the third witness before later KEL events.
      const reg = author.registry("native", issuer.pre);
      const acdc = acdcmap(issuer.pre, { regid: rip.said, issuee: issuer.pre, attribute: { role: "holder" } });
      const original = yield* author.issue(reg, acdc, { public: true });
      assertEquals(reg.sn, 1n);
      assertEquals(reg.store.publicOpening(original.update)!.td.nonce, acdc.said);
      const sn = issuer.kever!.sn;
      yield* author.issue(reg, acdc, { public: true });
      assertEquals(issuer.kever!.sn, sn);
      receiptLimit = 1;
      yield* call(() => assertRejects(() => run(() => author.revoke(reg, acdc.said!, { public: true }))));
      const pendingSeal = issuer.kever!.said;
      assertEquals(reg.sn, 1n);
      assertThrows(() => author.stage(reg, acdc, "different", { public: true }), ValidationError, "different pending");
      yield* rgy.baser.close(false);
      yield* rgy.baser.reopen({ reuse: true });
      yield* db.close(false);
      yield* db.reopen({ reuse: true });
      rgy = new NativeRegery(hby, rgy.baser);
      author = new WalletAuthor(wallet, rgy, receiptor);
      receiptLimit = 3;
      const revoked = yield* author.revoke(author.registry("native", issuer.pre), acdc.said!, { public: true });
      assertEquals([revoked.sad!.n, issuer.kever!.said], ["2", pendingSeal]);
      assertEquals(
        wallet.db.issued.get([acdc.said!])!.update,
        original.update,
        "revocation does not rewrite historical issuance",
      );
      const custody = new RegistryCustody({ hby, registry: rgy.store, db });
      custody.createCustody(rip.said!, issuer.pre);
      author = new WalletAuthor(wallet, rgy, receiptor, custody);
      const boundEvent = issuer.kever!.said;
      const staged = author.stage(author.registry("native", issuer.pre), acdc, "renewed", { boundEvent });
      assertEquals(rgy.store.seqEvent(rip.said!, 3), null);
      assertEquals(rgy.store.opening(staged.event.said!), null, "derived openings are not automatically public");
      yield* db.close(false);
      yield* db.reopen({ reuse: true });
      const retry = author.stage(author.registry("native", issuer.pre), acdc, "renewed", { boundEvent });
      assertEquals(retry.event.said, staged.event.said);
      yield* author.anchor(author.registry("native", issuer.pre), staged.event);
      const recovered = custody.derivedOpening(staged.event);
      assertEquals(recovered.d.nonce, staged.opening.d.nonce);
      assertEquals("bd" in recovered ? recovered.bd.nonce : null, boundEvent);
      author = new WalletAuthor(wallet, rgy, receiptor);
      const successor = yield* author.update(author.registry("native", issuer.pre), acdc, "renewed", {
        public: true,
      });
      assertEquals(rgy.store.publicOpening(successor.said!)!.ts.label, "renewed");
      assertEquals(custody.derivedOpening(staged.event).d.nonce, staged.opening.d.nonce);
      assertEquals([...rgy.store.cloneTelIter(rip.said!)].length, 5);
    } finally {
      yield* db.close(true);
      for (const server of servers) yield* call(() => server.shutdown());
      for (const handler of handlers) handler.close?.();
      yield* runtime.close();
      for (const observer of observers) yield* observer.close();
      yield* hby.close(true);
      for (const peer of peers) yield* peer.close(true);
    }
  });
});
