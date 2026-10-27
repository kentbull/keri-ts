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
  Vrsn_2_0,
} from "cesr-ts";
import { call, type Operation, run } from "effection";
import { assert, assertEquals, assertRejects, assertThrows } from "jsr:@std/assert";
import { loadNests, openRegistry, RegistryStore } from "keri-ts/db";
import {
  acdcmap,
  blindate,
  createHabery,
  evaluateAcdcRelations,
  Exchanger,
  type Hab,
  type Habery,
  regcept,
  RegistryObserver,
  ValidationError,
  walkIpexGraph,
} from "keri-ts/runtime";
import { ipexExnBody } from "../../keri/src/app/ipex/ipex-building.ts";
import { loadIpexHandlers } from "../../keri/src/app/ipex/ipexing.ts";
import { dispatchEnvelope, envelopeFromFrame } from "../../keri/src/app/protocol/parsering.ts";
import { TransIdxSigGroup } from "../../keri/src/core/dispatch.ts";
import { messageAttachmentGroups } from "../../keri/src/core/protocol-serialization.ts";
import { createWalletBaser, Wallet } from "../mod.ts";

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
/** Deliver the same real Grant/Admit pair to both actual processors. */
function* pair(
  p: Parameters<Parameters<typeof withPeers>[0]>[0],
  nodes: SerderACDC[],
  message: string,
): Operation<[SerderKERI, SerderKERI]> {
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
  const admit = ipexExnBody(p.holder.pre, "/ipex/admit", [], { message: "retain", prior: grant });
  const response = signed(admit, p.holder);
  yield* ingest(response, p.receiver, p.receiving);
  yield* ingest(response, p.source, p.sending);
  assert(p.receiving.complete(admit.said!));
  return [grant, admit];
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
      const [g, a] = yield* pair(p, [node], `view-${i}`);
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
      const [g, a] = yield* pair(p, [near, far], operator);
      assert(p.receiving.verifyAccepted(g.said!, "/ipex/grant"));
      const graph = walkIpexGraph(near.said!, loadNests(p.receiver.db, g.said!), true, p.receiver.db);
      assert(graph && !("kind" in graph));
      assertEquals(evaluateAcdcRelations(graph, p.receiver.db, new Map()), operator === "I2I" ? false : null);
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
