/**
 * Single-signature presentation operations over two in-process parties. Ported from KERIpy
 * `tests/acdc/test_pending_presentation.py` where the case concerns what the presenting side owns: the exact
 * signed Grant is retained as signed, keeps its original deadline (`test_first_accepted_grant_keeps_original_
 * auxiliary_deadline`, `test_expired_evicted_grant_cannot_acquire_a_new_lifetime`) and an expired exchange is
 * not delivered. The remaining KERIpy cases exercise the receiver's escrows (missing openings, bad openings,
 * sender thresholds, authorization scope) and live in the Exchanger tests.
 */
import type { SerderACDC } from "cesr-ts";
import { type Operation, run } from "effection";
import { assert, assertEquals, assertThrows } from "jsr:@std/assert";
import { beginIssuance, issuanceStatus } from "../../../../src/app/ipex/issuance.ts";
import {
  abandonPresentation,
  present,
  PRESENTATION_RETRY_BOUND_MS,
  type PresentationDeps,
  PresentationOperations,
  presentationStatus,
  resendPresentation,
  waitForPresentation,
} from "../../../../src/app/ipex/presenting.ts";
import { ValidationError } from "../../../../src/core/errors.ts";
import { timestampMicros } from "../../../../src/time/mod.ts";
import { deadlineOf, pump, route, scenario } from "./issuance-fixtures.ts";

const text = (msg: Uint8Array) => new TextDecoder().decode(msg);

type Ctx = ReturnType<typeof setup> extends Operation<infer T> ? T : never;

/** The issuer presents (offers or grants) a credential it issued, as a wallet's views would select it. */
function* setup() {
  const s = yield* scenario();
  const reg = yield* s.registry(0), credential: SerderACDC = reg.credential();
  const hab = s.issuer.habs[0];
  const changes: string[] = [];
  const deps = (overrides: Partial<PresentationDeps> = {}): PresentationDeps => ({
    hby: s.issuer.hby,
    rgy: s.issuer.rgy,
    exc: s.issuer.runtime.exc,
    receiptor: s.issuer.receiptor,
    reactor: s.issuer.runtime.reactor,
    protocol: s.issuer.runtime.protocol,
    delivery: { deliver: s.delivery },
    clock: s.clock,
    derived: s.derived,
    views: {
      issued: () => credential,
      issuedRegistry: () => reg.regid,
      held: () => Promise.reject(new ValidationError("no held credential")),
    },
    changes: { push: ({ id }) => void changes.push(id) },
    ...overrides,
  });
  const offer = (ops: PresentationOperations) =>
    present(ops, {
      verb: "offer",
      hab,
      selection: { said: credential.said! },
      options: { recipient: s.holder.habs[0].pre!, message: "offer", plan: [] },
    });
  return { s, credential, hab, changes, deps, offer, ops: new PresentationOperations(deps()) };
}

Deno.test("an offer is signed and accepted locally at present; processOnce delivers the same bytes", async () => {
  await run(function*() {
    const { s, hab, ops, offer, changes } = yield* setup();
    const sn = hab.kever!.sn;
    const begun = yield* offer(ops);
    assert(s.issuer.runtime.exc.complete(begun.said), "accepted locally before any delivery");
    assertEquals(s.log.length, 0, "present sends nothing");
    assertEquals(presentationStatus(ops, begun.said), {
      state: "active",
      verb: "offer",
      phase: "delivering",
      deadline: s.issuer.runtime.exc.exchangeDeadline(s.issuer.hby.db.exns.get([begun.said])!) ?? undefined,
      attempts: 0,
      blocked: undefined,
    });
    yield* ops.processOnce();
    assertEquals(s.log.length, 1);
    assertEquals(s.log[0].msg, begun.wire, "the signed bytes are delivered unchanged, KEL first");
    assert(text(s.log[0].msg).includes("/ipex/offer"));
    assertEquals(s.log[0].dest, s.holder.habs[0].pre);
    const status = presentationStatus(ops, begun.said);
    assertEquals(status.state, "done");
    assertEquals(status.state === "done" && status.deliveries, [s.holder.habs[0].pre]);
    assert(s.holder.runtime.exc.complete(begun.said), "the peer accepted the offer");
    assertEquals(hab.kever!.sn, sn, "an offer anchors nothing");
    assertEquals(new Set(changes), new Set([begun.said]));
    yield* ops.processOnce();
    assertEquals(s.log.length, 1, "a delivered presentation is never sent again");
  });
});

Deno.test("a failing transport is retried with a doubling delay and ends the operation only at its bound", async () => {
  await run(function*() {
    const { s, ops, offer } = yield* setup();
    s.fail.on = true;
    const { said } = yield* offer(ops);
    yield* ops.processOnce();
    let status = presentationStatus(ops, said);
    assertEquals(status.state === "active" && [status.attempts, status.blocked], [1, "transport failed"]);
    yield* ops.processOnce();
    assertEquals(s.log.length, 1, "no retry before the delay has passed");
    s.clock.skew += 1100;
    yield* ops.processOnce();
    status = presentationStatus(ops, said);
    assertEquals(status.state === "active" && status.attempts, 2, "a second failure does not end it");
    s.clock.skew += 1500;
    yield* ops.processOnce();
    assertEquals(s.log.length, 2, "the delay doubled, so one more second is not enough");
    s.fail.on = false;
    s.clock.skew += 2500;
    yield* ops.processOnce();
    assertEquals(presentationStatus(ops, said).state, "done");
    assertEquals(s.log.length, 3);

    // An exchange that never reaches its peer ends at the deadline it has, or at the stated bound where it has none.
    s.fail.on = true;
    const second = yield* present(ops, {
      verb: "apply",
      hab: s.issuer.habs[0],
      options: { recipient: s.holder.habs[0].pre!, message: "apply", plan: [] },
    });
    yield* ops.processOnce();
    assertEquals(presentationStatus(ops, second.said).state, "active");
    s.clock.skew += PRESENTATION_RETRY_BOUND_MS + 1;
    yield* ops.processOnce();
    const ended = presentationStatus(ops, second.said);
    assert(ended.state === "failed" || ended.state === "expired", JSON.stringify(ended));
  });
});

Deno.test("a new owner reads interrupted and delivers nothing; resend delivers the identical bytes without signing", async () => {
  await run(function*() {
    const { s, deps, offer, ops, hab } = yield* setup();
    const begun = yield* offer(ops);
    const reloaded = new PresentationOperations(deps());
    const status = presentationStatus(reloaded, begun.said);
    assertEquals(status.state, "interrupted", "the pure read already knows");
    yield* reloaded.processOnce();
    assertEquals(s.log.length, 0, "nothing is sent after a restart");
    const sn = hab.kever!.sn;
    const again = yield* resendPresentation(reloaded, begun.said);
    assertEquals(again.wire, begun.wire, "rebuilt from the stored signatures");
    assertEquals(presentationStatus(reloaded, begun.said).state, "active");
    yield* reloaded.processOnce();
    assertEquals(s.log.map((m) => m.msg), [begun.wire]);
    assertEquals(presentationStatus(reloaded, begun.said).state, "done");
    assertEquals(hab.kever!.sn, sn);
    assert(s.holder.runtime.exc.complete(begun.said));
  });
});

Deno.test("status after a reload equals status before, once the peer answered", async () => {
  await run(function*() {
    const { s, deps, ops: offering, offer } = yield* setup();
    const answering = new PresentationOperations({
      hby: s.holder.hby,
      rgy: s.holder.rgy,
      exc: s.holder.runtime.exc,
      receiptor: s.holder.receiptor,
      reactor: s.holder.runtime.reactor,
      protocol: s.holder.runtime.protocol,
      delivery: { deliver: s.delivery },
      clock: s.clock,
    });
    const first = yield* offer(offering);
    yield* offering.processOnce();
    const agree = yield* present(answering, { verb: "agree", hab: s.holder.habs[0], prior: first.said, message: "ok" });
    yield* answering.processOnce();
    const before = presentationStatus(offering, first.said);
    const after = presentationStatus(new PresentationOperations(deps()), first.said);
    assertEquals(before.state, "done");
    assertEquals(after.state === "done" && after.response, before.state === "done" && before.response);
    assertEquals(after.state === "done" && after.response?.said, agree.said);
    assertThrows(() => presentationStatus(new PresentationOperations(deps()), "Eunknown"), ValidationError);
    let refused = "";
    try {
      yield* resendPresentation(new PresentationOperations(deps()), first.said);
    } catch (error) {
      refused = (error as Error).message;
    }
    assert(refused.includes("already answered"), refused);
  });
});

Deno.test("abandon is local and final; the wait observes and reports a timeout", async () => {
  await run(function*() {
    const { s, ops, offer } = yield* setup();
    s.fail.on = true;
    const { said } = yield* offer(ops);
    yield* ops.processOnce();
    const waited = yield* waitForPresentation(ops, said, { timeoutMs: 100 });
    assertEquals(waited.outcome, "timed-out");
    assertEquals(waited.outcome === "timed-out" && waited.timeoutMs, 100);
    abandonPresentation(ops, said, "changed my mind");
    assertEquals(presentationStatus(ops, said), { state: "abandoned", verb: "offer", reason: "changed my mind" });
    assertEquals((yield* waitForPresentation(ops, said, { timeoutMs: 100 })).outcome, "settled");
    s.fail.on = false;
    s.clock.skew += 1100;
    yield* ops.processOnce();
    assertEquals(s.log.length, 1);
    assertThrows(() => presentationStatus(ops, "Eunknown"), ValidationError, "No presentation was begun");
  });
});

Deno.test("the disclosee answers an accepted Offer with an Agree it signs and delivers", async () => {
  await run(function*() {
    const { s, ops: offering, offer } = yield* setup();
    const holder = s.holder.habs[0];
    const answering = new PresentationOperations({
      hby: s.holder.hby,
      rgy: s.holder.rgy,
      exc: s.holder.runtime.exc,
      receiptor: s.holder.receiptor,
      reactor: s.holder.runtime.reactor,
      protocol: s.holder.runtime.protocol,
      delivery: { deliver: s.delivery },
      clock: s.clock,
    });
    const first = yield* offer(offering);
    yield* offering.processOnce();
    const agree = yield* present(answering, { verb: "agree", hab: holder, prior: first.said, message: "ok" });
    assertEquals(agree.recipient, s.issuer.habs[0].pre);
    yield* answering.processOnce();
    assert(text(s.log.at(-1)!.msg).includes("/ipex/agree"));
    assert(s.issuer.runtime.exc.complete(agree.said));
    assertEquals(presentationStatus(answering, agree.said).state, "done");
    const sent = presentationStatus(offering, first.said);
    assertEquals(sent.state === "done" && sent.response?.said, agree.said, "the stored answer is read, not tracked");
    assertEquals(sent.state === "done" && sent.response?.route, "/ipex/agree");
  });
});

/** Issue the credential through the DH owners, then present a Grant of it from the issuer. */
function* issuedGrant(ctx: Ctx) {
  const { s, credential, hab, ops } = ctx;
  const issuing = s.owner(), deliver = route([s.issuer, s.holder], s.log);
  const { grant } = yield* beginIssuance(issuing, {
    hab,
    credential,
    options: { recipient: s.holder.habs[0].pre!, message: "Issue" },
  });
  yield* issuing.processOnce();
  s.holder.runtime.ipex!.dhke(s.holder.habs[0]).approve(grant);
  for (let i = 0; i < 40 && issuanceStatus(issuing, grant).state === "active"; i++) {
    yield* issuing.processOnce();
    yield* pump(s.holder, deliver);
  }
  assertEquals(issuanceStatus(issuing, grant).state, "done");
  s.log.length = 0;
  return yield* present(ops, {
    verb: "grant",
    hab,
    selection: { said: credential.said!, derive: true },
    options: {
      recipient: s.holder.habs[0].pre!,
      message: "grant",
      plan: [[(credential.schema as { $id: string }).$id, "/", []]],
    },
  });
}

Deno.test("a Grant keeps its original deadline: delivered before it, expired and unsent after (test_pending_presentation)", async () => {
  await run(function*() {
    const ctx = yield* setup(), { s, ops } = ctx;
    const { said, wire } = yield* issuedGrant(ctx);
    const deadline = deadlineOf(s.issuer, said);
    assert(deadline, "the accepted Grant has the exchange deadline of its first acceptance");
    s.fail.on = true;
    yield* ops.processOnce();
    assertEquals(presentationStatus(ops, said).state, "active");
    assertEquals(deadlineOf(s.issuer, said), deadline, "a retry never renews the lifetime");
    s.clock.skew = Number(timestampMicros(deadline)! / 1000n) - Date.now() + 1;
    assertEquals(presentationStatus(ops, said).state, "expired", "the pure read already knows");
    s.fail.on = false;
    const sent = s.log.length;
    yield* ops.processOnce();
    assertEquals(presentationStatus(ops, said).state, "expired");
    assertEquals(s.log.length, sent, "nothing is sent after the deadline");
    assert(!s.holder.runtime.exc.complete(said));
    assert(wire.length > 0);
  });
});

Deno.test("a Grant is delivered with its proof support ahead of the exchange", async () => {
  await run(function*() {
    const ctx = yield* setup(), { s, ops } = ctx;
    const { said, wire } = yield* issuedGrant(ctx);
    yield* ops.processOnce();
    assertEquals(s.log[0].msg, wire);
    assert(text(wire).indexOf("/ipex/grant") > 0, "KEL and support precede the Grant");
    assertEquals(presentationStatus(ops, said).state, "done");
  });
});

Deno.test("a Grant resent after a restart is rebuilt with its proof support, byte for byte", async () => {
  await run(function*() {
    const ctx = yield* setup(), { s, deps } = ctx;
    const { said, wire } = yield* issuedGrant(ctx);
    const reloaded = new PresentationOperations(deps());
    const again = yield* resendPresentation(reloaded, said);
    assertEquals(again.wire, wire);
    yield* reloaded.processOnce();
    assertEquals(s.log[0].msg, wire);
  });
});

Deno.test("refusals: unknown presentation registry, unaccepted prior", async () => {
  await run(function*() {
    const { s, credential, hab, ops } = yield* setup();
    try {
      yield* present(ops, {
        verb: "grant",
        hab,
        selection: { said: credential.said! },
        options: { recipient: s.holder.habs[0].pre!, message: "", plan: [], presentationRegistry: "nope" },
      });
      throw new Error("expected refusal");
    } catch (error) {
      assert(error instanceof ValidationError && error.message === "Unknown presentation registry.", String(error));
    }
    try {
      yield* present(ops, { verb: "spurn", hab, prior: "Eabsent" });
      throw new Error("expected refusal");
    } catch (error) {
      assert(error instanceof ValidationError && error.message.includes("must be accepted"), String(error));
    }
    assertEquals(ops.live.size, 0, "a refused consent queues nothing");
  });
});
