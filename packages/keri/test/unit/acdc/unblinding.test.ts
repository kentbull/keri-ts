/** Real encrypted owners follow KERIpy test_unblind_routes.py without provisioning or transport claims. */
import {
  type CesrFrame,
  collectPayload,
  framePayload,
  Kinds,
  makeBlindState,
  MtrDex,
  parseAttachmentGroup,
  parseBytes,
  Salter,
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
import { messageAttachmentGroups } from "../../../src/core/protocol-serialization.ts";
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
