/** RFC7748 fixture copied byte-for-byte from KERIpy 63a33e8869aa2309757ea9c1ab7b4447c5bf70e3,
 * tests/acdc/fixtures/dhke.json, Git blob 548bc1702a4bde93831c2ab125b24a4a71311d90.
 */
import {
  type CesrFrame,
  collectPayload,
  Diger,
  framePayload,
  makeBlindState,
  makeBlindUuid,
  parseBytes,
  SealLast,
  Vrsn_2_0,
} from "cesr-ts";
import { call, ensure, run } from "effection";
import { assertEquals, assertExists, assertNotEquals, assertRejects, assertThrows } from "jsr:@std/assert";
import { loadNests } from "../../../db.ts";
import { deriveRoot, Dhke, generateKeyPair } from "../../../src/acdc/dhking.ts";
import { acdcmap, blindate, regcept } from "../../../src/acdc/messaging.ts";
import { RegistryObserver } from "../../../src/acdc/observing.ts";
import { openRegistry, RegistryStore } from "../../../src/acdc/registering.ts";
import { Exchanger } from "../../../src/app/exchanges/exchanging.ts";
import { createHabery } from "../../../src/app/identity/habbing.ts";
import { ipexExnBody } from "../../../src/app/ipex/ipex-building.ts";
import { loadIpexHandlers } from "../../../src/app/ipex/ipexing.ts";
import { envelopeFromFrame } from "../../../src/app/protocol/parsering.ts";
import { ProtocolProcessor } from "../../../src/app/protocol/protocol-processing.ts";
import { Reactor } from "../../../src/app/protocol/reactor.ts";
import { QueryReplies } from "../../../src/app/queries/query-replies.ts";
import type { AgentCue } from "../../../src/core/cues.ts";
import { Deck } from "../../../src/core/deck.ts";
import { TransIdxSigGroup } from "../../../src/core/dispatch.ts";
import { Kevery } from "../../../src/core/kel/eventing.ts";
import { Kramer } from "../../../src/core/mailbox/kraming.ts";
import { messageAttachmentGroups, messagize } from "../../../src/core/protocol-serialization.ts";
import { makeNowIso8601 } from "../../../src/time/mod.ts";
import vector from "../../fixtures/dhke.json" with { type: "json" };

const unhex = (value: string) => Uint8Array.from(value.match(/../g)!, pair => parseInt(pair, 16));

Deno.test("DHKE derives the Python root and UUIDs and refuses unbound or noncontributory inputs", () => {
  const context = {
    xid: vector.context.x,
    grant: vector.context.grant,
    registry: vector.context.registry,
    issuer: vector.context.issuer,
    issuee: vector.context.issuee,
    issuerPublicKey: vector.context.issuer_pk,
    issueePublicKey: vector.context.issuee_pk,
  };
  const issuerPrivate = unhex(vector.issuer_private_hex);
  for (const [role, privateKey] of [["issuer", issuerPrivate], ["issuee", unhex(vector.issuee_private_hex)]] as const) {
    const root = deriveRoot(privateKey, { ...context, role });
    assertEquals(root.qb64, vector.root_qb64);
    assertEquals(root.raw, unhex(vector.root_hex));
    for (const [sn, expected] of Object.entries(vector.uuids)) {
      assertEquals(makeBlindUuid({ raw: root.raw, sn: Number(sn), tier: "low" }).qb64, expected);
    }
  }
  for (const rejected of vector.rejected_public_keys) {
    assertThrows(
      () => deriveRoot(issuerPrivate, { ...context, role: "issuer", issueePublicKey: rejected.qb64 }),
      Error,
      undefined,
      rejected.name,
    );
  }
  assertThrows(() => deriveRoot(new Uint8Array(31), { ...context, role: "issuer" }));
  assertThrows(() => deriveRoot(unhex(vector.issuee_private_hex), { ...context, role: "issuer" }));
  assertThrows(() => deriveRoot(issuerPrivate, { ...context, role: "issuer", grant: context.grant + "AAAA" }));
  assertNotEquals(
    deriveRoot(issuerPrivate, { ...context, role: "issuer", issueePublicKey: generateKeyPair().publicKey }).qb64,
    vector.root_qb64,
  );
  for (const field of ["xid", "grant", "registry", "issuer", "issuee"] as const) {
    assertNotEquals(
      deriveRoot(issuerPrivate, {
        ...context,
        role: "issuer",
        [field]: vector.context.x === context[field] ? vector.context.grant : vector.context.x,
      }).qb64,
      vector.root_qb64,
    );
  }
});

Deno.test("DHKE requires explicit consent and complete peer proofs before encrypted two-party issuance", async () => {
  await run(function*() {
    let now = Date.now();
    const issuerHby = yield* createHabery({
      name: crypto.randomUUID(),
      temp: true,
      skipConfig: true,
      bran: "IssuerPasscodeSecretAB",
    });
    yield* ensure(() => issuerHby.close(true));
    const issueeHby = yield* createHabery({
      name: crypto.randomUUID(),
      temp: true,
      skipConfig: true,
      bran: "IssueePasscodeSecretAB",
    });
    yield* ensure(() => issueeHby.close(true));
    const issuer = issuerHby.makeHab("issuer", undefined, { icount: 2, isith: "2", ncount: 2, nsith: "2" });
    const issuee = issueeHby.makeHab("issuee", undefined, { icount: 2, isith: "2", ncount: 2, nsith: "2" });
    const parties = [];
    for (const [hby, hab] of [[issuerHby, issuer], [issueeHby, issuee]] as const) {
      const baser = yield* openRegistry({ name: crypto.randomUUID(), temp: true });
      yield* ensure(() => baser.close(true));
      const store = new RegistryStore(baser), rvy = hab.rvy, output = rvy.cues, cues = new Deck<AgentCue>();
      const kvy = new Kevery(hby.db, {
        rvy,
        cues: output,
        kramer: new Kramer(hby.db, {
          cues: output,
          now: () => now,
          config: { enabled: true, caches: { "~": [1000, 5000, 60000, 300000, 5000, 60000, 300000] } },
        }),
      });
      const exc = new Exchanger(hby, { cues: output, now: () => now });
      loadIpexHandlers(hby, exc, { registry: store });
      const dh = new Dhke({ hab, exc, registryStore: store });
      rvy.rtr.addRoute("/ipex/dhke", dh);
      const protocol = new ProtocolProcessor(
        kvy,
        rvy,
        exc,
        null,
        null,
        new RegistryObserver(hby.db, store),
        output,
        cues,
        new QueryReplies(cues),
        dh,
      );
      parties.push({ hby, hab, store, exc, dh, protocol, reactor: new Reactor(protocol) });
    }
    const [left, right] = parties;
    // Only accepted public KEL/TEL crosses between independently encrypted stores.
    for (const wire of issuerHby.db.clonePreIter(issuer.pre, 0)) yield* right.reactor.processBytes(wire);
    for (const wire of issueeHby.db.clonePreIter(issuee.pre, 0)) yield* left.reactor.processBytes(wire);
    const stamp = makeNowIso8601(new Date(now));
    const rip = regcept(issuer.pre, { stamp });
    const anchor = issuer.interact({ data: [{ i: rip.said!, s: "0", d: rip.said! }] });
    yield* right.reactor.processBytes(anchor);
    for (const party of parties) yield* party.reactor.processBytes(rip.raw);
    const credential = acdcmap(issuer.pre, { regid: rip.said!, attribute: { d: "", i: issuee.pre, name: "Ada" } });
    const grant = ipexExnBody(issuer.pre, "/ipex/grant", [credential], {
      recipient: issuee.pre,
      message: "Derived registry root",
      date: stamp,
    });
    const wire = yield* call(() =>
      collectPayload(framePayload({
        body: grant,
        gvrsn: Vrsn_2_0,
        attachments: parseBytes(issuer.endorse(grant, { pipelined: false }))[0].attachments,
        nests: [{ body: credential, gvrsn: Vrsn_2_0, attachments: [] }],
      }))
    );
    for (const party of parties) {
      yield* party.reactor.processBytes(wire);
      assertEquals(party.exc.complete(grant.said!), false);
      assertExists(party.hby.db.epse.get(grant.said!));
      assertEquals(party.hab.mgr.getRegistryRoot(party.hab.pre, rip.said!), null);
    }
    const deadlines = parties.map(party => party.hby.db.epsd.get(grant.said!)!.dts);
    const originalBodies = parties.map(party => loadNests(party.hby.db, grant.said!).map(nest => nest.body.raw));
    now += 11000;
    assertEquals(left.dh.approve(grant.said!), grant.said!);
    const query = left.dh.start(grant.said!);
    assertEquals(left.dh.start(grant.said!), query, "retry preserves the exact signed query");
    assertEquals(right.dh.processQuery(envelopeFromFrame(parseBytes(query)[0])).kind, "drop");
    assertEquals(right.dh.outgoing.length, 0, "receipt without consent creates no DH reply");
    assertEquals(right.dh.approve(grant.said!), grant.said!);
    const deliverPartial = function*(party: typeof left, raw: Uint8Array, index: number) {
      const frame = parseBytes(raw)[0],
        envelope = envelopeFromFrame(frame),
        proof = envelope.tsgs[0],
        last = envelope.ssgs[0];
      assertEquals((proof ?? last).sigers.length, 2);
      const fragment: CesrFrame = {
        ...frame,
        attachments: envelope.tsgs.length
          ? messageAttachmentGroups({
            tsgs: [
              new TransIdxSigGroup(proof.prefixer, proof.seqner, proof.diger, [proof.sigers[index]]),
            ],
          }, Vrsn_2_0)
          : parseBytes(messagize(envelope.serder, {
            sigers: [last.sigers[index]],
            seal: SealLast.fromTuple([last.prefixer]),
            gvrsn: Vrsn_2_0,
          }))[0].attachments,
      };
      yield* party.reactor.processBytes(yield* call(() => collectPayload(framePayload(fragment))));
    };
    yield* deliverPartial(right, query, 0);
    assertEquals(right.dh.outgoing.length, 0, "one query signature cannot authorize a reply");
    yield* deliverPartial(right, query, 1);
    const response = right.dh.outgoing.pull()!;
    assertEquals(response.dest, issuer.pre);
    const reply = envelopeFromFrame(parseBytes(response.msg)[0]);
    const unapproved = new Dhke({ hab: issuer, exc: left.exc, registryStore: left.store });
    assertEquals(
      unapproved.processReply({
        serder: reply.serder,
        diger: new Diger({ qb64: reply.serder.said! }),
        route: Dhke.Route,
        tsgs: reply.tsgs,
      }).kind,
      "unverified",
    );
    assertEquals(
      issuer.mgr.getRegistryRoot(issuer.pre, rip.said!),
      null,
      "an unsolicited reply grants no root custody",
    );
    yield* deliverPartial(left, response.msg, 0);
    assertEquals(left.dh.complete(grant.said!), false, "one reply signature cannot complete DH");
    yield* deliverPartial(left, response.msg, 1);
    assertEquals(left.dh.complete(grant.said!), true);
    assertEquals(right.dh.complete(grant.said!), true);
    const root = issuer.mgr.getRegistryRoot(issuer.pre, rip.said!)!;
    assertExists(root);
    assertEquals(issuee.mgr.getRegistryRoot(issuee.pre, rip.said!)!.qb64, root.qb64);
    assertNotEquals(issuer.mgr.ks.rroots.get([issuer.pre, rip.said!])!.qb64, root.qb64);
    assertEquals(new TextDecoder().decode(query).includes(root.qb64), false);
    assertEquals(new TextDecoder().decode(response.msg).includes(root.qb64), false);
    assertThrows(() => new Dhke({ hab: issuer, exc: left.exc, registryStore: left.store }).approve(grant.said!));

    // DH creates custody only. Exact issued evidence finishes the original Grant, then Admit is separate.
    yield* call(() => assertRejects(() => run(() => left.dh.finish(grant.said!))));
    assertEquals(left.exc.complete(grant.said!), false, "DH alone does not issue the credential");
    const opening = makeBlindState({ salt: root.qb64, acdc: credential.said!, state: "issued" });
    const bup = blindate(rip.said!, rip.said!, opening.d.nonce, { stamp });
    const issuance = issuer.interact({ data: [{ i: rip.said!, s: "1", d: bup.said! }] });
    yield* right.reactor.processBytes(issuance);
    const bupWire = yield* call(() => collectPayload(framePayload({ body: bup, gvrsn: Vrsn_2_0, attachments: [] })));
    for (const [index, party] of parties.entries()) {
      yield* party.reactor.processBytes(bupWire);
      assertEquals((yield* party.dh.finish(grant.said!)).kind, "accept");
      assertEquals(party.hby.db.exns.get(grant.said!)!.raw, grant.raw);
      assertEquals(party.hby.db.epsd.get(grant.said!)!.dts, deadlines[index]);
      const finished = loadNests(party.hby.db, grant.said!);
      assertEquals(finished.map(nest => nest.body.raw), originalBodies[index]);
      assertEquals(envelopeFromFrame(finished[0]).bsqs[0].d.nonce, opening.d.nonce);
      assertEquals(party.hby.db.erpy.get(grant.said!), null, "setup/issuance creates no Admit");
      assertEquals(party.store.head(rip.said!)!.qb64, bup.said!);
    }
    const admit = ipexExnBody(issuee.pre, "/ipex/admit", [], {
      prior: grant,
      message: "Accept issued credential",
      date: stamp,
    });
    const admission = issuee.endorse(admit, { pipelined: false });
    for (const party of parties) {
      yield* party.reactor.processBytes(admission);
      assertEquals(party.exc.complete(admit.said!), true);
      assertEquals(party.hby.db.erpy.get(grant.said!)!.qb64, admit.said!);
    }
  });
});
