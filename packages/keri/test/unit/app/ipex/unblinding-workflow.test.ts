/**
 * Single-signature Unblind operations over two in-process parties: a presenter (the Grant's sender) that knows
 * only the first registry event and a verifier that already holds the later public suffix. Ported from KERIpy
 * `tests/acdc/test_held_openings.py` where the case concerns what the owner leaves behind: the exact opening is
 * released on the discloser's signed Grant (no second approval), is held on the Grant (not in public TEL replay), survives a reload
 * of the owner, and the root never leaves the presenter. The registry-store cases of that file (`putOpening`
 * refusals, corrupt rows) are `RegistryStore` behaviour and are covered with the store.
 */
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
import { call, run, sleep } from "effection";
import { assert, assertEquals, assertThrows } from "jsr:@std/assert";
import { acdcmap, blindate, regcept } from "../../../../src/acdc/messaging.ts";
import { publicOpeningAttachment } from "../../../../src/acdc/registering.ts";
import { Unblind } from "../../../../src/acdc/unblinding.ts";
import { ipexExnBody } from "../../../../src/app/ipex/ipex-building.ts";
import { pendingPresentations } from "../../../../src/app/ipex/pending-presentations.ts";
import {
  abandonUnblinding,
  requestUnblind,
  UnblindingOperations,
  unblindingStatus,
  waitForUnblinding,
} from "../../../../src/app/ipex/unblinding-workflow.ts";
import { envelopeFromFrame } from "../../../../src/app/protocol/parsering.ts";
import { ValidationError } from "../../../../src/core/errors.ts";
import type { KramConfig } from "../../../../src/core/mailbox/kraming.ts";
import { query } from "../../../../src/core/protocol-eventing.ts";
import { makeNowIso8601, timestampMicros } from "../../../../src/time/mod.ts";
import { type Party, route, scenario } from "./issuance-fixtures.ts";

const STATES = ["issued", "revoked", ""];

function* fixture(kram?: KramConfig) {
  const s = yield* scenario(1, undefined, true, kram);
  const presenter = s.issuer, observer = s.holder, sender = presenter.habs[0], verifier = observer.habs[0];
  const stamp = makeNowIso8601(new Date());
  const both = function*(raw: Uint8Array) {
    for (const party of [presenter, observer]) yield* party.runtime.reactor.processBytes(raw);
  };
  const rip = regcept(sender.pre!, { stamp });
  yield* observer.runtime.reactor.processBytes(sender.interact({ data: [{ i: rip.said!, s: "0", d: rip.said! }] }));
  yield* both(rip.raw);
  const root = new Salter({ raw: new TextEncoder().encode("public-test-root"), code: MtrDex.Salt_128 });
  sender.mgr.putRegistryRoot(sender.pre!, rip.said!, root);
  const credential = acdcmap(sender.pre!, { regid: rip.said!, attribute: { d: "", i: verifier.pre!, name: "Ada" } });
  const first = makeBlindState({ salt: root.qb64, sn: 1, acdc: credential.said!, state: "issued" });
  const event1 = blindate(rip.said!, rip.said!, first.d.nonce, { stamp });
  yield* observer.runtime.reactor.processBytes(
    sender.interact({ data: [{ i: rip.said!, s: "1", d: event1.said! }] }),
  );
  yield* both(event1.raw);
  // Only the verifier learns the later public suffix; the presenter's chain stops at the first event.
  let prior = event1;
  const events = [];
  for (const sn of [2, 3, 4]) {
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
    events.push(event);
    prior = event;
  }
  const child: CesrFrame = {
    body: credential,
    gvrsn: Vrsn_2_0,
    attachments: [parseAttachmentGroup(publicOpeningAttachment(first), Vrsn_2_0, "txt").group],
  };
  const grant = ipexExnBody(sender.pre!, "/ipex/grant", [credential], {
    kind: Kinds.json,
    recipient: verifier.pre!,
    message: "Pending stale presentation",
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
  yield* both(wire);
  assertEquals(presenter.rgy.store.head(rip.said!)!.qb64, event1.said!);
  assertEquals(observer.rgy.store.head(rip.said!)!.qb64, events[2].said!);
  assert(presenter.runtime.exc.complete(grant.said!));
  assert(!observer.runtime.exc.complete(grant.said!), "the verifier holds the Grant pending");
  const delivery = route([presenter, observer], s.log);
  const mk = (p: Party) =>
    new UnblindingOperations({
      hby: p.hby,
      exc: p.runtime.exc,
      unblinds: p.runtime.ipex!,
      delivery: { deliver: delivery },
      clock: s.clock,
    });
  const head = presenter.rgy.store.head(rip.said!)!.qb64;
  return { head, s, presenter, observer, sender, verifier, grant, root, rip, mk, delivery, sent: s.log };
}

/** Drive both owners until neither is active or `passes` run out. */
function* drive(a: UnblindingOperations, b: UnblindingOperations, grant: string, passes = 20) {
  for (let i = 0; i < passes; i++) {
    yield* a.processOnce();
    yield* b.processOnce();
    if ([a, b].every((o) => unblindingStatus(o, grant).state !== "active")) return;
  }
}

Deno.test("the disclosee consents; the discloser answers on its own and the owners exchange the query and reply and finish the pending Grant", async () => {
  await run(function*() {
    const f = yield* fixture();
    const requester = f.mk(f.observer), responder = f.mk(f.presenter);
    const g = f.grant.said!, deadline = f.observer.runtime.exc.exchangeDeadline(f.grant);
    assertThrows(
      () => requestUnblind(responder, { hab: f.sender, grant: g, states: STATES }),
      ValidationError,
      "Only the disclosee",
    );
    assertEquals(
      pendingPresentations(requester).map((p) => [p.grant, p.disclosee, p.presenter, p.status.state]),
      [[g, f.verifier.pre, f.sender.pre, "interrupted"]],
      "the verifier lists the pending Grant before any consent",
    );
    assertEquals(pendingPresentations(requester, { hab: f.sender }), [], "only Grants addressed to that identifier");
    assertEquals(pendingPresentations(responder), [], "the presenter has no Grant addressed to it");
    const begun = requestUnblind(requester, { hab: f.verifier, grant: g, states: STATES });
    assertEquals(begun.role, "requester");
    assertEquals(unblindingStatus(requester, g), {
      state: "active",
      role: "requester",
      phase: "awaitingReply",
      deadline: deadline!,
    });
    assertEquals(f.sent.length, 0, "requesting sends nothing until a pass runs");
    yield* drive(requester, responder, g);
    assertEquals(unblindingStatus(requester, g), { state: "done", role: "requester" });
    assertEquals(unblindingStatus(responder, g), { state: "done", role: "responder" });
    assertEquals(pendingPresentations(requester), [], "a finished Grant is no longer pending");
    assert(f.observer.runtime.exc.complete(g), "the pending Grant was finished with the released openings");
    assertEquals(f.observer.runtime.exc.exchangeDeadline(f.grant), deadline, "the original deadline is kept");
    assertEquals(f.observer.hby.db.erpy.get([g]), null, "opening completion does not Admit");
    assertEquals(f.verifier.mgr.getRegistryRoot(f.verifier.pre!, f.rip.said!), null, "no root custody transfers");
    const text = new TextDecoder();
    assert(!f.sent.some((m) => text.decode(m.msg).includes(f.root.qb64)), "the root is never on the wire");
    // The finished view is stored on the Grant, so it outlives the owner and its record.
    assert(f.observer.runtime.exc.verifyAccepted(g, "/ipex/grant"));
    // With no store, a reopened requester reads the same from the stored Grant; a responder has nothing to read.
    assertEquals(unblindingStatus(f.mk(f.observer), g), { state: "done", role: "requester" });
    assertThrows(() => unblindingStatus(f.mk(f.presenter), g), ValidationError, "No Unblind");
  });
});

Deno.test("an authenticated query for a live Grant the discloser sent is answered with no approval call", async () => {
  await run(function*() {
    const f = yield* fixture();
    const requester = f.mk(f.observer), g = f.grant.said!;
    requestUnblind(requester, { hab: f.verifier, grant: g, states: STATES });
    yield* requester.processOnce();
    assertEquals(f.sent[0].dest, f.sender.pre, "the signed query went to the discloser");
    // The discloser never approved: its owner appeared at the query and holds the reply for delivery.
    const owner = f.presenter.runtime.ipex!.unblind(f.sender);
    assertEquals(owner.awaitingReply().length, 1);
    const responder = f.mk(f.presenter);
    yield* drive(requester, responder, g);
    assertEquals(unblindingStatus(responder, g).state, "done");
    assertEquals(unblindingStatus(requester, g).state, "done");
    assertEquals(
      f.presenter.rgy.store.head(f.rip.said!)!.qb64 !== f.head,
      true,
      "the authenticated suffix is imported",
    );
  });
});

Deno.test("a reloaded discloser answers the request it accepted before the restart, with no resend and no approve call", async () => {
  await run(function*() {
    const f = yield* fixture();
    const requester = f.mk(f.observer), g = f.grant.said!;
    requestUnblind(requester, { hab: f.verifier, grant: g, states: STATES });
    yield* requester.processOnce();
    // The discloser's process restarts: owners and driver are gone, the stores are not.
    f.presenter.runtime.ipex!.release(f.sender.pre!);
    const responder = f.mk(f.presenter);
    yield* responder.processOnce();
    // The request KRAM accepted before the restart is persisted, so the reloaded owner owes and sends the reply
    // although the requester's identical resend would be a replay.
    assertEquals(f.sent.length, 2, "the reply goes out from the persisted request");
    yield* drive(requester, responder, g);
    assertEquals(unblindingStatus(responder, g).state, "done");
    assertEquals(unblindingStatus(requester, g).state, "done");
  });
});

Deno.test("no reply after the Grant's deadline, and none for a Grant this identifier did not send", async () => {
  await run(function*() {
    const f = yield* fixture();
    const requester = f.mk(f.observer), g = f.grant.said!;
    requestUnblind(requester, { hab: f.verifier, grant: g, states: STATES });
    yield* requester.processOnce();
    const owner = f.presenter.runtime.ipex!.unblind(f.sender);
    const wire = f.sent[0].msg;
    f.presenter.runtime.ipex!.release(f.sender.pre!);
    f.s.clock.skew = Number(timestampMicros(f.presenter.runtime.exc.exchangeDeadline(f.grant))! / 1000n)
      - Date.now() + 1;
    const late = f.presenter.runtime.ipex!.unblind(f.sender);
    assertEquals(late.processQuery(envelopeFromFrame(parseBytes(wire)[0])), { kind: "drop", reason: "invalidQuery" });
    assertEquals(late.awaitingReply(), []);
    assertEquals(owner.awaitingReply(), []);
    // The verifier received this Grant; it did not send it, so a query from the sender is not answered.
    const probe = query(Unblind.Route, { x: g, re: {} }, {
      pre: f.sender.pre!,
      replyRoute: Unblind.Route,
      pvrsn: Vrsn_2_0,
      kind: Kinds.json,
    });
    const foreign = f.observer.runtime.ipex!.unblind(f.verifier);
    const envelope = envelopeFromFrame(parseBytes(f.sender.endorse(probe, { gvrsn: Vrsn_2_0 }))[0]);
    assertEquals(foreign.processQuery(envelope).kind, "drop");
    assertEquals(foreign.awaitingReply(), []);
  });
});

Deno.test("a reloaded owner reads interrupted; an expired Grant reads expired; neither sends", async () => {
  await run(function*() {
    const f = yield* fixture(), g = f.grant.said!;
    const requester = f.mk(f.observer);
    requestUnblind(requester, { hab: f.verifier, grant: g, states: STATES });
    const reloaded = f.mk(f.observer);
    assertEquals(unblindingStatus(reloaded, g).state, "interrupted", "the pure read already knows");
    yield* reloaded.processOnce();
    assertEquals(unblindingStatus(reloaded, g).state, "interrupted");
    assertEquals(f.sent.length, 0);

    const other = yield* fixture(), og = other.grant.said!, ops = other.mk(other.observer);
    requestUnblind(ops, { hab: other.verifier, grant: og, states: STATES });
    other.s.clock.skew = Number(timestampMicros(other.observer.runtime.exc.exchangeDeadline(other.grant))! / 1000n)
      - Date.now() + 1;
    assertEquals(unblindingStatus(ops, og).state, "expired");
    yield* ops.processOnce();
    assertEquals(unblindingStatus(ops, og).state, "expired");
    assertEquals(other.sent.length, 0, "nothing is sent past the original deadline");
  });
});

Deno.test("abandon is local and final", async () => {
  await run(function*() {
    const f = yield* fixture(), g = f.grant.said!, requester = f.mk(f.observer);
    requestUnblind(requester, { hab: f.verifier, grant: g, states: STATES });
    abandonUnblinding(requester, g, "changed my mind");
    assertEquals(unblindingStatus(requester, g), { state: "abandoned", role: "requester", reason: "changed my mind" });
    assertEquals((yield* waitForUnblinding(requester, g, { timeoutMs: 100 })).outcome, "settled");
    yield* requester.processOnce();
    assertEquals(f.sent.length, 0);
    assertThrows(() => unblindingStatus(requester, "Eunknown"), ValidationError, "No Unblind was begun");
    assertThrows(
      () => requestUnblind(requester, { hab: f.verifier, grant: "Eunknown", states: STATES }),
      ValidationError,
      "authenticated retained Grant",
    );
  });
});

Deno.test("an aged Unblind query is re-dated and accepted instead of resent as a stale replay", async () => {
  await run(function*() {
    // A 2 s single-key window lets the query age in real time while the fixture still builds in time.
    const f = yield* fixture({ enabled: true, caches: { "~": [100, 2000, 60000, 300000, 2000, 60000, 300000] } });
    let lose = true;
    const queries: Uint8Array[] = [];
    const requester = new UnblindingOperations({
      hby: f.observer.hby,
      exc: f.observer.runtime.exc,
      unblinds: f.observer.runtime.ipex!,
      delivery: {
        *deliver(sent) {
          if (parseBytes(sent.msg)[0].body.ilk === "qry") {
            queries.push(sent.msg);
            if (lose) return [sent.dest]; // reported delivered, never received
          }
          return yield* f.delivery(sent);
        },
      },
      clock: f.s.clock,
    });
    const responder = f.mk(f.presenter), g = f.grant.said!;
    requestUnblind(requester, { hab: f.verifier, grant: g, states: STATES });
    yield* requester.processOnce();
    yield* sleep(2200); // past the resend interval and the window
    lose = false;
    yield* requester.processOnce();
    assertEquals(queries.length, 2);
    assert(queries[0].some((byte, i) => byte !== queries[1][i]) || queries[0].length !== queries[1].length);
    yield* drive(requester, responder, g);
    assertEquals(unblindingStatus(requester, g), { state: "done", role: "requester" });
  });
});
