/** Real signed public ingress exercises inventory independently of protocol acceptance. */
import {
  b,
  bytesEqual,
  type CesrFrame,
  collectPayload,
  Compactor,
  Diger,
  framePayload,
  Kinds,
  makeBlindState,
  type MapperMap,
  NumberPrimitive,
  parseBytes,
  Prefixer,
  SerderACDC,
  type SerderKERI,
  Vrsn_1_0,
  Vrsn_2_0,
} from "cesr-ts";
import { call, type Operation, run } from "effection";
import { assert, assertEquals, assertRejects, assertThrows } from "jsr:@std/assert";
import { loadNests, openRegistry, RegistryStore } from "keri-ts/db";
import {
  acdcmap,
  blindate,
  createAgentRuntime,
  createHabery,
  evaluateAcdcRelations,
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
): Operation<SerderKERI> {
  const grant = ipexExnBody(p.issuer.pre, "/ipex/grant", nodes, {
    message,
    recipient: p.holder.pre,
    xid: new Diger({ raw: Diger.digest(b(message), "E"), code: "E" }).qb64,
    plan: nodes.map((node, i) => [(node.schema as { $id: string }).$id, i ? "/e/proof/_/" : "/", []]),
  });
  const frame = signed(grant, p.issuer, nodes.map((node) => signed(node, p.issuer)));
  yield* ingest(frame, p.source, p.sending);
  yield* ingest(frame, p.receiver, p.receiving);
  assert(p.receiving.complete(grant.said!));
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
  Deno.test(`wallet retains authentic ${operator === "I2I" ? "false" : "unresolved"} graphs without creating consent`, async () => {
    await withPeers(function*(p) {
      const far = acdcmap(p.issuer.pre, { issuee: p.holder.pre, attribute: { d: "", role: "authority" } });
      const near = acdcmap(p.issuer.pre, {
        attribute: { d: "", role: "near" },
        edge: { d: "", proof: { n: far.said!, o: operator } },
      });
      const g = yield* grant(p, [near, far], operator);
      assert(p.receiving.verifyAccepted(g.said!, "/ipex/grant"));
      const graph = walkIpexGraph(near.said!, loadNests(p.receiver.db, g.said!), true, p.receiver.db);
      assert(graph && !("kind" in graph));
      assertEquals(evaluateAcdcRelations(graph, p.receiver.db, new Map()), operator === "I2I" ? false : null);
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
          "graph",
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
                  xid: a.said!,
                  plan: [[(near.schema as MapperMap).$id as string, "/", []]],
                })
              ),
            ValidationError,
            "graph",
          )
        );
        assertEquals(signatures, 0, "false/unknown transferred roots cannot cause a presenter signature");
      } finally {
        p.holder.sign = sign;
        yield* runtime.close();
      }
      yield* call(() =>
        assertRejects(() => p.wallet.recordAdmission(g.said!, a.said!, { consent: true }), ValidationError, "graph")
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
    p.issuer.interact({ data: [{ s: rip.sad!.n, d: rip.said! }, { s: issued.sad!.n, d: issued.said! }] });
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
    p.issuer.interact({ data: [{ s: revoked.sad!.n, d: revoked.said! }] });
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
      p.issuer.interact({ data: [{ s: "0", d: rip.said! }] });
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
        xid: credential.said!,
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
        xid: update.said!,
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
