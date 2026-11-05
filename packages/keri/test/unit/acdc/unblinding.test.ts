/** Real encrypted owners follow KERIpy test_unblind_routes.py without provisioning or transport claims. */
import {
  type CesrFrame,
  collectPayload,
  Diger,
  framePayload,
  Kinds,
  makeBlindState,
  MtrDex,
  NumberPrimitive,
  parseAttachmentGroup,
  parseBytes,
  Prefixer,
  Salter,
  type SerderACDC,
  type SerderKERI,
  Vrsn_2_0,
} from "cesr-ts";
import { call, ensure, run } from "effection";
import { assertEquals, assertExists, assertRejects, assertThrows } from "jsr:@std/assert";
import { loadNests } from "../../../db.ts";
import { acdcmap, blindate, regcept } from "../../../src/acdc/messaging.ts";
import { RegistryObserver } from "../../../src/acdc/observing.ts";
import { openRegistry, publicOpeningAttachment, RegistryStore } from "../../../src/acdc/registering.ts";
import { Unblind } from "../../../src/acdc/unblinding.ts";
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
import { interact as interactEvent } from "../../../src/core/protocol-eventing.ts";
import { messageAttachmentGroups, messagize } from "../../../src/core/protocol-serialization.ts";
import { makeNowIso8601 } from "../../../src/time/mod.ts";

Deno.test("Unblind repairs pending and live exact presentations without changing admitted history", async () => {
  await run(function*() {
    const now = Date.now(), stamp = makeNowIso8601(new Date(now));
    const senderHby = yield* createHabery({
      name: crypto.randomUUID(),
      temp: true,
      skipConfig: true,
      bran: "PresenterPasscodeABCD",
    });
    yield* ensure(() => senderHby.close(true));
    const verifierHby = yield* createHabery({
      name: crypto.randomUUID(),
      temp: true,
      skipConfig: true,
      bran: "VerifierPasscodeABCDE",
    });
    yield* ensure(() => verifierHby.close(true));
    const sender = senderHby.makeHab("issuer-presenter", undefined, { icount: 2, isith: "2", ncount: 2, nsith: "2" });
    const verifier = verifierHby.makeHab("rootless-verifier", undefined, {
      icount: 2,
      isith: "2",
      ncount: 2,
      nsith: "2",
    });
    const parties: {
      hby: typeof senderHby;
      hab: typeof sender;
      store: RegistryStore;
      exc: Exchanger;
      route: Unblind;
      protocol: ProtocolProcessor;
      reactor: Reactor;
    }[] = [];
    for (const [hby, hab] of [[senderHby, sender], [verifierHby, verifier]] as const) {
      const baser = yield* openRegistry({ name: crypto.randomUUID(), temp: true });
      yield* ensure(() => baser.close(true));
      const store = new RegistryStore(baser), rvy = hab.rvy, output = rvy.cues, cues = new Deck<AgentCue>();
      const kvy = new Kevery(hby.db, {
        rvy,
        cues: output,
        kramer: new Kramer(hby.db, {
          cues: output,
          config: { enabled: true, caches: { "~": [1000, 5000, 60000, 300000, 5000, 60000, 300000] } },
        }),
      });
      const exc = new Exchanger(hby, { cues: output });
      loadIpexHandlers(hby, exc, { registry: store });
      const registry = new RegistryObserver(hby.db, store);
      const route = new Unblind({ hab, exc, registry, states: ["issued", "revoked", ""] });
      rvy.rtr.addRoute(Unblind.Route, route);
      const protocol = new ProtocolProcessor(
        kvy,
        rvy,
        exc,
        null,
        null,
        registry,
        output,
        cues,
        new QueryReplies(cues),
        route,
      );
      parties.push({ hby, hab, store, exc, route, protocol, reactor: new Reactor(protocol) });
    }
    const [presenter, observer] = parties;
    for (const wire of senderHby.db.clonePreIter(sender.pre, 0)) yield* observer.reactor.processBytes(wire);
    for (const wire of verifierHby.db.clonePreIter(verifier.pre, 0)) yield* presenter.reactor.processBytes(wire);
    const rip = regcept(sender.pre, { stamp });
    yield* observer.reactor.processBytes(sender.interact({ data: [{ i: rip.said!, s: "0", d: rip.said! }] }));
    for (const party of parties) yield* party.reactor.processBytes(rip.raw);
    // Explicit test custody only; DH provisioning has its own independent regression.
    const root = new Salter({ raw: new TextEncoder().encode("public-test-root"), code: MtrDex.Salt_128 });
    sender.mgr.putRegistryRoot(sender.pre, rip.said!, root);
    assertEquals(verifier.mgr.getRegistryRoot(verifier.pre, rip.said!), null);
    const credential = acdcmap(sender.pre, { regid: rip.said!, attribute: { d: "", i: verifier.pre, name: "Ada" } });
    const first = makeBlindState({ salt: root.qb64, sn: 1, acdc: credential.said!, state: "issued" });
    const event1 = blindate(rip.said!, rip.said!, first.d.nonce, { stamp });
    const kel1 = sender.interact({ data: [{ i: rip.said!, s: "1", d: event1.said! }] });
    yield* observer.reactor.processBytes(kel1);
    for (const party of parties) yield* party.reactor.processBytes(event1.raw);
    const child: CesrFrame = {
      body: credential,
      gvrsn: Vrsn_2_0,
      attachments: [parseAttachmentGroup(publicOpeningAttachment(first), Vrsn_2_0, "txt").group],
    };
    const presentation = function*(message: string) {
      const grant = ipexExnBody(sender.pre, "/ipex/grant", [credential], {
        kind: Kinds.json,
        recipient: verifier.pre,
        message,
        date: stamp,
      });
      const wire = yield* call(() =>
        collectPayload(framePayload({
          body: grant,
          gvrsn: Vrsn_2_0,
          attachments: parseBytes(sender.endorse(grant, { gvrsn: Vrsn_2_0 }))[0].attachments,
          nests: [child],
        }))
      );
      for (const party of parties) yield* party.reactor.processBytes(wire);
      return grant;
    };
    const original = yield* presentation("Original admitted issuance");
    const admitted = ipexExnBody(verifier.pre, "/ipex/admit", [], {
      prior: original,
      message: "Accept original",
      date: stamp,
    });
    for (const party of parties) {
      yield* party.reactor.processBytes(verifier.endorse(admitted, { gvrsn: Vrsn_2_0 }));
      assertEquals(party.exc.complete(admitted.said!), true);
    }
    const historical = parties.map(party => ({
      nests: party.hby.db.enst.get(original.said!),
      deadline: party.hby.db.epsd.get(original.said!)!.dts,
      grant: party.hby.db.exns.get(original.said!)!.raw,
      admit: party.hby.db.exns.get(admitted.said!)!.raw,
    }));
    const live = yield* presentation("Accepted live presentation");
    for (const party of parties) assertEquals(party.exc.complete(live.said!), true);

    // Only the verifier learns the new TEL suffix; the presenter already owns its accepted KEL anchors.
    const proofs = [], events = [];
    let prior = event1;
    for (const sn of [2, 3, 4]) {
      const proof = makeBlindState({
        salt: root.qb64,
        sn,
        acdc: sn === 2 ? credential.said! : "",
        state: sn === 2 ? "issued" : "",
      });
      const event = blindate(rip.said!, prior.said!, proof.d.nonce, { sn, stamp });
      const kel = sender.interact({ data: [{ i: rip.said!, s: sn.toString(16), d: event.said! }] });
      yield* observer.reactor.processBytes(kel);
      yield* observer.reactor.processBytes(event.raw);
      proofs.push(proof);
      events.push(event);
      prior = event;
    }
    assertEquals(presenter.store.head(rip.said!)!.qb64, event1.said!);
    assertEquals(observer.store.head(rip.said!)!.qb64, events[2].said!);
    const pending = yield* presentation("Pending stale presentation");
    assertEquals(presenter.exc.complete(pending.said!), true);
    assertEquals(observer.exc.complete(pending.said!), false);
    assertExists(observer.hby.db.epse.get(pending.said!));
    const deadline = observer.hby.db.epsd.get(pending.said!)!.dts;
    assertThrows(() => presenter.route.approve(original.said!), Error, undefined, "an admitted Grant is terminal");
    const xid = observer.route.approve(pending.said!);
    const query = observer.route.start(pending.said!), requested = parseBytes(query)[0];
    assertEquals(observer.route.start(pending.said!), query, "retry keeps the exact signed query");
    const requestedEvents = (envelopeFromFrame(requested).serder.sad!.q as Record<string, unknown>).re;
    assertEquals(requestedEvents, { [rip.said!]: events.map(event => event.said!) });
    assertEquals(requested.nests!.map(nest => nest.body.raw), events.map(event => event.raw));
    assertEquals(envelopeFromFrame(requested).bsqs, [], "query carries public state, never openings");
    assertEquals(presenter.route.processQuery(envelopeFromFrame(requested)).kind, "drop");
    assertEquals(presenter.route.outgoing.length, 0, "receipt without release consent discloses no proofs");
    assertEquals(presenter.store.head(rip.said!)!.qb64, event1.said!, "unapproved public suffix is not imported");
    assertEquals(presenter.route.approve(pending.said!), xid);
    yield* presenter.reactor.processBytes(query);
    assertEquals(
      presenter.store.head(rip.said!)!.qb64,
      events[2].said!,
      "authenticated query recovers the public suffix",
    );
    const response = presenter.route.outgoing.pull()!;
    assertEquals(response.dest, verifier.pre);
    const reply = parseBytes(response.msg)[0], replyEvidence = envelopeFromFrame(reply);
    assertEquals((replyEvidence.serder.sad!.a as Record<string, unknown>).re, requestedEvents);
    assertEquals(reply.nests ?? [], []);
    assertEquals(replyEvidence.bsqs.map(proof => proof.d.nonce).sort(), proofs.map(proof => proof.d.nonce).sort());
    assertEquals(replyEvidence.bsss, []);
    assertEquals(new TextDecoder().decode(response.msg).includes(root.qb64), false);
    assertEquals(
      new TextDecoder().decode(response.msg).includes(first.d.qb64),
      false,
      "already carried BUP1 opening is omitted",
    );
    const signature = replyEvidence.tsgs[0];
    const partialReply = (index: number, includeProofs: boolean): CesrFrame => ({
      ...reply,
      attachments: [
        ...messageAttachmentGroups({
          tsgs: [
            new TransIdxSigGroup(signature.prefixer, signature.seqner, signature.diger, [signature.sigers[index]]),
          ],
        }, Vrsn_2_0),
        ...includeProofs
          ? replyEvidence.bsqs.map(proof => parseAttachmentGroup(publicOpeningAttachment(proof), Vrsn_2_0, "txt").group)
          : [],
      ],
    });
    yield* observer.reactor.processBytes(yield* call(() => collectPayload(framePayload(partialReply(0, true)))));
    assertEquals(observer.route.complete(xid), false, "one reply signature cannot release a complete result");
    yield* call(() => assertRejects(() => run(() => observer.route.finish(xid))));
    const completionWire = yield* call(() => collectPayload(framePayload(partialReply(1, false))));
    const completion = yield* observer.protocol.dispatch(parseBytes(completionWire)[0]);
    assertEquals(completion.decision?.kind, "accept", JSON.stringify(completion.decision));
    assertEquals(
      observer.route.complete(xid),
      true,
      "the second signature need not repeat previously authenticated proofs",
    );
    assertEquals((yield* observer.route.finish(xid)).kind, "accept");
    assertEquals(observer.hby.db.exns.get(pending.said!)!.raw, pending.raw);
    assertEquals(observer.hby.db.epsd.get(pending.said!)!.dts, deadline);
    assertEquals(observer.hby.db.erpy.get(pending.said!), null, "opening completion does not Admit");
    const acceptance = ipexExnBody(verifier.pre, "/ipex/admit", [], {
      prior: pending,
      message: "Accept repaired presentation",
      date: stamp,
    });
    for (const party of parties) {
      yield* party.reactor.processBytes(verifier.endorse(acceptance, { gvrsn: Vrsn_2_0 }));
      assertEquals(party.exc.complete(acceptance.said!), true);
    }

    // An explicit finish may update another live accepted view; ordinary intake cannot enrich history.
    const liveView = observer.hby.db.enst.get(live.said!), liveDeadline = observer.hby.db.epsd.get(live.said!)!.dts;
    assertEquals(observer.exc.verifyAccepted(live.said!, "/ipex/grant"), false);
    const liveXid = observer.route.approve(live.said!);
    presenter.route.approve(live.said!);
    yield* presenter.reactor.processBytes(observer.route.start(live.said!));
    const liveReply = presenter.route.outgoing.pull()!;
    yield* observer.reactor.processBytes(liveReply.msg);
    assertEquals(observer.route.complete(liveXid), true);
    assertEquals(
      observer.hby.db.enst.get(live.said!),
      liveView,
      "authenticated reply alone does not rewrite accepted proof",
    );
    assertEquals((yield* observer.route.finish(liveXid)).kind, "accept");
    assertEquals(observer.exc.verifyAccepted(live.said!, "/ipex/grant"), true);
    assertEquals(observer.hby.db.epsd.get(live.said!)!.dts, liveDeadline);
    assertEquals(loadNests(observer.hby.db, live.said!)[0].body.raw, credential.raw);
    for (const [index, party] of parties.entries()) {
      assertEquals(party.hby.db.enst.get(original.said!), historical[index].nests);
      assertEquals(party.hby.db.exns.get(original.said!)!.raw, historical[index].grant);
      assertEquals(party.hby.db.exns.get(admitted.said!)!.raw, historical[index].admit);
      assertEquals(party.hby.db.epsd.get(original.said!)!.dts, historical[index].deadline);
      assertEquals(party.hby.db.erpy.get(original.said!)!.qb64, admitted.said!);
    }
    assertEquals(
      verifier.mgr.getRegistryRoot(verifier.pre, rip.said!),
      null,
      "opening replies never transfer root custody",
    );
  });
});

Deno.test("v2 KERI/ACDC group Unblind elects a rootless sender after exact proof contributions", async () => {
  await run(function*() {
    const members: { hby: Habery; member: Hab }[] = [];
    for (const name of ["presenter-0", "presenter-1", "verifier-0", "verifier-1"]) {
      const hby = yield* createHabery({
        name: crypto.randomUUID(),
        temp: true,
        skipConfig: true,
        bran: `${name}UnblindPasscodeABC`,
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
    const groups = members.map((side, index) => {
      const signing = members.slice(index < 2 ? 0 : 2, index < 2 ? 2 : 4).map(peer => peer.member.pre);
      return side.hby.makeGroupHab("group", side.member, signing, signing, undefined, { isith: "2", nsith: "2" });
    });
    for (const start of [0, 2]) {
      const frame = parseBytes(messagize(groups[start].serder, {
        sigers: [...groups[start].sigers, ...groups[start + 1].sigers],
        gvrsn: Vrsn_2_0,
      }))[0];
      for (const side of members) {
        yield* dispatchEnvelope(envelopeFromFrame(frame, true), side.hby.rvy, side.hby.kevery);
      }
    }
    const actors: {
      hby: Habery;
      member: Hab;
      hab: Hab;
      store: RegistryStore;
      exc: Exchanger;
      route: Unblind;
      protocol: ProtocolProcessor;
      reactor: Reactor;
    }[] = [];
    for (const [index, side] of members.entries()) {
      const hab = groups[index].hab;
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
      const registry = new RegistryObserver(side.hby.db, store);
      const route = new Unblind({ hab, exc, registry, states: ["issued", "revoked", ""] });
      rvy.rtr.addRoute(Unblind.Route, route);
      const protocol = new ProtocolProcessor(
        kvy,
        rvy,
        exc,
        null,
        null,
        registry,
        output,
        cues,
        new QueryReplies(cues),
        route,
      );
      actors.push({ ...side, hab, store, exc, route, protocol, reactor: new Reactor(protocol) });
    }
    const presenters = actors.slice(0, 2), verifiers = actors.slice(2), sender = presenters[0], verifier = verifiers[0];
    const intakeAll = function*(wire: Uint8Array, local = false) {
      for (const side of actors) yield* side.reactor.processBytes(wire, { local });
    };
    const anchor = function*(event: SerderACDC, recipients = actors) {
      const state = sender.hab.kever!;
      const body = interactEvent(sender.hab.pre, state.said, state.sn + 1, [{
        i: event.regid ?? event.said!,
        s: event.sad!.n,
        d: event.said!,
      }], { version: Vrsn_2_0 });
      yield* intakeAll(
        messagize(body, { sigers: presenters.flatMap(side => side.hab.sign(body.raw, true)), gvrsn: Vrsn_2_0 }),
        true,
      );
      for (const side of recipients) yield* side.reactor.processBytes(event.raw);
    };
    const signed = (body: SerderKERI, peers: typeof presenters, nests: readonly CesrFrame[] = []): CesrFrame => ({
      body,
      gvrsn: Vrsn_2_0,
      nests: [...nests],
      attachments: messageAttachmentGroups({
        tsgs: [
          new TransIdxSigGroup(
            new Prefixer({ qb64: peers[0].hab.pre }),
            NumberPrimitive.fromNum(0n),
            new Diger({ qb64: peers[0].hab.kever!.lastEst.d }),
            peers.flatMap(side => side.hab.sign(body.raw, true)),
          ),
        ],
      }, Vrsn_2_0),
    });
    // Earlier group admission remains its own immutable historical view.
    const rip = regcept(sender.hab.pre);
    yield* anchor(rip);
    const root = new Salter({ raw: new TextEncoder().encode("public-test-root"), code: MtrDex.Salt_128 });
    presenters[1].hab.mgr.putRegistryRoot(sender.hab.pre, rip.said!, root);
    const credential = acdcmap(sender.hab.pre, {
      regid: rip.said!,
      attribute: { d: "", i: verifier.hab.pre, name: "Ada" },
    });
    const first = makeBlindState({ salt: root.qb64, sn: 1, acdc: credential.said!, state: "issued" });
    const event1 = blindate(rip.said!, rip.said!, first.d.nonce);
    yield* anchor(event1);
    const child: CesrFrame = {
      body: credential,
      gvrsn: Vrsn_2_0,
      attachments: [parseAttachmentGroup(publicOpeningAttachment(first), Vrsn_2_0, "txt").group],
    };
    const original = ipexExnBody(sender.hab.pre, "/ipex/grant", [credential], {
      kind: Kinds.json,
      recipient: verifier.hab.pre,
      message: "Earlier admitted group issuance",
    });
    yield* intakeAll(yield* call(() => collectPayload(framePayload(signed(original, presenters, [child])))));
    const admitted = ipexExnBody(verifier.hab.pre, "/ipex/admit", [], {
      prior: original,
      message: "Accept earlier issuance",
    });
    yield* intakeAll(yield* call(() => collectPayload(framePayload(signed(admitted, verifiers)))));
    const history = actors.map(side => ({
      grant: side.hby.db.exns.get(original.said!)!.raw,
      admit: side.hby.db.exns.get(admitted.said!)!.raw,
      nests: side.hby.db.enst.get(original.said!),
      deadline: side.hby.db.epsd.get(original.said!)!.dts,
    }));
    const proofs = [], events = [];
    let prior = event1;
    for (const sn of [2, 3, 4]) {
      const opening = makeBlindState({
        salt: root.qb64,
        sn,
        acdc: sn === 2 ? credential.said! : "",
        state: sn === 2 ? "issued" : "",
      });
      const event = blindate(rip.said!, prior.said!, opening.d.nonce, { sn });
      yield* anchor(event, verifiers);
      proofs.push(opening);
      events.push(event);
      prior = event;
    }
    const grant = ipexExnBody(sender.hab.pre, "/ipex/grant", [credential], {
      kind: Kinds.json,
      recipient: verifier.hab.pre,
      message: "Exact stale group presentation",
    });
    yield* intakeAll(yield* call(() => collectPayload(framePayload(signed(grant, presenters, [child])))));
    const deadlines = actors.map(side => side.hby.db.epsd.get(grant.said!)!.dts);
    for (const side of verifiers) assertEquals(side.exc.complete(grant.said!), false);
    for (const side of [presenters[1], ...verifiers]) side.route.approve(grant.said!);

    // Setup approval permits ordinary contributions; only a complete own query is delivered to the peer.
    const queryProposal = verifier.route.start(grant.said!);
    assertEquals(verifier.route.outgoing.pull()!.kin, "sign");
    const queryContribution = verifiers[1].route.contribute(grant.said!, queryProposal);
    assertEquals(parseBytes(queryContribution)[0].body.raw, parseBytes(queryProposal)[0].body.raw);
    for (const side of verifiers) {
      yield* side.reactor.processBytes(queryProposal);
      assertEquals([...side.route.outgoing].filter(cue => cue.kin === "query"), []);
      yield* side.reactor.processBytes(queryContribution);
    }
    const query = verifier.route.outgoing.pull()!;
    assertEquals(query.kin, "query");
    assertEquals(query.dest, sender.hab.pre);
    const request = parseBytes(query.msg)[0];
    assertEquals((envelopeFromFrame(request).serder.sad!.q as Record<string, unknown>).re, {
      [rip.said!]: events.map(event => event.said!),
    });
    assertEquals(request.nests!.map(nest => nest.body.raw), events.map(event => event.raw));
    assertEquals(sender.route.processQuery(envelopeFromFrame(request)).kind, "drop");
    assertEquals(sender.store.head(rip.said!)!.qb64, event1.said!, "unapproved receipt does not import or disclose");
    sender.route.approve(grant.said!);
    for (const side of presenters) {
      yield* side.reactor.processBytes(query.msg);
      assertEquals(side.store.head(rip.said!)!.qb64, events[2].said!);
      assertEquals(side.route.outgoing.length, 0, "a group query does not author competing reply proposals");
    }

    // Index 1 supplies proofs; rootless index 0 independently validates the exact proposal before signing.
    const proposal = presenters[1].route.respond(grant.said!);
    assertEquals(presenters[1].route.outgoing.pull()!.kin, "sign");
    const frame = parseBytes(proposal)[0], evidence = envelopeFromFrame(frame);
    assertEquals(evidence.bsqs.map(opening => opening.d.nonce).sort(), proofs.map(opening => opening.d.nonce).sort());
    const excess: CesrFrame = {
      ...frame,
      attachments: [...frame.attachments, parseAttachmentGroup(publicOpeningAttachment(first), Vrsn_2_0, "txt").group],
    };
    const invalid = yield* call(() => collectPayload(framePayload(excess)));
    assertThrows(
      () => sender.route.contribute(grant.said!, invalid),
      Error,
      undefined,
      "already carried proof is excess disclosure",
    );
    const contribution = sender.route.contribute(grant.said!, proposal);
    assertEquals(parseBytes(contribution)[0].body.raw, frame.body.raw);
    assertEquals(
      envelopeFromFrame(parseBytes(contribution)[0]).bsqs.map(opening => opening.d.nonce),
      evidence.bsqs.map(opening => opening.d.nonce),
    );
    for (const side of presenters) {
      yield* side.reactor.processBytes(proposal);
      assertEquals(
        [...side.route.outgoing].filter(cue => cue.kin === "reply"),
        [],
        "one signer cannot release a peer reply",
      );
      yield* side.reactor.processBytes(contribution);
      assertEquals(side.route.complete(grant.said!), true);
    }
    assertEquals(presenters[1].route.outgoing.length, 0, "root custody does not override the signature election");
    const response = sender.route.outgoing.pull()!;
    assertEquals(response.kin, "reply");
    assertEquals(response.dest, verifier.hab.pre);
    assertEquals(
      sender.hab.mgr.getRegistryRoot(sender.hab.pre, rip.said!),
      null,
      "elected delivery requires no root custody",
    );
    assertEquals(new TextDecoder().decode(response.msg).includes(root.qb64), false);
    assertEquals(new TextDecoder().decode(response.msg).includes(first.d.qb64), false);
    for (const side of verifiers) {
      yield* side.reactor.processBytes(response.msg);
      assertEquals(side.route.complete(grant.said!), true);
    }

    // All four owners finish the same retained presentation; a separate threshold still gates Admit.
    for (const [index, side] of actors.entries()) {
      assertEquals((yield* side.route.finish(grant.said!)).kind, "accept");
      assertEquals(side.hby.db.exns.get(grant.said!)!.raw, grant.raw);
      assertEquals(side.hby.db.epsd.get(grant.said!)!.dts, deadlines[index]);
      assertEquals(side.hby.db.erpy.get(grant.said!), null);
      assertEquals(side.hby.db.enst.get(original.said!), history[index].nests);
      assertEquals(side.hby.db.exns.get(original.said!)!.raw, history[index].grant);
      assertEquals(side.hby.db.exns.get(admitted.said!)!.raw, history[index].admit);
      assertEquals(side.hby.db.epsd.get(original.said!)!.dts, history[index].deadline);
      assertEquals(
        side.hab.mgr.getRegistryRoot(side.hab.pre, rip.said!)?.qb64 ?? null,
        side === presenters[1] ? root.qb64 : null,
      );
    }
    const acceptance = ipexExnBody(verifier.hab.pre, "/ipex/admit", [], {
      prior: grant,
      message: "Separate group presentation acceptance",
    });
    yield* intakeAll(verifier.hab.endorse(acceptance, { gvrsn: Vrsn_2_0 }));
    for (const side of actors) assertEquals(side.exc.complete(acceptance.said!), false);
    yield* intakeAll(verifiers[1].hab.endorse(acceptance, { gvrsn: Vrsn_2_0 }));
    for (const side of actors) {
      assertEquals(side.exc.complete(acceptance.said!), true);
      assertEquals(side.hby.db.erpy.get(grant.said!)!.qb64, acceptance.said!);
      assertEquals(side.hby.db.enst.get(original.said!), history[actors.indexOf(side)].nests);
    }
  });
});
