/** RFC7748 fixture copied byte-for-byte from KERIpy 63a33e8869aa2309757ea9c1ab7b4447c5bf70e3,
 * tests/acdc/fixtures/dhke.json, Git blob 548bc1702a4bde93831c2ab125b24a4a71311d90.
 */
import {
  type CesrFrame,
  collectPayload,
  Diger,
  Encrypter,
  framePayload,
  makeBlindState,
  makeBlindUuid,
  MtrDex,
  NumberPrimitive,
  parseAttachmentGroup,
  parseBytes,
  Prefixer,
  Salter,
  SealLast,
  type SerderACDC,
  type SerderKERI,
  Vrsn_2_0,
} from "cesr-ts";
import { call, ensure, run } from "effection";
import { assertEquals, assertExists, assertNotEquals, assertRejects, assertThrows } from "jsr:@std/assert";
import { loadNests } from "../../../db.ts";
import { deriveRoot, Dhke, generateKeyPair } from "../../../src/acdc/dhking.ts";
import { acdcmap, blindate, regcept } from "../../../src/acdc/messaging.ts";
import { RegistryObserver } from "../../../src/acdc/observing.ts";
import { openRegistry, publicOpeningAttachment, RegistryStore } from "../../../src/acdc/registering.ts";
import { Regery } from "../../../src/acdc/registraring.ts";
import { RegistrySalt } from "../../../src/acdc/salting.ts";
import { Exchanger } from "../../../src/app/exchanges/exchanging.ts";
import { createHabery, type Hab, type Habery } from "../../../src/app/identity/habbing.ts";
import { ipexExnBody } from "../../../src/app/ipex/ipex-building.ts";
import { loadIpexHandlers } from "../../../src/app/ipex/ipexing.ts";
import { dispatchEnvelope, envelopeFromFrame } from "../../../src/app/protocol/parsering.ts";
import { ProtocolProcessor } from "../../../src/app/protocol/protocol-processing.ts";
import { Reactor } from "../../../src/app/protocol/reactor.ts";
import { QueryReplies } from "../../../src/app/queries/query-replies.ts";
import type { AgentCue } from "../../../src/core/cues.ts";
import { Deck } from "../../../src/core/deck.ts";
import { TransIdxSigGroup } from "../../../src/core/dispatch.ts";
import { Kevery } from "../../../src/core/kel/eventing.ts";
import { Kramer } from "../../../src/core/mailbox/kraming.ts";
import { interact as interactEvent, reply } from "../../../src/core/protocol-eventing.ts";
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

Deno.test("v2 KERI/ACDC bilateral group DH keeps custody with approved elected members", async () => {
  await run(function*() {
    const members: { hby: Habery; member: Hab }[] = [];
    for (const name of ["issuer-0", "issuer-1", "issuee-0", "issuee-1"]) {
      const hby = yield* createHabery({
        name: crypto.randomUUID(),
        temp: true,
        skipConfig: true,
        bran: `${name}GroupDhPasscodeABC`,
      });
      yield* ensure(() => hby.close(true));
      members.push({ hby, member: hby.makeHab(name) });
    }
    assertEquals(new Set(members.map(side => side.member.pre)).size, 4);
    for (const source of members) {
      for (const target of members) {
        if (source === target) continue;
        for (const wire of source.hby.db.clonePreIter(source.member.pre, 0)) {
          yield* dispatchEnvelope(envelopeFromFrame(parseBytes(wire)[0]), target.hby.rvy, target.hby.kevery);
        }
      }
    }
    const creations = members.map((side, index) => {
      const signing = members.slice(index < 2 ? 0 : 2, index < 2 ? 2 : 4).map(peer => peer.member.pre);
      return side.hby.makeGroupHab("group", side.member, signing, signing, undefined, { isith: "2", nsith: "2" });
    });
    // Each group accepts the two independently owned inception contributions through ordinary KEL verification.
    for (const start of [0, 2]) {
      const frame = parseBytes(messagize(creations[start].serder, {
        sigers: [...creations[start].sigers, ...creations[start + 1].sigers],
        gvrsn: Vrsn_2_0,
      }))[0];
      for (const side of members) {
        yield* dispatchEnvelope(envelopeFromFrame(frame, true), side.hby.rvy, side.hby.kevery);
        assertExists(side.hby.db.getKever(creations[start].hab.pre));
      }
    }
    const actors: {
      hby: Habery;
      member: Hab;
      hab: Hab;
      store: RegistryStore;
      exc: Exchanger;
      dh: Dhke;
      protocol: ProtocolProcessor;
      reactor: Reactor;
    }[] = [];
    for (const [index, side] of members.entries()) {
      const hab = creations[index].hab;
      const baser = yield* openRegistry({ name: crypto.randomUUID(), temp: true });
      yield* ensure(() => baser.close(true));
      const store = new RegistryStore(baser), rvy = hab.rvy, output = rvy.cues, cues = new Deck<AgentCue>();
      const kvy = new Kevery(side.hby.db, {
        rvy,
        cues: output,
        kramer: new Kramer(side.hby.db, {
          cues: output,
          config: { enabled: true, caches: { "~": [1000, 5000, 60000, 300000, 5000, 60000, 300000] } },
        }),
      });
      const exc = new Exchanger(side.hby, { cues: output });
      loadIpexHandlers(side.hby, exc, { registry: store });
      const dh = new Dhke({ hab, exc, registryStore: store });
      rvy.rtr.addRoute(Dhke.Route, dh);
      const protocol = new ProtocolProcessor(
        kvy,
        rvy,
        exc,
        null,
        null,
        new RegistryObserver(side.hby.db, store),
        output,
        cues,
        new QueryReplies(cues),
        dh,
      );
      actors.push({ ...side, hab, store, exc, dh, protocol, reactor: new Reactor(protocol) });
    }
    const issuers = actors.slice(0, 2), issuees = actors.slice(2), lead = issuers[0], holder = issuees[0];
    const intakeAll = function*(wire: Uint8Array, local = false) {
      for (const side of actors) yield* side.reactor.processBytes(wire, { local });
    };
    const groupInteraction = function*(peers: typeof issuers, data: unknown[] = []) {
      const state = peers[0].hab.kever!;
      const body = interactEvent(peers[0].hab.pre, state.said, state.sn + 1, data, { version: Vrsn_2_0 });
      const wire = messagize(body, { sigers: peers.flatMap(side => side.hab.sign(body.raw, true)), gvrsn: Vrsn_2_0 });
      yield* intakeAll(wire, true);
      for (const side of actors) assertEquals(side.hby.db.getKever(body.pre!)!.said, body.said);
      return body;
    };
    const anchor = function*(event: SerderACDC) {
      const regid = event.regid ?? event.said!;
      const body = yield* groupInteraction(issuers, [{ i: regid, s: event.sad!.n, d: event.said! }]);
      yield* intakeAll(event.raw);
      return body;
    };
    const rip = regcept(lead.hab.pre);
    const coordinator = yield* anchor(rip);
    const recipientCoordinator = yield* groupInteraction(issuees);
    const credential = acdcmap(lead.hab.pre, {
      regid: rip.said!,
      attribute: { d: "", i: holder.hab.pre, name: "Ada" },
    });
    const grant = ipexExnBody(lead.hab.pre, "/ipex/grant", [credential], {
      recipient: holder.hab.pre,
      message: "Exact group issuance",
    });
    const groupProof = (body: SerderKERI, peers: typeof issuers) =>
      new TransIdxSigGroup(
        new Prefixer({ qb64: peers[0].hab.pre }),
        NumberPrimitive.fromNum(0n),
        new Diger({ qb64: peers[0].hab.kever!.lastEst.d }),
        peers.flatMap(side => side.hab.sign(body.raw, true)),
      );
    yield* intakeAll(
      yield* call(() =>
        collectPayload(framePayload({
          body: grant,
          gvrsn: Vrsn_2_0,
          attachments: messageAttachmentGroups({ tsgs: [groupProof(grant, issuers)] }, Vrsn_2_0),
          nests: [{ body: credential, gvrsn: Vrsn_2_0, attachments: [] }],
        }))
      ),
    );
    const deadlines = actors.map(side => side.hby.db.epsd.get(grant.said!)!.dts);
    const selection = { coordinator: { sn: coordinator.sn!, said: coordinator.said! }, custodian: lead.member.pre };
    const recipientSelection = {
      coordinator: { sn: recipientCoordinator.sn!, said: recipientCoordinator.said! },
      custodian: holder.member.pre,
    };
    lead.dh.approve(grant.said!, selection);
    for (const side of issuees) side.dh.approve(grant.said!, recipientSelection);
    const proposal = lead.dh.start(grant.said!);
    assertThrows(
      () => issuers[1].dh.contribute(grant.said!, proposal),
      Error,
      undefined,
      "a proposal cannot create setup consent",
    );
    issuers[1].dh.approve(grant.said!, selection);
    assertThrows(() => issuers[1].dh.start(grant.said!), Error, undefined, "only the frozen custodian authors DH keys");
    // Later member keys cannot reinterpret the coordinator or replace its historical group contribution.
    yield* intakeAll(issuers[1].member.rotate());
    const contributed = issuers[1].dh.contribute(grant.said!, proposal);
    assertEquals(parseBytes(contributed)[0].body.raw, parseBytes(proposal)[0].body.raw);
    assertEquals(issuers[1].dh.contribute(grant.said!, proposal), contributed);
    for (const side of issuers) {
      yield* side.reactor.processBytes(proposal);
      assertEquals(
        [...side.dh.outgoing].filter(cue => cue.kin === "query"),
        [],
        "one signature cannot publish a query",
      );
      yield* side.reactor.processBytes(contributed);
    }
    const query = lead.dh.outgoing.pull()!;
    assertEquals(query.kin, "query");
    assertEquals(query.dest, holder.hab.pre);
    assertEquals(lead.dh.start(grant.said!), query.msg, "retry returns the same threshold-complete query");
    for (const side of issuees) yield* side.reactor.processBytes(query.msg);
    for (const side of actors) assertEquals(side.hab.mgr.getRegistryRoot(side.hab.pre, rip.said!), null);
    const replyProposal = holder.dh.outgoing.pull()!;
    assertEquals(replyProposal.kin, "sign");
    yield* intakeAll(issuees[1].member.rotate());
    const replyContribution = issuees[1].dh.contribute(grant.said!, replyProposal.msg);
    assertEquals(parseBytes(replyContribution)[0].body.raw, parseBytes(replyProposal.msg)[0].body.raw);
    for (const side of issuees) {
      yield* side.reactor.processBytes(replyProposal.msg);
      yield* side.reactor.processBytes(replyProposal.msg);
      assertEquals(
        side.hab.mgr.getRegistryRoot(side.hab.pre, rip.said!),
        null,
        "duplicate partials do not create custody",
      );
      yield* side.reactor.processBytes(replyContribution);
    }
    const response = holder.dh.outgoing.pull()!;
    assertEquals(response.kin, "reply");
    for (const side of issuers) yield* side.reactor.processBytes(response.msg);
    const root = lead.hab.mgr.getRegistryRoot(lead.hab.pre, rip.said!)!;
    assertExists(root);
    assertEquals(holder.hab.mgr.getRegistryRoot(holder.hab.pre, rip.said!)!.qb64, root.qb64);
    assertEquals(lead.dh.complete(grant.said!), true);
    assertEquals(holder.dh.complete(grant.said!), true);
    for (const peer of [issuers[1], issuees[1]]) {
      assertEquals(peer.hab.mgr.getRegistryRoot(peer.hab.pre, rip.said!), null);
    }
    assertEquals(new TextDecoder().decode(query.msg).includes(root.qb64), false);
    assertEquals(new TextDecoder().decode(response.msg).includes(root.qb64), false);
    const opening = makeBlindState({ salt: root.qb64, acdc: credential.said!, state: "issued" });
    const event = blindate(rip.said!, rip.said!, opening.d.nonce);
    yield* anchor(event);
    for (const side of [lead, holder]) assertEquals((yield* side.dh.finish(grant.said!)).kind, "accept");
    // Rootless members accept the same signed Grant using the actual public opening, never copied roots.
    for (const peer of [issuers[1], issuees[1]]) {
      const input = peer.exc.retainedInput(grant.said!)!;
      input.nests![0].attachments.push(parseAttachmentGroup(publicOpeningAttachment(opening), Vrsn_2_0, "txt").group);
      assertEquals((yield* peer.exc.processEvent(input)).kind, "accept");
    }
    for (const [index, side] of actors.entries()) {
      assertEquals(side.exc.complete(grant.said!), true);
      assertEquals(side.hby.db.exns.get(grant.said!)!.raw, grant.raw);
      assertEquals(side.hby.db.epsd.get(grant.said!)!.dts, deadlines[index]);
      assertEquals(side.hby.db.erpy.get(grant.said!), null, "setup and issuance do not Admit");
    }
    const admit = ipexExnBody(holder.hab.pre, "/ipex/admit", [], {
      prior: grant,
      message: "Separate group acceptance",
    });
    yield* intakeAll(holder.hab.endorse(admit, { gvrsn: Vrsn_2_0 }));
    for (const side of actors) assertEquals(side.exc.complete(admit.said!), false);
    yield* intakeAll(issuees[1].hab.endorse(admit, { gvrsn: Vrsn_2_0 }));
    for (const side of actors) {
      assertEquals(side.exc.complete(admit.said!), true);
      assertEquals(side.hby.db.erpy.get(grant.said!)!.qb64, admit.said!);
    }
    for (const peer of [issuers[1], issuees[1]]) {
      assertEquals(peer.hab.mgr.getRegistryRoot(peer.hab.pre, rip.said!), null);
    }

    // Explicitly copy the holder's existing root to its already rotated, rootless signing member.
    const recipient = issuees[1];
    const exporter = new RegistrySalt({ hab: holder.hab, rgy: new Regery(holder.hby, holder.store.baser) });
    const importer = new RegistrySalt({ hab: recipient.hab, rgy: new Regery(recipient.hby, recipient.store.baser) });
    recipient.hab.rvy.rtr.addRoute(RegistrySalt.Route, importer);
    const retainedHistory = recipient.hby.db.enst.get(grant.said!);
    const copy = exporter.prepare(rip.said!, holder.hab.pre, recipient.member.pre, {
      coordinator: recipientSelection.coordinator,
    });
    const frame = parseBytes(copy)[0], selected = envelopeFromFrame(frame);
    assertEquals(Object.keys(selected.serder.sad!.a as Record<string, unknown>).sort(), [
      "cipher",
      "recipient",
      "registry",
      "target",
    ]);
    assertEquals(new TextDecoder().decode(copy).includes(root.qb64), false);
    assertEquals(
      new TextDecoder().decode(copy).includes(opening.d.qb64),
      false,
      "held opening remains local approval evidence",
    );
    const unapproved = importer.processReply({
      serder: selected.serder,
      diger: new Diger({ qb64: selected.serder.said! }),
      route: RegistrySalt.Route,
      tsgs: selected.tsgs,
      attachments: selected,
    });
    assertEquals(unapproved.kind, "unverified");
    assertEquals(recipient.hab.mgr.getRegistryRoot(recipient.hab.pre, rip.said!), null);
    importer.approve(rip.said!, holder.hab.pre, { event: event.said!, opening });

    // A complete current group signature cannot authorize a root with a different disclosure UUID.
    const wrongRoot = new Salter({ raw: new TextEncoder().encode("wrong-test-root!"), code: MtrDex.Salt_128 });
    const wrongCipher = new Encrypter({ verkey: recipient.member.kever!.verfers[0].qb64 }).encrypt({ prim: wrongRoot });
    const wrong = reply(RegistrySalt.Route, {
      registry: rip.said!,
      recipient: holder.hab.pre,
      target: recipient.member.pre,
      cipher: wrongCipher.qb64,
    }, { pre: holder.hab.pre, pvrsn: Vrsn_2_0 });
    const refused = yield* recipient.protocol.dispatch(
      parseBytes(messagize(wrong, { tsgs: [groupProof(wrong, issuees)], gvrsn: Vrsn_2_0 }))[0],
    );
    assertEquals(refused.decision?.kind, "unverified");
    assertEquals(recipient.hab.mgr.getRegistryRoot(recipient.hab.pre, rip.said!), null);
    yield* recipient.reactor.processBytes(copy);
    yield* recipient.reactor.processBytes(copy);
    assertEquals(
      recipient.hab.mgr.getRegistryRoot(recipient.hab.pre, rip.said!),
      null,
      "duplicate index zero cannot satisfy the group threshold",
    );
    const contribution = recipient.hab.endorse(selected.serder, { gvrsn: Vrsn_2_0 });
    assertEquals(
      parseBytes(contribution)[0].body.raw,
      frame.body.raw,
      "the second member signs the exact ciphertext and scope",
    );
    yield* recipient.reactor.processBytes(contribution);
    assertEquals(recipient.hab.mgr.getRegistryRoot(recipient.hab.pre, rip.said!)!.qb64, root.qb64);
    const ciphertext = recipient.hab.mgr.ks.rroots.get([recipient.hab.pre, rip.said!])!.qb64;
    const complete =
      parseBytes(messagize(selected.serder, { tsgs: [groupProof(selected.serder, issuees)], gvrsn: Vrsn_2_0 }))[0];
    const accepted = envelopeFromFrame(complete);
    assertEquals(
      importer.processReply({
        serder: accepted.serder,
        diger: new Diger({ qb64: accepted.serder.said! }),
        route: RegistrySalt.Route,
        tsgs: accepted.tsgs,
        attachments: accepted,
      }).kind,
      "accept",
    );
    assertEquals(
      recipient.hab.mgr.ks.rroots.get([recipient.hab.pre, rip.said!])!.qb64,
      ciphertext,
      "identical receipt preserves immutable encrypted retention",
    );
    assertEquals(recipient.hby.db.enst.get(grant.said!), retainedHistory);
    assertEquals(recipient.hby.db.exns.get(admit.said!)!.raw, admit.raw);
    assertEquals(recipient.hby.db.epsd.get(grant.said!)!.dts, deadlines[3]);
  });
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
