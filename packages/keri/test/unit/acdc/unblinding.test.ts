import { createProtocolHandler, startServer } from "@keri-ts/hosting";
import { createHabery } from "../../../src/app/identity/lmdb-habery.ts";
import { openLmdbRegistry } from "../../../src/db/lmdb-stores.ts";
/** Real encrypted owners repair exact presentations through the maintained finite HTTP workflow. */
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
import { call, ensure, run, sleep, spawn } from "effection";
import { assert, assertEquals, assertExists, assertNotEquals, assertRejects, assertThrows } from "jsr:@std/assert";
import { loadNests } from "../../../db.ts";
import { acdcmap, blindate, regcept } from "../../../src/acdc/messaging.ts";
import { publicOpeningAttachment, type RegistryStore } from "../../../src/acdc/registering.ts";
import { Regery } from "../../../src/acdc/registraring.ts";
import { Unblind } from "../../../src/acdc/unblinding.ts";
import type { Exchanger } from "../../../src/app/exchanges/exchanging.ts";
import { type Hab, type Habery } from "../../../src/app/identity/habbing.ts";
import { ipexExnBody } from "../../../src/app/ipex/ipex-building.ts";
import {
  answerUnblind,
  requestUnblind,
  waitForUnblinding,
} from "../../../src/app/ipex/unblinding-workflow.ts";
import { isLocalGroupHab, localGroupMember } from "../../../src/app/multisig/group-members.ts";
import { dispatchEnvelope, envelopeFromFrame } from "../../../src/app/protocol/parsering.ts";
import type { ProtocolProcessor } from "../../../src/app/protocol/protocol-processing.ts";
import type { Reactor } from "../../../src/app/protocol/reactor.ts";
import { type AgentRuntime, createAgentRuntime, runAgentRuntime } from "../../../src/app/runtime/agent-runtime.ts";
import { systemClock } from "../../../src/app/runtime/runtime-clock.ts";
import { readCesrRequestBytes } from "../../../src/app/transport/cesr-http.ts";
import { FetchHttpClient } from "../../../src/app/transport/http-client.ts";
import { TransIdxSigGroup } from "../../../src/core/dispatch.ts";
import { PresentationClosedError, ValidationError } from "../../../src/core/errors.ts";
import { consoleLogger } from "../../../src/core/logger.ts";
import { interact as interactEvent, reply } from "../../../src/core/protocol-eventing.ts";
import { messageAttachmentGroups, messagize } from "../../../src/core/protocol-serialization.ts";
import { Roles } from "../../../src/core/roles.ts";
import { makeNowIso8601 } from "../../../src/time/mod.ts";

const ST = ["issued", "revoked", ""];

/** Unblind through `runtime.operations.unblinding` alone (no CLI code); `listen` hosts the member's endpoint. */
function* libraryUnblind(
  runtime: AgentRuntime,
  hab: Hab,
  grant: string,
  { timeoutMs, proposer, listen, states, parties }: {
    timeoutMs: number;
    proposer?: string;
    listen?: number;
    /** Parties of one Unblind that have not settled; a host stays up until every one has, as real hosts do. */
    parties?: { unsettled: number };
    states?: readonly string[];
  },
) {
  const ops = runtime.operations!.unblinding, group = isLocalGroupHab(runtime.hby, hab);
  const member = group ? localGroupMember(runtime.hby, hab.pre!) : hab;
  const requester = runtime.exc.retainedInput(grant)?.serder.sad?.ri === hab.pre;
  const options = { states, proposer };
  const hosted = listen === undefined ? null : yield* spawn(() =>
    startServer(listen, consoleLogger, runtime, {
      hostname: "127.0.0.1",
      serviceHab: member,
      hostedPrefixes: [...new Set([member.pre!, hab.pre!])],
    })
  );
  try {
    const begun = requester ? requestUnblind(ops, grant, options) : group ? answerUnblind(ops, grant, options) : null;
    const host = yield* spawn(() => runAgentRuntime(runtime, { hab: member, pollMailbox: true }));
    let counted = false;
    try {
      const stop = Date.now() + timeoutMs;
      while (!begun && !ops.liveOf(grant) && !ops.settledOf(grant)) {
        if (Date.now() > stop) throw new Error("no Unblind began");
        yield* sleep(20);
      }
      const { status } = yield* waitForUnblinding(ops, grant, { timeoutMs: Math.max(1, stop - Date.now()) });
      if (status.state !== "done") throw new ValidationError(`Unblind did not complete: ${JSON.stringify(status)}`);
      if (parties) {
        parties.unsettled--;
        counted = true;
        while (parties.unsettled > 0 && Date.now() < stop) yield* sleep(20);
      }
      return { grant, completed: true, admitted: false };
    } finally {
      if (parties && !counted) parties.unsettled--;
      yield* host.halt();
    }
  } finally {
    if (hosted) yield* hosted.halt();
  }
}

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
      runtime: AgentRuntime;
    }[] = [];
    for (const [hby, hab] of [[senderHby, sender], [verifierHby, verifier]] as const) {
      const baser = yield* openLmdbRegistry({ name: crypto.randomUUID(), temp: true });
      yield* ensure(() => baser.close(true));
      const rgy = new Regery(hby, baser);
      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock, {
        acdc: rgy,
        kram: { enabled: true, caches: { "~": [1000, 5000, 60000, 300000, 5000, 60000, 300000] } },
      });
      yield* ensure(() => runtime.close());
      assert(runtime.ipex);
      parties.push({
        hby,
        hab,
        store: rgy.store,
        exc: runtime.exc,
        route: runtime.ipex!.unblind(hab),
        protocol: runtime.protocol,
        reactor: runtime.reactor,
        runtime,
      });
    }
    const [presenter, observer] = parties;
    const queries: CesrFrame[] = [], replies: CesrFrame[] = [];
    for (const side of parties) {
      const handler = createProtocolHandler(side.runtime, { hostedPrefixes: [side.hab.pre], serviceHab: side.hab });
      const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, async request => {
        const incoming = request.method === "POST" ? parseBytes(await readCesrRequestBytes(request.clone())) : [];
        const response = await handler(request);
        for (const frame of incoming) {
          if (envelopeFromFrame(frame).serder.route === Unblind.Route) {
            if (frame.body.ilk === "qry") queries.push(frame);
            if (frame.body.ilk === "rpy") replies.push(frame);
          }
        }
        return response;
      });
      yield* ensure(() =>
        call(async () => {
          await server.shutdown();
          await handler.close?.();
        })
      );
      const location = side.hab.makeLocScheme(`http://127.0.0.1:${server.addr.port}/`, side.hab.pre, "http");
      const controller = side.hab.makeEndRole(side.hab.pre, Roles.controller, true);
      for (const peer of parties) {
        // Public endpoint authentication follows the ordinary KEL intake below.
        if (peer !== side) {
          for (const wire of side.hby.db.clonePreIter(side.hab.pre, 0)) {
            yield* peer.reactor.processBytes(wire);
          }
        }
        yield* peer.reactor.processBytes(location);
        yield* peer.reactor.processBytes(controller);
      }
    }
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
      deadline: party.exc.exchangeDeadline(original),
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
        acdc: sn === 3 ? credential.said! : "",
        state: sn === 3 ? "issued" : "",
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
    const second = yield* presentation("Second pending presentation");
    const deadline = observer.exc.exchangeDeadline(pending);
    assertThrows(() => presenter.route.approve(original.said!), Error, undefined, "an admitted Grant is terminal");
    // The verifier's own request after its Admit is refused for that reason, as a typed error.
    assertThrows(
      () => observer.route.approve(original.said!),
      PresentationClosedError,
      "Unblind must be requested before the response is made",
    );
    const xid = observer.route.approve(pending.said!);
    const started = observer.route.start(pending.said!);
    assertEquals(observer.route.start(pending.said!), started, "retry keeps the exact signed query");
    // A send-time renewal (KERIpy requery) re-signs only the query's own time, SAID and signatures.
    yield* sleep(2);
    const query = observer.route.requery(xid), requested = parseBytes(query)[0];
    const before = envelopeFromFrame(parseBytes(started)[0]).serder, after = envelopeFromFrame(requested).serder;
    assertNotEquals(after.said, before.said);
    assertEquals(after.sad!.q, before.sad!.q);
    assertEquals(requested.nests!.map(nest => nest.body.raw), parseBytes(started)[0].nests!.map(nest => nest.body.raw));
    assertEquals(observer.route.start(pending.said!), query, "the renewal becomes the outstanding query");
    assertThrows(() => presenter.route.requery(xid), Error, "no local approval");
    const requestedEvents = (envelopeFromFrame(requested).serder.sad!.q as Record<string, unknown>).re;
    assertEquals(requestedEvents, { [rip.said!]: events.map(event => event.said!) });
    assertEquals(requested.nests!.map(nest => nest.body.raw), events.map(event => event.raw));
    assertEquals(envelopeFromFrame(requested).bsqs, [], "query carries public state, never openings");
    yield* presenter.reactor.processBytes(query);
    assertEquals(presenter.route.outgoing.length, 1, "the discloser answers an authenticated query for its live Grant");
    assertEquals(presenter.store.head(rip.said!)!.qb64, events[2].said!, "the authenticated suffix is imported");
    assertEquals(presenter.route.approve(pending.said!), xid);
    {
      // The state vocabulary belongs to each approved operation, not to the owner.
      const frozen = (id: string) =>
        (presenter.route as unknown as { operations: Map<string, { states: string[] }> }).operations.get(id)!.states;
      const secondXid = presenter.route.approve(second.said!, { states: ["issued"] });
      assertEquals(frozen(xid), ["issued", "revoked", ""], "default vocabulary");
      assertEquals(frozen(secondXid), ["issued"], "explicit vocabulary on the same owner");
      assertEquals(presenter.route.approve(second.said!), secondXid, "repeat without states keeps the frozen ones");
      assertEquals(frozen(secondXid), ["issued"]);
      assertThrows(
        () => presenter.route.approve(second.said!, { states: ["revoked"] }),
        Error,
        "different states",
      );
      assertThrows(
        () => presenter.route.approve(pending.said!, { states: ["bogus", 1 as unknown as string] }),
        Error,
        "state strings",
      );
    }
    yield* presenter.reactor.processBytes(query);
    assertEquals(
      presenter.store.head(rip.said!)!.qb64,
      events[2].said!,
      "authenticated query recovers the public suffix",
    );
    const response = presenter.route.outgoing.pull()!;
    assertEquals(response.dest, verifier.pre);
    const minimalReply = parseBytes(response.msg)[0], minimalEvidence = envelopeFromFrame(minimalReply);
    assertEquals((minimalEvidence.serder.sad!.a as Record<string, unknown>).re, {
      [rip.said!]: events.slice(1).map(event => event.said!),
    });
    assertEquals(minimalReply.nests ?? [], []);
    assertEquals(
      minimalEvidence.bsqs.map(proof => proof.d.nonce).sort(),
      proofs.slice(1).map(proof => proof.d.nonce).sort(),
    );
    // An independent responder may disclose every requested event, including the earlier vacuous one.
    const fullBody = reply(Unblind.Route, { x: xid, re: requestedEvents }, { pre: sender.pre, pvrsn: Vrsn_2_0 });
    const replyFrame = parseBytes(sender.endorse(fullBody, { gvrsn: Vrsn_2_0 }))[0];
    replyFrame.attachments = [
      ...replyFrame.attachments ?? [],
      ...proofs.map(proof => parseAttachmentGroup(publicOpeningAttachment(proof), Vrsn_2_0, "txt").group),
    ];
    const replyEvidence = envelopeFromFrame(replyFrame);
    assertEquals(replyEvidence.bsss, []);
    assertEquals(new TextDecoder().decode(response.msg).includes(root.qb64), false);
    assertEquals(
      new TextDecoder().decode(response.msg).includes(first.d.qb64),
      false,
      "already carried BUP1 opening is omitted",
    );
    const signature = replyEvidence.tsgs[0];
    const partialReply = (index: number, includeProofs: boolean): CesrFrame => ({
      ...replyFrame,
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
    assertThrows(() => observer.route.openings(xid), Error, "not been authenticated", "partial proofs stay unreadable");
    yield* call(() => assertRejects(() => run(() => observer.route.finish(xid))));
    const completionWire = yield* call(() => collectPayload(framePayload(partialReply(1, false))));
    const completion = yield* observer.protocol.dispatch(parseBytes(completionWire)[0]);
    assertEquals(completion.decision?.kind, "accept", JSON.stringify(completion.decision));
    assertEquals(
      observer.route.complete(xid),
      true,
      "the second signature need not repeat previously authenticated proofs",
    );
    // KERIpy Unblind.openings: the authenticated reply's verified openings in selected order, as a copy.
    const openings = observer.route.openings(xid);
    assertEquals([...openings.keys()], events.map(event => event.said!));
    assertEquals([...openings.values()].map(opening => opening.d.nonce), proofs.map(proof => proof.d.nonce));
    openings.clear();
    assertEquals(observer.route.openings(xid).size, events.length);
    assertThrows(() => observer.route.openings("Eunapproved"), Error, "no local approval");
    assertThrows(() => observer.route.requery(xid), Error, "already received");
    assertEquals((yield* observer.route.finish(xid)).kind, "accept");
    assertEquals(observer.hby.db.exns.get(pending.said!)!.raw, pending.raw);
    assertEquals(observer.exc.exchangeDeadline(pending), deadline);
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
    const liveView = observer.hby.db.enst.get(live.said!), liveDeadline = observer.exc.exchangeDeadline(live);
    assertEquals(observer.exc.verifyAccepted(live.said!, "/ipex/grant"), false);
    assertEquals(observer.hby.db.enst.get(live.said!), liveView);
    const liveRequest = yield* spawn(() =>
      libraryUnblind(observer.runtime, observer.hab, live.said!, { timeoutMs: 15000, states: ST })
    );
    const liveRelease = yield* libraryUnblind(presenter.runtime, presenter.hab, live.said!, {
      timeoutMs: 15000,
      states: ST,
    });
    assertEquals((yield* liveRequest).completed, true);
    assertEquals(liveRelease.admitted, false);
    assertEquals(observer.exc.verifyAccepted(live.said!, "/ipex/grant"), true);
    assertEquals(observer.exc.exchangeDeadline(live), liveDeadline);
    assertEquals(loadNests(observer.hby.db, live.said!)[0].body.raw, credential.raw);
    for (const [index, party] of parties.entries()) {
      assertEquals(party.hby.db.enst.get(original.said!), historical[index].nests);
      assertEquals(party.hby.db.exns.get(original.said!)!.raw, historical[index].grant);
      assertEquals(party.hby.db.exns.get(admitted.said!)!.raw, historical[index].admit);
      assertEquals(party.exc.exchangeDeadline(original), historical[index].deadline);
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
      runtime: AgentRuntime;
    }[] = [];
    for (const [index, side] of members.entries()) {
      const hab = groups[index].hab;
      const baser = yield* openLmdbRegistry({ name: crypto.randomUUID(), temp: true });
      yield* ensure(() => baser.close(true));
      const rgy = new Regery(side.hby, baser);
      const runtime = yield* createAgentRuntime(side.hby, new FetchHttpClient(), systemClock, {
        acdc: rgy,
        // These members stay rootless on purpose; the always-on replicator would otherwise copy the root to them.
        registryRoots: "refuse",
        kram: { enabled: true, caches: { "~": [1000, 5000, 60000, 300000, 5000, 60000, 300000] } },
      });
      yield* ensure(() => runtime.close());
      assert(runtime.ipex);
      actors.push({
        ...side,
        hab,
        store: rgy.store,
        exc: runtime.exc,
        route: runtime.ipex!.unblind(hab),
        protocol: runtime.protocol,
        reactor: runtime.reactor,
        runtime,
      });
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
    const queries: CesrFrame[] = [], replies: CesrFrame[] = [];
    let finiteListener!: { port: number; stop: () => Promise<void> };
    for (const side of actors) {
      const handler = createProtocolHandler(side.runtime, {
        hostedPrefixes: [side.member.pre, side.hab.pre],
        serviceHab: side.member,
      });
      const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, async request => {
        const incoming = request.method === "POST" ? parseBytes(await readCesrRequestBytes(request.clone())) : [];
        const response = await handler(request);
        for (const frame of incoming) {
          if (envelopeFromFrame(frame).serder.route === Unblind.Route) {
            if (frame.body.ilk === "qry") queries.push(frame);
            if (frame.body.ilk === "rpy") replies.push(frame);
          }
        }
        return response;
      });
      let stopped = false;
      const stop = async () => {
        if (stopped) return;
        stopped = true;
        await server.shutdown();
        await handler.close?.();
      };
      yield* ensure(() => call(stop));
      if (side === verifiers[1]) finiteListener = { port: server.addr.port, stop };
      yield* intakeAll(side.member.makeLocScheme(`http://127.0.0.1:${server.addr.port}/`, side.member.pre, "http"));
      yield* intakeAll(side.member.makeEndRole(side.member.pre, Roles.controller, true));
      const controller = reply("/end/role/add", {
        cid: side.hab.pre,
        role: Roles.controller,
        eid: side.member.pre,
      }, { pre: side.hab.pre, pvrsn: Vrsn_2_0 });
      yield* intakeAll(
        yield* call(() =>
          collectPayload(framePayload(signed(controller, presenters.includes(side) ? presenters : verifiers)))
        ),
      );
    }
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
      deadline: side.runtime.exc.exchangeDeadline(original),
    }));
    const proofs = [], events = [];
    let prior = event1;
    for (const sn of [2, 3, 4]) {
      const opening = makeBlindState({
        salt: root.qb64,
        sn,
        acdc: sn === 2 || sn === 4 ? credential.said! : "",
        state: sn === 2 ? "issued" : sn === 4 ? "revoked" : "",
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
    const deadlines = actors.map(side => side.runtime.exc.exchangeDeadline(grant));
    for (const side of verifiers) assertEquals(side.exc.complete(grant.said!), false);
    // The finite command replaces its fixture listener on the same signed endpoint.
    yield* call(finiteListener.stop);
    // Start the ordinary nonproposer command first; one setup cannot publish a group query.
    // A group member names the signing member that authors the reply; without one it is told so.
    assertThrows(
      () => answerUnblind(sender.runtime.operations!.unblinding, grant.said!),
      ValidationError,
      "current signing member proposer",
    );
    const parties = { unsettled: 4 };
    const peerRequest = yield* spawn(() =>
      libraryUnblind(verifiers[1].runtime, verifiers[1].hab, grant.said!, {
        timeoutMs: 15000,
        parties,
        proposer: verifier.member.pre,
        listen: finiteListener.port,
      })
    );
    yield* sleep(100);
    assertEquals(queries, []);
    const request = yield* spawn(() =>
      libraryUnblind(verifier.runtime, verifier.hab, grant.said!, {
        timeoutMs: 15000,
        parties,
        proposer: verifier.member.pre,
      })
    );
    while (!queries.length) yield* sleep(10);
    const query = queries[0], queryEvidence = envelopeFromFrame(query);
    assertEquals((queryEvidence.serder.sad!.q as Record<string, unknown>).re, {
      [rip.said!]: events.map(event => event.said!),
    });
    assertEquals(query.nests!.map(nest => nest.body.raw), events.map(event => event.raw));
    assertEquals(queryEvidence.tsgs.flatMap(group => group.sigers.map(siger => siger.index)).sort(), [0, 1]);
    // A group discloser needs member contributions before any reply exists; none has been authored yet.
    assertEquals(replies, []);

    // Index 1 authors the proof; rootless index 0 validates and contributes under its one setup approval.
    const peerRelease = yield* spawn(() =>
      libraryUnblind(sender.runtime, sender.hab, grant.said!, {
        timeoutMs: 15000,
        parties,
        proposer: presenters[1].member.pre,
      })
    );
    yield* sleep(100);
    assertEquals(replies, [], "one approved presenter cannot release a threshold reply");
    const release = yield* spawn(() =>
      libraryUnblind(presenters[1].runtime, presenters[1].hab, grant.said!, {
        timeoutMs: 15000,
        parties,
        proposer: presenters[1].member.pre,
      })
    );
    const completed = [yield* request, yield* peerRequest, yield* release, yield* peerRelease];
    for (const result of completed) assertEquals([result.completed, result.admitted], [true, false]);
    const reclaimed = Deno.listen({ hostname: "127.0.0.1", port: finiteListener.port });
    reclaimed.close();
    // A selected-Grant failure after binding must also release the command's listener.
    yield* call(() =>
      assertRejects(() =>
        run(() =>
          libraryUnblind(verifiers[1].runtime, verifiers[1].hab, "missing", {
            timeoutMs: 15000,
            proposer: verifier.member.pre,
            listen: finiteListener.port,
          })
        )
      )
    );
    const afterFailure = Deno.listen({ hostname: "127.0.0.1", port: finiteListener.port });
    afterFailure.close();
    assert(queries.length > 0 && replies.length > 0, "finite commands deliver actual HTTP query and reply messages");
    for (const repeated of queries) assertEquals(repeated.body.raw, query.body.raw);
    const response = replies[0], evidence = envelopeFromFrame(response);
    // The newest update is a revocation the group derived from its registry root; it binds the credential's state, so
    // it is the one opening the reply needs.
    assertEquals(evidence.bsqs.map(opening => opening.d.nonce), [proofs.at(-1)!.d.nonce]);
    assertEquals(evidence.bsss, []);
    assertEquals(response.nests ?? [], []);
    const indices = evidence.tsgs.flatMap(group => group.sigers.map(siger => siger.index)).sort();
    assertEquals(indices, [0, 1], "the verified minimum index elects rootless member zero for delivery");
    assertEquals(sender.hab.mgr.getRegistryRoot(sender.hab.pre, rip.said!), null);
    const responseWire = yield* call(() => collectPayload(framePayload(response)));
    assertEquals(new TextDecoder().decode(responseWire).includes(root.qb64), false);
    assertEquals(new TextDecoder().decode(responseWire).includes(first.d.qb64), false);

    // All four owners finish the same retained presentation; a separate threshold still gates Admit.
    for (const [index, side] of actors.entries()) {
      assertEquals(side.exc.verifyAccepted(grant.said!, "/ipex/grant"), true);
      assertEquals(side.hby.db.exns.get(grant.said!)!.raw, grant.raw);
      assertEquals(side.runtime.exc.exchangeDeadline(grant), deadlines[index]);
      assertEquals(side.hby.db.erpy.get(grant.said!), null);
      assertEquals(side.hby.db.enst.get(original.said!), history[index].nests);
      assertEquals(side.hby.db.exns.get(original.said!)!.raw, history[index].grant);
      assertEquals(side.hby.db.exns.get(admitted.said!)!.raw, history[index].admit);
      assertEquals(side.runtime.exc.exchangeDeadline(original), history[index].deadline);
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

// KRAM records an accepted request as seen, so its resend is a replay and a group requester cannot re-date it:
// the request the discloser owes a reply to is persisted, and a reopened owner answers it with no resend.
for (const keys of [1, 2]) {
  Deno.test(`a discloser answers a request received before its owner was lost, with no resend (${keys} requester key(s))`, async () => {
    await run(function*() {
      const stamp = makeNowIso8601(new Date());
      const hbys = [];
      for (const bran of ["PresenterPasscodeABCD", "VerifierPasscodeABCDE"]) {
        const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true, bran });
        yield* ensure(() => hby.close(true));
        hbys.push(hby);
      }
      const [senderHby, verifierHby] = hbys;
      const sender = senderHby.makeHab("presenter", undefined, { icount: 2, isith: "2", ncount: 2, nsith: "2" });
      const verifier = verifierHby.makeHab("verifier", undefined, {
        icount: keys,
        isith: `${keys}`,
        ncount: keys,
        nsith: `${keys}`,
      });
      const parties = [];
      for (const [hby, hab] of [[senderHby, sender], [verifierHby, verifier]] as const) {
        const baser = yield* openLmdbRegistry({ name: crypto.randomUUID(), temp: true });
        yield* ensure(() => baser.close(true));
        const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock, {
          acdc: new Regery(hby, baser),
          kram: { enabled: true, caches: { "~": [1000, 5000, 60000, 300000, 5000, 60000, 300000] } },
        });
        yield* ensure(() => runtime.close());
        parties.push({ hby, hab, runtime, store: runtime.ipex!.unblind(hab) });
      }
      const [presenter, observer] = parties;
      for (const wire of senderHby.db.clonePreIter(sender.pre, 0)) yield* observer.runtime.reactor.processBytes(wire);
      for (const wire of verifierHby.db.clonePreIter(verifier.pre, 0)) {
        yield* presenter.runtime.reactor.processBytes(wire);
      }
      const rip = regcept(sender.pre, { stamp });
      yield* observer.runtime.reactor.processBytes(sender.interact({ data: [{ i: rip.said!, s: "0", d: rip.said! }] }));
      for (const party of parties) yield* party.runtime.reactor.processBytes(rip.raw);
      const root = new Salter({ raw: new TextEncoder().encode("public-test-root"), code: MtrDex.Salt_128 });
      sender.mgr.putRegistryRoot(sender.pre, rip.said!, root);
      const credential = acdcmap(sender.pre, { regid: rip.said!, attribute: { d: "", i: verifier.pre, name: "Ada" } });
      const first = makeBlindState({ salt: root.qb64, sn: 1, acdc: credential.said!, state: "issued" });
      const event1 = blindate(rip.said!, rip.said!, first.d.nonce, { stamp });
      yield* observer.runtime.reactor.processBytes(
        sender.interact({ data: [{ i: rip.said!, s: "1", d: event1.said! }] }),
      );
      for (const party of parties) yield* party.runtime.reactor.processBytes(event1.raw);
      const child: CesrFrame = {
        body: credential,
        gvrsn: Vrsn_2_0,
        attachments: [parseAttachmentGroup(publicOpeningAttachment(first), Vrsn_2_0, "txt").group],
      };
      const grant = ipexExnBody(sender.pre, "/ipex/grant", [credential], {
        kind: Kinds.json,
        recipient: verifier.pre,
        message: "Live presentation",
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
      for (const party of parties) yield* party.runtime.reactor.processBytes(wire);
      // Only the verifier learns the later TEL suffix, which its query then carries.
      let prior = event1;
      for (const sn of [2, 3]) {
        const proof = makeBlindState({
          salt: root.qb64,
          sn,
          acdc: sn === 3 ? credential.said! : "",
          state: sn === 3 ? "issued" : "",
        });
        const event = blindate(rip.said!, prior.said!, proof.d.nonce, { sn, stamp });
        yield* observer.runtime.reactor.processBytes(
          sender.interact({ data: [{ i: rip.said!, s: sn.toString(16), d: event.said! }] }),
        );
        yield* observer.runtime.reactor.processBytes(event.raw);
        prior = event;
      }
      observer.store.approve(grant.said!);
      const query = observer.store.start(grant.said!);

      // The presenter's runtime takes the request; its reply is owed but nothing has driven it yet.
      yield* presenter.runtime.reactor.processBytes(query);
      assertExists(presenter.hby.db.heldu.get([sender.pre!, grant.said!]), "the accepted request is persisted");
      const resend = yield* presenter.runtime.protocol.dispatch(parseBytes(query)[0]);
      assertEquals(resend.decision, { kind: "drop", reason: "replay" }, "the identical resend cannot help");

      // The owner and its memory are lost; the reopened one is owed the reply and answers with no resend.
      presenter.runtime.ipex!.release(sender.pre!);
      const reopened = [...presenter.runtime.ipex!.unblindOwners()].find(owner => owner.hab.pre === sender.pre);
      assertExists(reopened, "an owner is made for the identifier that owes a reply");
      assertEquals(reopened.awaitingReply(), [{ xid: grant.said!, grant: grant.said! }]);
      assertEquals(reopened.outgoing.pull()?.kin, "reply");
    });
  });
}

Deno.test("a no-progress retry of a waiting Grant commits no write", async () => {
  await run(function*() {
    const stamp = makeNowIso8601(new Date());
    const hbys = [];
    for (const bran of ["PresenterPasscodeABCD", "VerifierPasscodeABCDE"]) {
      const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true, bran });
      yield* ensure(() => hby.close(true));
      hbys.push(hby);
    }
    const [senderHby, verifierHby] = hbys;
    const sender = senderHby.makeHab("presenter", undefined, { icount: 2, isith: "2", ncount: 2, nsith: "2" });
    const verifier = verifierHby.makeHab("verifier", undefined, {
      icount: 2,
      isith: "2",
      ncount: 2,
      nsith: "2",
    });
    const parties = [];
    for (const [hby, hab] of [[senderHby, sender], [verifierHby, verifier]] as const) {
      const baser = yield* openLmdbRegistry({ name: crypto.randomUUID(), temp: true });
      yield* ensure(() => baser.close(true));
      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock, {
        acdc: new Regery(hby, baser),
        kram: { enabled: true, caches: { "~": [1000, 5000, 60000, 300000, 5000, 60000, 300000] } },
      });
      yield* ensure(() => runtime.close());
      parties.push({ hby, hab, runtime, store: runtime.ipex!.unblind(hab) });
    }
    const [presenter, observer] = parties;
    for (const wire of senderHby.db.clonePreIter(sender.pre, 0)) yield* observer.runtime.reactor.processBytes(wire);
    for (const wire of verifierHby.db.clonePreIter(verifier.pre, 0)) {
      yield* presenter.runtime.reactor.processBytes(wire);
    }
    const rip = regcept(sender.pre, { stamp });
    yield* observer.runtime.reactor.processBytes(sender.interact({ data: [{ i: rip.said!, s: "0", d: rip.said! }] }));
    for (const party of parties) yield* party.runtime.reactor.processBytes(rip.raw);
    const root = new Salter({ raw: new TextEncoder().encode("public-test-root"), code: MtrDex.Salt_128 });
    sender.mgr.putRegistryRoot(sender.pre, rip.said!, root);
    const credential = acdcmap(sender.pre, { regid: rip.said!, attribute: { d: "", i: verifier.pre, name: "Ada" } });
    const first = makeBlindState({ salt: root.qb64, sn: 1, acdc: credential.said!, state: "issued" });
    const event1 = blindate(rip.said!, rip.said!, first.d.nonce, { stamp });
    yield* observer.runtime.reactor.processBytes(
      sender.interact({ data: [{ i: rip.said!, s: "1", d: event1.said! }] }),
    );
    for (const party of parties) yield* party.runtime.reactor.processBytes(event1.raw);
    const child: CesrFrame = {
      body: credential,
      gvrsn: Vrsn_2_0,
      attachments: [parseAttachmentGroup(publicOpeningAttachment(first), Vrsn_2_0, "txt").group],
    };
    const grant = ipexExnBody(sender.pre, "/ipex/grant", [credential], {
      kind: Kinds.json,
      recipient: verifier.pre,
      message: "Live presentation",
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
    for (const party of parties) yield* party.runtime.reactor.processBytes(wire);
    // Only the verifier learns the later TEL suffix, which its query then carries.
    let prior = event1;
    for (const sn of [2, 3]) {
      const proof = makeBlindState({
        salt: root.qb64,
        sn,
        acdc: sn === 3 ? credential.said! : "",
        state: sn === 3 ? "issued" : "",
      });
      const event = blindate(rip.said!, prior.said!, proof.d.nonce, { sn, stamp });
      yield* observer.runtime.reactor.processBytes(
        sender.interact({ data: [{ i: rip.said!, s: sn.toString(16), d: event.said! }] }),
      );
      yield* observer.runtime.reactor.processBytes(event.raw);
      prior = event;
    }
    // The verifier learns later events, so the Grant it receives now waits for current openings.
    const waiting = ipexExnBody(sender.pre, "/ipex/grant", [credential], {
      kind: Kinds.json,
      recipient: verifier.pre,
      message: "Waiting presentation",
      date: stamp,
    });
    const waitingWire = yield* call(() =>
      collectPayload(framePayload({
        body: waiting,
        gvrsn: Vrsn_2_0,
        attachments: parseBytes(sender.endorse(waiting, { gvrsn: Vrsn_2_0 }))[0].attachments,
        nests: [child],
      }))
    );
    yield* observer.runtime.reactor.processBytes(waitingWire);
    assertEquals(observer.runtime.exc.complete(waiting.said!), false);
    assertExists(observer.hby.db.epse.get([waiting.said!]), "the Grant waits in escrow");
    yield* observer.runtime.exc.processEscrows(); // the first retry may settle bookkeeping
    const version = observer.hby.db.writeVersion;
    yield* observer.runtime.exc.processEscrows();
    yield* observer.runtime.exc.processEscrows();
    assertEquals(observer.hby.db.writeVersion, version, "a retry that makes no progress writes nothing");
    assertExists(observer.hby.db.epse.get([waiting.said!]), "and the Grant still waits");
  });
});
