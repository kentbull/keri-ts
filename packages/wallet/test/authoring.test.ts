/** Authoring uses three independent witnesses and the normal receipt endpoints, not accepted-row insertion. */
import { BlindState, parseBytes } from "cesr-ts";
import { call, run } from "effection";
import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert";
import { createHabery } from "keri-ts/db/lmdb";
import {
  acdcmap,
  AcdcV2Regery,
  blindate,
  createAgentRuntime,
  envelopeFromFrame,
  FetchHttpClient,
  Receiptor,
  Roles,
  Schemes,
  systemClock,
  ValidationError,
} from "keri-ts/runtime";
import { createProtocolHandler } from "../../hosting/mod.ts";
import { createWalletBaser, Wallet, WalletAuthor } from "../mod.ts";
import { RegistryCustody } from "../src/custody.ts";
import { WalletDiscloser } from "../src/disclosing.ts";

Deno.test("ACDC v2 author retries exact pending seals, requires witness quorum and retains public/derived issuance across reopen", async () => {
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
    const auths = Object.fromEntries(
      witnesses.map(witness => [witness.pre, "12345678#2026-11-05T12:00:00.000000+00:00"]),
    );
    const receivedAuths = new Set<string>();
    let requireAuth = false;
    let receiptLimit = 3;
    const servers = handlers.map((handler, i) =>
      Deno.serve(
        { hostname: "127.0.0.1", port: 0, onListen() {} },
        (request) => {
          if (new URL(request.url).pathname === "/receipts") {
            const authorization = request.headers.get("Authorization");
            if (requireAuth && authorization !== auths[witnesses[i].pre]) {
              return new Response("witness code required", { status: 401 });
            }
            if (authorization) receivedAuths.add(witnesses[i].pre);
            if (i >= receiptLimit) return new Response("withheld", { status: 403 });
          }
          return handler(request);
        },
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
      requireAuth = true;
      receiptLimit = 1;
      yield* call(() => assertRejects(() => run(() => author.incept("v2", issuer.pre, auths))));
      const sealing = issuer.kever!.serder;
      assertEquals([rgy.registryByName("v2")!.sn, hby.db.fullyWitnessed(sealing)], [-1n, false]);
      receiptLimit = 2;
      // Receipt collection still propagates the third endpoint refusal, but two genuine signatures establish quorum.
      yield* call(() => assertRejects(() => run(() => author.incept("v2", issuer.pre, auths))));
      assertEquals(hby.db.wigs.get([issuer.pre, sealing.said!]).map((signature) => signature.index).sort(), [0, 1]);
      assertEquals(hby.db.fullyWitnessed(sealing), true);
      const rip = yield* author.incept("v2", issuer.pre, auths);
      assertEquals(sealing.seals, [{ i: rip.said, s: "0", d: rip.said }]);
      assertEquals(issuer.kever!.serder.said, sealing.said, "retry collects receipts for the same signed KEL event");
      receiptLimit = 3;
      yield* receiptor.receipt(issuer.pre, { sn: sealing.sn!, auths }); // Catch up the third witness before later KEL events.
      const reg = author.registry("v2", issuer.pre);
      const acdc = acdcmap(issuer.pre, { regid: rip.said, issuee: issuer.pre, attribute: { role: "holder" } });
      receivedAuths.clear();
      yield* call(() => assertRejects(() => run(() => author.issue(reg, acdc, { public: true }))));
      const authPendingSeal = issuer.kever!.said;
      assertEquals(reg.sn, 0n, "missing witness authorization cannot accept issuance");
      const original = yield* author.issue(reg, acdc, { public: true, auths });
      assertEquals(issuer.kever!.said, authPendingSeal, "authorized retry retains the exact signed anchor");
      assertEquals(receivedAuths.size, 3, "all three real HTTP receipt requests carry operation auth");
      assertEquals(reg.sn, 1n);
      assertEquals(reg.store.publicOpening(original.update)!.td.nonce, acdc.said);
      const disclosure = new WalletDiscloser(wallet, receiptor);
      receivedAuths.clear();
      const grant = yield* disclosure.prepareGrant(issuer.pre, { said: acdc.said! }, {
        recipient: issuer.pre,
        message: "authenticated source anchor",
        anchor: true,
        auths,
      });
      assertEquals(receivedAuths.size, 3, "anchored disclosure forwards auth through the same real receipt endpoints");
      assertEquals(issuer.kever!.serder.seals, [{ d: grant.exn.said! }]);
      const sn = issuer.kever!.sn;
      yield* author.issue(reg, acdc, { public: true, auths });
      assertEquals(issuer.kever!.sn, sn);
      receiptLimit = 1;
      yield* call(() => assertRejects(() => run(() => author.revoke(reg, acdc.said!, { public: true, auths }))));
      const pendingSeal = issuer.kever!.said;
      assertEquals(reg.sn, 1n);
      assertThrows(
        () => author.stage(reg, acdc, "different", { public: true }),
        ValidationError,
        "different pending",
      );
      yield* rgy.baser.close(false);
      yield* rgy.baser.reopen({ reuse: true });
      yield* db.close(false);
      yield* db.reopen({ reuse: true });
      rgy = new AcdcV2Regery(hby, rgy.baser);
      author = new WalletAuthor(wallet, rgy, receiptor);
      receiptLimit = 3;
      const revoked = yield* author.revoke(author.registry("v2", issuer.pre), acdc.said!, { public: true, auths });
      assertEquals([revoked.sad!.n, issuer.kever!.said], ["2", pendingSeal]);
      const revokedSeal = issuer.kever!.said;
      assertEquals(
        (yield* author.revoke(author.registry("v2", issuer.pre), acdc.said!, { public: true, auths })).said,
        revoked.said,
      );
      assertEquals(issuer.kever!.said, revokedSeal, "accepted revocation retry must not create another anchor");
      assertEquals(
        wallet.db.issued.get([acdc.said!])!.update,
        original.update,
        "revocation does not rewrite historical issuance",
      );
      const custody = new RegistryCustody({ hby, hab: issuer, registry: wallet.registry, db });
      custody.createCustody(rip.said!);
      // A different local habitat cannot borrow the issuer's private authoring or disclosure scope.
      const other = hby.makeHab("other");
      const otherCustody = new RegistryCustody({ hby, hab: other, registry: wallet.registry, db });
      assertThrows(
        () =>
          new WalletAuthor(wallet, rgy, receiptor, otherCustody).stage(
            author.registry("v2", issuer.pre),
            acdc,
            "renewed",
          ),
        ValidationError,
        "registry habitat's custody",
      );
      const wrongDiscloser = new WalletDiscloser(wallet, receiptor, custody);
      yield* call(() =>
        assertRejects(
          () =>
            run(() =>
              wrongDiscloser.prepareGrantBody(other.pre, { said: acdc.said!, derive: true }, {
                recipient: issuer.pre,
                message: "",
              })
            ),
          ValidationError,
          "actual sender habitat's custody",
        )
      );
      author = new WalletAuthor(wallet, rgy, receiptor, custody);
      const boundEvent = issuer.kever!.said;
      const staged = author.stage(author.registry("v2", issuer.pre), acdc, "renewed", { boundEvent });
      assertEquals(rgy.store.seqEvent(rip.said!, 3), null);
      assertEquals(rgy.store.opening(staged.event.said!), null, "derived openings are not automatically public");
      yield* db.close(false);
      yield* db.reopen({ reuse: true });
      const retry = author.stage(author.registry("v2", issuer.pre), acdc, "renewed", { boundEvent });
      assertEquals(retry.event.said, staged.event.said);
      yield* author.anchor(author.registry("v2", issuer.pre), staged.event, auths);
      const recovered = custody.derivedOpening(staged.event);
      assertEquals(recovered.d.nonce, staged.opening.d.nonce);
      assertEquals("bd" in recovered ? recovered.bd.nonce : null, boundEvent);
      author = new WalletAuthor(wallet, rgy, receiptor);
      const successor = yield* author.update(author.registry("v2", issuer.pre), acdc, "renewed", {
        public: true,
        auths,
      });
      assertEquals(rgy.store.publicOpening(successor.said!)!.ts.label, "renewed");
      assertEquals(custody.derivedOpening(staged.event).d.nonce, staged.opening.d.nonce);
      assertEquals([...rgy.store.cloneTelIter(rip.said!)].length, 5);
      const reissued = yield* author.update(author.registry("v2", issuer.pre), acdc, "issued", {
        public: true,
        auths,
      });
      const advance = author.stage(author.registry("v2", issuer.pre), acdc, "issued", { public: true });
      assertEquals(advance.event.sad!.n, (BigInt(`0x${reissued.sad!.n}`) + 1n).toString(16));
      assertEquals(
        advance.event.said === reissued.said,
        false,
        "explicit same-state update creates a fresh BUP/opening",
      );
      assertEquals(advance.opening.d.nonce === reissued.sad!.b, false, "an explicit advance has a fresh opening");
      // Even a fully witnessed abbreviated seal cannot satisfy a v2 author retry.
      issuer.interact({ data: [{ s: advance.event.sad!.n, d: advance.event.said! }] });
      const abbreviated = issuer.kever!.serder;
      yield* receiptor.receipt(issuer.pre, { sn: abbreviated.sn!, auths });
      receiptLimit = 1;
      yield* call(() =>
        assertRejects(() =>
          run(() => author.update(author.registry("v2", issuer.pre), acdc, "issued", { public: true, auths }))
        )
      );
      const pendingAdvanceSeal = issuer.kever!.said;
      assertEquals(pendingAdvanceSeal === abbreviated.said, false, "authoring must create the full registry seal");
      assertEquals(rgy.store.head(rip.said!)?.qb64, reissued.said, "one receipt cannot accept the pending successor");
      yield* rgy.baser.close(false);
      yield* rgy.baser.reopen({ reuse: true });
      yield* db.close(false);
      yield* db.reopen({ reuse: true });
      rgy = new AcdcV2Regery(hby, rgy.baser);
      author = new WalletAuthor(wallet, rgy, receiptor);
      receiptLimit = 3;
      const resumed = yield* author.update(author.registry("v2", issuer.pre), acdc, "issued", {
        public: true,
        auths,
      });
      assertEquals(resumed.raw, advance.event.raw, "retry reuses the exact pending next event");
      assertEquals(issuer.kever!.said, pendingAdvanceSeal, "retry gathers receipts for the same pending anchor");
      assertEquals(issuer.kever!.serder.seals, [{ i: rip.said, s: resumed.sad!.n, d: resumed.said }]);
      assertEquals(wallet.db.issued.get([acdc.said!])!.update, original.update);

      // Public acceptance alone cannot recover missing private derivation coordinates.
      const current = author.registry("v2", issuer.pre);
      const ordinal = current.sn + 1n;
      const opening = custody.derive(rip.said!, ordinal, acdc.said!, "issued");
      const update = blindate(rip.said!, resumed.said!, opening.d.nonce, { sn: ordinal });
      current.processEvent(update);
      yield* author.anchor(current, update, auths);
      const discloser = new WalletDiscloser(
        wallet,
        receiptor,
        new RegistryCustody({ hby, hab: issuer, registry: wallet.registry, db }),
      );
      assertThrows(
        () => discloser.registryProof(acdc, rip.said!, [], { derive: true }),
        ValidationError,
        "Exact derived update coordinates are unavailable",
      );
      custody.retainDerivedUpdate(update, opening);
      const disclosed = envelopeFromFrame(
        parseBytes(discloser.registryProof(acdc, rip.said!, [], { derive: true }))[0],
      );
      assertEquals(BlindState.qb64(disclosed.bsqs[0]), BlindState.qb64(opening as BlindState));
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
