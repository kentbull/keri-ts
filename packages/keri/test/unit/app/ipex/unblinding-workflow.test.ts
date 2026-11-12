/**
 * Single-signature Unblind operations over two in-process parties: a presenter (the Grant's sender) that knows
 * only the first registry event and a verifier that already holds the later public suffix. Ported from KERIpy
 * `tests/acdc/test_held_openings.py` where the case concerns what the owner leaves behind: the exact opening is
 * released only after explicit consent, is held on the Grant (not in public TEL replay), survives a reload
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
import { call, run } from "effection";
import { assert, assertEquals, assertThrows } from "jsr:@std/assert";
import { acdcmap, blindate, regcept } from "../../../../src/acdc/messaging.ts";
import { publicOpeningAttachment } from "../../../../src/acdc/registering.ts";
import { ipexExnBody } from "../../../../src/app/ipex/ipex-building.ts";
import {
  abandonUnblinding,
  approveUnblind,
  MemoryUnblindingOperationStore,
  requestUnblind,
  UnblindingOperations,
  unblindingStatus,
  waitForUnblinding,
} from "../../../../src/app/ipex/unblinding-workflow.ts";
import { ValidationError } from "../../../../src/core/errors.ts";
import { makeNowIso8601, timestampMicros } from "../../../../src/time/mod.ts";
import { type Party, route, scenario } from "./issuance-fixtures.ts";

const STATES = ["issued", "revoked", ""];

function* fixture() {
  const s = yield* scenario();
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
  const mk = (p: Party, store = new MemoryUnblindingOperationStore()) =>
    new UnblindingOperations({
      hby: p.hby,
      exc: p.runtime.exc,
      unblinds: p.runtime.ipex!,
      delivery: { deliver: delivery },
      store,
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

Deno.test("both parties consent; the owners exchange the query and reply and finish the pending Grant", async () => {
  await run(function*() {
    const f = yield* fixture();
    const requester = f.mk(f.observer), responder = f.mk(f.presenter);
    const g = f.grant.said!, deadline = f.observer.runtime.exc.exchangeDeadline(f.grant);
    assertThrows(
      () => approveUnblind(requester, { hab: f.verifier, grant: g, states: STATES }),
      ValidationError,
      "Only the discloser",
    );
    assertThrows(
      () => requestUnblind(responder, { hab: f.sender, grant: g, states: STATES }),
      ValidationError,
      "Only the disclosee",
    );
    const begun = requestUnblind(requester, { hab: f.verifier, grant: g, states: STATES });
    assertEquals(begun.role, "requester");
    approveUnblind(responder, { hab: f.sender, grant: g, states: STATES });
    assertEquals(unblindingStatus(requester, g), {
      state: "active",
      role: "requester",
      phase: "awaitingReply",
      deadline: deadline!,
    });
    assertEquals(f.sent.length, 0, "the consent steps send nothing");
    yield* drive(requester, responder, g);
    assertEquals(unblindingStatus(requester, g), { state: "done", role: "requester" });
    assertEquals(unblindingStatus(responder, g), { state: "done", role: "responder" });
    assert(f.observer.runtime.exc.complete(g), "the pending Grant was finished with the released openings");
    assertEquals(f.observer.runtime.exc.exchangeDeadline(f.grant), deadline, "the original deadline is kept");
    assertEquals(f.observer.hby.db.erpy.get([g]), null, "opening completion does not Admit");
    assertEquals(f.verifier.mgr.getRegistryRoot(f.verifier.pre!, f.rip.said!), null, "no root custody transfers");
    const text = new TextDecoder();
    assert(!f.sent.some((m) => text.decode(m.msg).includes(f.root.qb64)), "the root is never on the wire");
    // The finished view is stored on the Grant, so it outlives the owner and its record.
    assert(f.observer.runtime.exc.verifyAccepted(g, "/ipex/grant"));
    assertEquals(f.mk(f.observer).live.size, 0);
  });
});

Deno.test("a query that arrives before the release consent discloses nothing, then is replayed on approval", async () => {
  await run(function*() {
    const f = yield* fixture();
    const requester = f.mk(f.observer), responder = f.mk(f.presenter), g = f.grant.said!;
    requestUnblind(requester, { hab: f.verifier, grant: g, states: STATES });
    yield* requester.processOnce();
    assertEquals(f.sent.length, 1, "the signed query went to the discloser");
    assertEquals(f.sent[0].dest, f.sender.pre);
    f.s.clock.skew += 1100;
    yield* requester.processOnce();
    assertEquals(f.sent.length, 2);
    assertEquals(f.sent[1].msg, f.sent[0].msg, "the unchanged query is resent each second");
    assertEquals(f.presenter.rgy.store.head(f.rip.said!)!.qb64, f.head, "an unapproved public suffix is not imported");
    const waited = yield* waitForUnblinding(requester, g, { timeoutMs: 100 });
    assertEquals(waited.outcome, "timed-out");
    const before = f.sent.length;
    approveUnblind(responder, { hab: f.sender, grant: g, states: STATES });
    yield* drive(requester, responder, g);
    assertEquals(unblindingStatus(responder, g).state, "done");
    assertEquals(unblindingStatus(requester, g).state, "done");
    assert(f.sent.length > before);
  });
});

Deno.test("a reloaded owner reads interrupted; an expired Grant reads expired; neither sends", async () => {
  await run(function*() {
    const f = yield* fixture(), g = f.grant.said!;
    const store = new MemoryUnblindingOperationStore();
    const requester = f.mk(f.observer, store);
    requestUnblind(requester, { hab: f.verifier, grant: g, states: STATES });
    const reloaded = f.mk(f.observer, store);
    assertEquals(unblindingStatus(reloaded, g).state, "interrupted", "the pure read already knows");
    yield* reloaded.processOnce();
    assertEquals(store.get(g)!.ended!.state, "interrupted");
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
