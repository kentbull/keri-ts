/** Real signed public ingress exercises inventory independently of protocol acceptance. */
import {
  b,
  bytesEqual,
  type CesrFrame,
  collectPayload,
  Compactor,
  concatBytes,
  Counter,
  Diger,
  framePayload,
  Kinds,
  makeBlindState,
  type MapperMap,
  NumberPrimitive,
  parseBytes,
  Prefixer,
  SerderACDC,
  SerderKERI,
  Vrsn_1_0,
  Vrsn_2_0,
} from "cesr-ts";
import { call, type Operation, run } from "effection";
import { assert, assertEquals, assertRejects, assertThrows } from "jsr:@std/assert";
import { loadNests, openRegistry, RegistryStore } from "keri-ts/db";
import {
  acdcmap,
  blindate,
  type ChainVerdict,
  createAgentRuntime,
  createHabery,
  evaluateChain,
  Exchanger,
  FetchHttpClient,
  type Hab,
  type Habery,
  Receiptor,
  regcept,
  RegistryObserver,
  systemClock,
  ValidationError,
  walkIpexGraph,
} from "keri-ts/runtime";
import { ipexExnBody } from "../../keri/src/app/ipex/ipex-building.ts";
import { loadIpexHandlers } from "../../keri/src/app/ipex/ipexing.ts";
import { dispatchEnvelope, envelopeFromFrame } from "../../keri/src/app/protocol/parsering.ts";
import { TransIdxSigGroup } from "../../keri/src/core/dispatch.ts";
import { messageAttachmentGroups } from "../../keri/src/core/protocol-serialization.ts";
import { graphDisclosures } from "../../keri/test/integration/app/ipex/disclosures.ts";
import { createWalletBaser, Wallet } from "../mod.ts";
import { anchorExchange, WalletDiscloser } from "../src/disclosing.ts";

/** Sign each exact node/EXN with its owning real habitat. */
function signed(body: SerderACDC | SerderKERI, hab: Hab, nests?: CesrFrame[]): CesrFrame {
  const tsgs = [
    new TransIdxSigGroup(
      new Prefixer({ qb64: hab.pre }),
      NumberPrimitive.fromNum(BigInt(hab.kever!.lastEst.s)),
      new Diger({ qb64: hab.kever!.lastEst.d }),
      hab.sign(body.raw, true),
    ),
  ];
  return { body, attachments: messageAttachmentGroups({ tsgs }, Vrsn_2_0), gvrsn: Vrsn_2_0, nests };
}
/** Decode wire, then use the ordinary KEL/EXN processor rather than accepted-row insertion. */
function* ingest(frame: CesrFrame | Uint8Array, hby: Habery, exc: Exchanger): Operation<void> {
  const wire = frame instanceof Uint8Array ? frame : yield* call(() => collectPayload(framePayload(frame)));
  for (const parsed of parseBytes(wire)) yield* dispatchEnvelope(envelopeFromFrame(parsed), hby.rvy, hby.kevery, exc);
}
/** Two independent identities, normal retained exchanges, public registry evidence and owned inventory. */
async function withPeers(
  work: (p: {
    issuer: Hab;
    holder: Hab;
    source: Habery;
    receiver: Habery;
    sending: Exchanger;
    receiving: Exchanger;
    wallet: Wallet;
    registry: RegistryStore;
  }) => Operation<void>,
): Promise<void> {
  await run(function*() {
    const source = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const receiver = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const baser = yield* openRegistry({ name: crypto.randomUUID(), temp: true });
    const db = yield* createWalletBaser({ name: crypto.randomUUID(), temp: true });
    const registry = new RegistryStore(baser), issuer = source.makeHab("issuer"), holder = receiver.makeHab("holder");
    const sending = new Exchanger(source), receiving = new Exchanger(receiver);
    loadIpexHandlers(source, sending, { registry });
    loadIpexHandlers(receiver, receiving, { registry });
    const wallet = new Wallet({ hby: receiver, registry, exc: receiving, db });
    try {
      for (const wire of source.db.clonePreIter(issuer.pre, 0)) yield* ingest(wire, receiver, receiving);
      for (const wire of receiver.db.clonePreIter(holder.pre, 0)) yield* ingest(wire, source, sending);
      yield* work({ issuer, holder, source, receiver, sending, receiving, wallet, registry });
    } finally {
      yield* db.close(true);
      yield* baser.close(true);
      yield* receiver.close(true);
      yield* source.close(true);
    }
  });
}
/** Deliver an independently authenticated Grant before any holder response is signed. */
function* grant(
  p: Parameters<Parameters<typeof withPeers>[0]>[0],
  nodes: SerderACDC[],
  message: string,
  accepted = true,
): Operation<SerderKERI> {
  const grant = ipexExnBody(p.issuer.pre, "/ipex/grant", nodes, {
    message,
    recipient: p.holder.pre,

    plan: nodes.map((node, i) => [(node.schema as { $id: string }).$id, i ? "/e/proof/_/" : "/", []]),
  });
  const frame = signed(grant, p.issuer, nodes.map((node) => signed(node, p.issuer)));
  yield* ingest(frame, p.source, p.sending);
  yield* ingest(frame, p.receiver, p.receiving);
  assertEquals(p.receiving.complete(grant.said!), accepted);
  return grant;
}
Deno.test("wallet keeps distinct partial/full consent and exact retained proofs across all-owner reopen", async () => {
  await withPeers(function*(p) {
    const nonce = () => new Diger({ raw: crypto.getRandomValues(new Uint8Array(32)), code: "E" }).qb64;
    const full = acdcmap(p.issuer.pre, {
      uuid: nonce(),
      issuee: p.holder.pre,
      attribute: {
        d: "",
        u: nonce(),
        status: { d: "", u: nonce(), value: "authorized" },
        private: { d: "", u: nonce(), value: "hidden-first" },
      },
    });
    const compactor = new Compactor({ mad: structuredClone(full.attrib) as MapperMap, kind: Kinds.json, makify: true });
    compactor.compact(["a/status/"], "a");
    const partial = acdcmap(p.issuer.pre, {
      uuid: full.sad!.u as string,
      schema: full.schema as MapperMap,
      attribute: compactor.partials!["a/status/"].mad,
    });
    assertEquals(partial.said, full.said);
    const pairs: [SerderKERI, SerderKERI][] = [];
    for (const [i, node] of [partial, full].entries()) {
      const g = yield* grant(p, [node], `view-${i}`);
      const sign = p.holder.sign;
      let signatures = 0;
      p.holder.sign = function(this: Hab, ...args: Parameters<typeof sign>) {
        signatures++;
        return sign.apply(this, args);
      } as typeof sign;
      yield* call(() =>
        assertRejects(() => run(() => p.wallet.prepareAdmit(g.said!, p.holder.pre)), ValidationError, "consent")
      );
      yield* call(() =>
        assertRejects(
          () => run(() => p.wallet.prepareAdmit(g.said!, p.holder.pre, { consent: true, gvrsn: Vrsn_1_0 })),
          ValidationError,
          "genus",
        )
      );
      assertEquals(signatures, 0);
      const prepared = yield* p.wallet.prepareAdmit(g.said!, p.holder.pre, { consent: true });
      assertEquals(signatures, 1);
      p.holder.sign = sign;
      const a = prepared.admit;
      assertEquals(p.wallet.inventory().held.length, i, "preparing a signature does not record consent");
      assertEquals(p.receiving.complete(a.said!), false);
      yield* call(() =>
        assertRejects(() => p.wallet.recordAdmission(g.said!, a.said!, { consent: true }), ValidationError, "Accepted")
      );
      yield* ingest(prepared.wire, p.receiver, p.receiving);
      yield* ingest(prepared.wire, p.source, p.sending);
      assert(p.receiving.complete(a.said!));
      pairs.push([g, a]);
      assertEquals(p.wallet.admissions(full.said!).length, i);
      yield* call(() => assertRejects(() => p.wallet.recordAdmission(g.said!, a.said!), ValidationError, "consent"));
      const record = yield* call(() => p.wallet.recordAdmission(g.said!, a.said!, { consent: true }));
      assertEquals(yield* call(() => p.wallet.recordAdmission(g.said!, a.said!, { consent: true })), record);
    }
    const earlier = yield* call(() => p.wallet.heldCredential(pairs[0][0].said!));
    assert(bytesEqual(earlier.credential.raw, partial.raw));
    assert(typeof (earlier.credential.attrib as MapperMap).private === "string");
    const originalProof = earlier.proof.slice(),
      originalTime = p.wallet.admissions(full.said!).find((row) => row.grant === pairs[0][0].said)!.admitted;
    p.issuer.rotate();
    for (const wire of p.source.db.clonePreIter(p.issuer.pre, 0)) yield* ingest(wire, p.receiver, p.receiving);
    assertEquals(
      p.receiving.verifyAccepted(pairs[0][0].said!, "/ipex/grant"),
      false,
      "current issuer authentication changes; retained consent is still history",
    );
    assertEquals(
      (yield* call(() => p.wallet.recordAdmission(pairs[0][0].said!, pairs[0][1].said!, { consent: true }))).admitted,
      originalTime,
    );
    yield* call(() =>
      assertRejects(
        () => p.wallet.recordAdmission(pairs[0][0].said!, pairs[1][1].said!, { consent: true }),
        ValidationError,
      )
    );
    for (const hby of [p.source, p.receiver]) {
      yield* hby.ks.reopen();
      yield* hby.db.reopen();
    }
    yield* p.registry.baser.reopen();
    yield* p.wallet.db.reopen();
    const held = yield* call(() => p.wallet.heldCredential(pairs[0][0].said!));
    assertEquals(held.proof, originalProof);
    assert(bytesEqual(held.credential.raw, partial.raw));
    assertEquals(p.wallet.admissions(full.said!).length, 2);
    assertEquals(p.wallet.admissions(full.said!).find((row) => row.grant === pairs[0][0].said)!.admitted, originalTime);
    assertEquals(p.wallet.inventory().held.length, 2);
  });
});

for (const operator of ["I2I", "UNKNOWN"]) {
  Deno.test(`wallet refuses ${operator === "I2I" ? "false" : "unsupported"} IPEX roots without signing or creating consent`, async () => {
    await withPeers(function*(p) {
      const far = acdcmap(p.issuer.pre, { issuee: p.holder.pre, attribute: { d: "", role: "authority" } });
      const near = acdcmap(p.issuer.pre, {
        attribute: { d: "", role: "near" },
        edge: { d: "", proof: { n: far.said!, o: operator } },
      });
      const g = yield* grant(p, [near, far], operator, false);
      assertEquals(p.receiving.verifyAccepted(g.said!, "/ipex/grant"), false);
      assertEquals(p.receiver.db.exns.get(g.said!), null);
      assertEquals(p.receiver.db.enst.get(g.said!), []);
      const graph = walkIpexGraph(near.said!, [signed(near, p.issuer), signed(far, p.issuer)], true);
      assert(graph && !("kind" in graph));
      assertEquals(
        evaluateChain(
          graph,
          new Map(graph.order.map((said) => [said, { kind: "valid" } as ChainVerdict])),
          p.receiver.db,
        )?.kind,
        operator === "I2I" ? "invalid" : "unknown",
      );
      const sign = p.holder.sign;
      let signatures = 0;
      p.holder.sign = function(this: Hab, ...args: Parameters<typeof sign>) {
        signatures++;
        return sign.apply(this, args);
      } as typeof sign;
      yield* call(() =>
        assertRejects(
          () => run(() => p.wallet.prepareAdmit(g.said!, p.holder.pre, { consent: true })),
          ValidationError,
          "Accepted",
        )
      );
      assertEquals(signatures, 0, "false/unknown roots cannot cause a holder signature");
      p.holder.sign = sign;
      const a = ipexExnBody(p.holder.pre, "/ipex/admit", [], { message: "protocol only", prior: g });
      yield* ingest(signed(a, p.holder), p.receiver, p.receiving);
      const runtime = yield* createAgentRuntime(p.receiver, new FetchHttpClient(), systemClock);
      const discloser = new WalletDiscloser(
        p.wallet,
        new Receiptor(p.receiver, runtime.protocol, runtime.http, runtime.clock),
      );
      signatures = 0;
      p.holder.sign = function(this: Hab, ...args: Parameters<typeof sign>) {
        signatures++;
        return sign.apply(this, args);
      } as typeof sign;
      try {
        yield* call(() =>
          assertRejects(
            () =>
              run(() =>
                discloser.prepareGrant(p.holder.pre, { fromGrant: g.said!, presenterAuthorized: true }, {
                  message: "refused use",
                  recipient: p.issuer.pre,

                  plan: [[(near.schema as MapperMap).$id as string, "/", []]],
                })
              ),
            ValidationError,
            "Accepted",
          )
        );
        assertEquals(signatures, 0, "false/unknown transferred roots cannot cause a presenter signature");
      } finally {
        p.holder.sign = sign;
        yield* runtime.close();
      }
      yield* call(() =>
        assertRejects(() => p.wallet.recordAdmission(g.said!, a.said!, { consent: true }), ValidationError, "Accepted")
      );
      assertEquals(p.wallet.inventory().held, []);
    });
  });
}

Deno.test("wallet issued history retains binary bytes and accepted issuance after a later revocation", async () => {
  await withPeers(function*(p) {
    const issuerWallet = new Wallet({ hby: p.source, registry: p.registry, exc: p.sending, db: p.wallet.db });
    const rip = regcept(p.issuer.pre);
    const credential = acdcmap(p.issuer.pre, {
      regid: rip.said!,
      kind: Kinds.cbor,
      attribute: { d: "", value: "binary" },
    });
    const proof = makeBlindState({ acdc: credential.said!, state: "issued", sn: 1n, raw: b("0123456789abcdef") });
    const issued = blindate(rip.said!, rip.said!, proof.d.nonce);
    const observer = new RegistryObserver(p.source.db, p.registry);
    p.issuer.interact({
      data: [{ i: rip.said!, s: rip.sad!.n, d: rip.said! }, { i: rip.said!, s: issued.sad!.n, d: issued.said! }],
    });
    assertEquals(observer.processEvent(rip).kind, "accept");
    assertEquals(observer.processEvent(issued).kind, "accept");
    assertThrows(() => issuerWallet.recordIssued(credential, issued.said!), ValidationError, "opening");
    const record = issuerWallet.recordIssued(credential, issued.said!, { blinder: proof });
    assert(bytesEqual(issuerWallet.issuedCredential(credential.said!).raw, credential.raw));
    const revokedProof = makeBlindState({
      acdc: credential.said!,
      state: "revoked",
      sn: 2n,
      raw: b("fedcba9876543210"),
    });
    const revoked = blindate(rip.said!, issued.said!, revokedProof.d.nonce, { sn: 2 });
    p.issuer.interact({ data: [{ i: rip.said!, s: revoked.sad!.n, d: revoked.said! }] });
    assertEquals(observer.processEvent(revoked).kind, "accept");
    yield* p.source.ks.reopen();
    yield* p.source.db.reopen();
    yield* p.registry.baser.reopen();
    yield* p.wallet.db.reopen();
    assertEquals(issuerWallet.recordIssued(credential, issued.said!), record);
    assert(bytesEqual(issuerWallet.issuedCredential(credential.said!).raw, credential.raw));
    assertEquals(issuerWallet.inventory().issued.length, 1);
    assertThrows(
      () => issuerWallet.recordIssued(credential, revoked.said!, { blinder: revokedProof }),
      ValidationError,
    );
  });
});

Deno.test("wallet negotiates source obligations, admits, and presents only its exact consented view", async () => {
  await withPeers(function*(p) {
    const sourceRuntime = yield* createAgentRuntime(p.source, new FetchHttpClient(), systemClock);
    const receiverRuntime = yield* createAgentRuntime(p.receiver, new FetchHttpClient(), systemClock);
    const sourceDb = yield* createWalletBaser({ name: crypto.randomUUID(), temp: true });
    try {
      const issuerWallet = new Wallet({ hby: p.source, registry: p.registry, exc: p.sending, db: sourceDb });
      const issuer = new WalletDiscloser(
        issuerWallet,
        new Receiptor(p.source, sourceRuntime.protocol, sourceRuntime.http, sourceRuntime.clock),
      );
      const holderReceipts = new Receiptor(
        p.receiver,
        receiverRuntime.protocol,
        receiverRuntime.http,
        receiverRuntime.clock,
      );
      const holder = new WalletDiscloser(p.wallet, holderReceipts);
      const observed = new RegistryObserver(p.source.db, p.registry), rip = regcept(p.issuer.pre);
      p.issuer.interact({ data: [{ i: rip.said!, s: "0", d: rip.said! }] });
      assertEquals(observed.processEvent(rip).kind, "accept");
      const full = graphDisclosures(p.source, p.issuer).fullNodes[0];
      const schema = structuredClone(full.schema) as MapperMap;
      schema.$id = "";
      (schema.properties as MapperMap).rd = { type: "string" };
      const credential = acdcmap(p.issuer.pre, {
        regid: rip.said!,
        schema,
        uuid: full.sad!.u as string,
        attribute: full.attrib as MapperMap,
      });
      const opening = makeBlindState({ acdc: credential.said!, state: "issued" });
      const update = blindate(rip.said!, rip.said!, opening.d.nonce);
      p.issuer.interact({ data: [{ i: rip.said!, s: "7", d: update.said! }] });
      const wrong = p.issuer.kever!.serder.said;
      yield* anchorExchange(issuerWallet, issuer.receiptor, p.issuer, update);
      assert(p.issuer.kever!.serder.said !== wrong, "a wrong-coordinate seal cannot prevent a correct new anchor");
      assertEquals(observed.processEvent(update).kind, "accept");
      p.registry.retainOpening(update, opening);
      issuerWallet.recordIssued(credential, update.said!, { blinder: opening });
      const deliver = function*(prepared: { wire: Uint8Array; support: Uint8Array }) {
        const wire = new Uint8Array([...prepared.support, ...prepared.wire]);
        yield* ingest(wire, p.source, p.sending);
        yield* ingest(wire, p.receiver, p.receiving);
      };
      const plan: [string, string, string[]][] = [[(credential.schema as MapperMap).$id as string, "/", ["a/status/"]]];
      const apply = yield* holder.prepareApply(p.holder.pre, {
        message: "status",
        recipient: p.issuer.pre,

        plan,
        anchor: true,
      });
      yield* deliver(apply);
      const offer = yield* issuer.prepareOffer(p.issuer.pre, { said: credential.said!, disclose: ["a/status/"] }, {
        message: "offer",
        priorSaid: apply.exn.said!,
        anchor: true,
      });
      yield* deliver(offer);
      const agree = yield* holder.prepareReply(p.holder.pre, "agree", offer.exn.said!);
      yield* deliver(agree);
      assert(p.sending.complete(agree.exn.said!));
      const grant = yield* issuer.prepareGrant(p.issuer.pre, { said: credential.said!, disclose: ["a/status/"] }, {
        message: "grant",
        priorSaid: agree.exn.said!,
        anchor: true,
      });
      yield* deliver(grant);
      assert(p.receiving.complete(grant.exn.said!));
      const admitted = yield* p.wallet.prepareAdmit(grant.exn.said!, p.holder.pre, {
        consent: true,
        receiptor: holderReceipts,
      });
      yield* deliver(admitted);
      assert(p.sending.complete(admitted.admit.said!));
      yield* call(() => p.wallet.recordAdmission(grant.exn.said!, admitted.admit.said!, { consent: true }));
      const before = yield* call(() => p.wallet.heldCredential(grant.exn.said!));
      assertEquals(typeof (before.credential.attrib as MapperMap).private, "string");
      assert(!new TextDecoder().decode(before.proof).includes("hidden-value"));
      const presented = yield* holder.prepareGrant(p.holder.pre, { fromGrant: grant.exn.said! }, {
        message: "exact view",
        recipient: p.issuer.pre,

        plan,
      });
      yield* deliver(presented);
      assert(p.sending.complete(presented.exn.said!));
      yield* call(() =>
        assertRejects(() => issuerWallet.heldCredential(grant.exn.said!), ValidationError, "presenter authorization")
      );
      const transferred = yield* call(() =>
        issuerWallet.heldCredential(grant.exn.said!, { presenterAuthorized: true })
      );
      assertEquals(transferred.proof, before.proof);
      assertEquals(issuerWallet.inventory().held, [], "presenter authorization creates no holder consent");
      yield* p.wallet.db.close();
      yield* p.wallet.db.reopen();
      const after = yield* call(() => p.wallet.heldCredential(grant.exn.said!));
      assertEquals(after.proof, before.proof);
      assertEquals(after.credential.raw, before.credential.raw);
      assertEquals(holder.unblind(opening, credential.said!, ["issued"])?.d.nonce, opening.d.nonce);
    } finally {
      yield* sourceDb.close(true);
      yield* receiverRuntime.close();
      yield* sourceRuntime.close();
    }
  });
});

Deno.test("wallet disclosure supplies root-first DI2I ancestry to an independent receiver across reopen", async () => {
  await withPeers(function*(p) {
    const runtime = yield* createAgentRuntime(p.source, new FetchHttpClient(), systemClock);
    const sourceDb = yield* createWalletBaser({ name: crypto.randomUUID(), temp: true });
    try {
      // Sign a credential graph whose issuer is two approved delegation hops below the far issuee.
      const authority = p.source.makeHab("authority");
      const middle = p.source.makeHab("middle", undefined, { delpre: authority.pre });
      const issuer = p.source.makeHab("delegated issuer", undefined, { delpre: middle.pre });
      authority.interact({ data: [{ i: middle.pre, s: "0", d: middle.pre }] });
      middle.interact({ data: [{ i: issuer.pre, s: "0", d: issuer.pre }] });
      const far = acdcmap(authority.pre, { attribute: { d: "", i: authority.pre, role: "authority" } });
      const near = acdcmap(issuer.pre, {
        attribute: { d: "", i: p.holder.pre, role: "delegated" },
        edge: { d: "", proof: { n: far.said, o: "DI2I" } },
      });
      const transferred = concatBytes(
        yield* call(() => collectPayload(framePayload(signed(near, issuer)))),
        yield* call(() => collectPayload(framePayload(signed(far, authority)))),
      );
      const wallet = new Wallet({ hby: p.source, registry: p.registry, exc: p.sending, db: sourceDb });
      const discloser = new WalletDiscloser(
        wallet,
        new Receiptor(p.source, runtime.protocol, runtime.http, runtime.clock),
      );
      // Fresh issuance freezes its new origin and authenticates every explicitly supplied far node.
      const rip = regcept(issuer.pre);
      issuer.interact({ data: [{ i: rip.said!, s: "0", d: rip.said! }] });
      assertEquals(new RegistryObserver(p.source.db, p.registry).processEvent(rip).kind, "accept");
      const fresh = acdcmap(issuer.pre, {
        regid: rip.said!,
        attribute: { d: "", i: p.holder.pre, role: "fresh delegated" },
        edge: { d: "", proof: { n: far.said!, o: "DI2I" } },
      });
      const plan = [fresh, far].map((node, index) =>
        [(node.schema as { $id: string }).$id, index ? "/e/proof/_/" : "/", []] as [string, string, string[]]
      );
      const farProof = yield* call(() => collectPayload(framePayload(signed(far, authority))));
      const before = wallet.inventory();
      const issuance = yield* discloser.prepareIssuanceGrantBody(issuer.pre, fresh, {
        message: "Fresh delegated issuance",
        recipient: p.holder.pre,
        plan,
        artifacts: [farProof],
      });
      assertEquals(parseBytes(issuance.raw).map(frame => frame.body.raw), [fresh.raw, far.raw]);
      assertEquals(wallet.inventory(), before);
      assertEquals(
        p.source.db.exns.get(issuance.exn.said!),
        null,
        "body preparation neither signs nor accepts the Grant",
      );
      const unsignedFar = yield* call(() =>
        collectPayload(framePayload({ body: far, gvrsn: Vrsn_2_0, attachments: [] }))
      );
      yield* call(() =>
        assertRejects(
          () =>
            run(() =>
              discloser.prepareIssuanceGrantBody(issuer.pre, fresh, {
                message: "Fresh delegated issuance",
                recipient: p.holder.pre,
                plan,
                artifacts: [unsignedFar],
              })
            ),
          ValidationError,
          "every far node requires authenticated issuer proof",
        )
      );
      const prepared = yield* discloser.prepareGrant(issuer.pre, { transferred, presenterAuthorized: true }, {
        message: "two-hop authority",
        recipient: p.holder.pre,
        plan: [near, far].map((node, index) => [
          (node.schema as { $id: string }).$id,
          index ? "/e/proof/_/" : "/",
          [],
        ]),
      });
      const hierarchy = [authority.pre, middle.pre, issuer.pre];
      for (const aid of hierarchy) {
        assertEquals(p.receiver.db.getKever(aid), null, "receiver has no delegation evidence");
      }
      const support = parseBytes(prepared.support).map(({ body }) => {
        assert(body instanceof SerderKERI);
        return body;
      });
      assertEquals([...new Set(support.map(body => body.pre))], [...hierarchy, p.holder.pre]);
      assertEquals(new Set(support.map(body => body.said)).size, support.length, "no duplicate accepted events");
      assertEquals(
        prepared.support,
        concatBytes(
          Counter.makeGVC(Vrsn_2_0),
          ...[...hierarchy, p.holder.pre].flatMap(aid => [...p.source.db.clonePreIter(aid, 0, Vrsn_2_0)]),
        ),
        "support preserves accepted event bodies, source seals and stored receipts exactly",
      );
      // The receiver learns the hierarchy only from the wallet's exported public support.
      yield* ingest(prepared.support, p.receiver, p.receiving);
      yield* ingest(prepared.wire, p.receiver, p.receiving);
      assertEquals(p.receiving.complete(prepared.exn.said!), true);
      assertEquals(p.receiving.verifyAccepted(prepared.exn.said!, "/ipex/grant"), true);
      const retained = loadNests(p.receiver.db, prepared.exn.said!).map(frame => frame.body.raw.slice());
      // Reopening must preserve verification and the accepted Grant's exact credential views.
      yield* p.receiver.ks.reopen();
      yield* p.receiver.db.reopen();
      p.receiver.db.kevers.clear();
      assertEquals(p.receiving.verifyAccepted(prepared.exn.said!, "/ipex/grant"), true);
      assertEquals(loadNests(p.receiver.db, prepared.exn.said!).map(frame => frame.body.raw), retained);
    } finally {
      yield* sourceDb.close(true);
      yield* runtime.close();
    }
  });
});

for (const proof of ["missing", "refused"] as const) {
  Deno.test(`wallet OR admits and presents exact views with an unused ${proof} issuer branch`, async () => {
    await withPeers(function*(p) {
      const outsider = p.source.makeHab("optional issuer");
      const good = acdcmap(p.issuer.pre, { attribute: { d: "", name: "good" } });
      const optional = acdcmap(outsider.pre, { attribute: { d: "", name: "optional" } });
      const near = acdcmap(p.issuer.pre, {
        attribute: { d: "", name: "root" },
        edge: {
          d: "",
          o: "OR",
          good: { n: good.said },
          optional: { n: optional.said },
        },
      });
      const nodes = [near, good, optional];
      const plan = nodes.map((body, i) =>
        [(body.schema as { $id: string }).$id, i === 0 ? "/" : i === 1 ? "/e/good/_/" : "/e/optional/_/", []] as const
      );
      const g = ipexExnBody(p.issuer.pre, "/ipex/grant", nodes, { message: proof, recipient: p.holder.pre, plan });
      const optionalFrame = proof === "missing"
        ? signed(optional, outsider)
        : { body: optional, attachments: [], gvrsn: Vrsn_2_0 };
      const frame = signed(g, p.issuer, [signed(near, p.issuer), signed(good, p.issuer), optionalFrame]);
      yield* ingest(frame, p.source, p.sending);
      yield* ingest(frame, p.receiver, p.receiving);
      assertEquals(p.receiving.complete(g.said!), true);
      const prepared = yield* p.wallet.prepareAdmit(g.said!, p.holder.pre, { consent: true });
      yield* ingest(prepared.wire, p.receiver, p.receiving);
      yield* call(() => p.wallet.recordAdmission(g.said!, prepared.admit.said!, { consent: true }));
      const before = (yield* call(() => p.wallet.heldCredential(g.said!))).artifacts;
      const runtime = yield* createAgentRuntime(p.receiver, new FetchHttpClient(), systemClock);
      const discloser = new WalletDiscloser(
        p.wallet,
        new Receiptor(p.receiver, runtime.protocol, runtime.http, runtime.clock),
      );
      const presentation = yield* discloser.prepareGrant(p.holder.pre, {
        fromGrant: g.said!,
        presenterAuthorized: true,
      }, { message: "present", recipient: p.issuer.pre, plan });
      assertEquals(parseBytes(presentation.wire)[0].nests!.map(node => node.body.said), nodes.map(node => node.said));
      assertEquals(
        (yield* call(() => p.wallet.heldCredential(g.said!))).artifacts,
        before,
        "new presentation never enriches or replaces the consented view",
      );
    });
  });
}
