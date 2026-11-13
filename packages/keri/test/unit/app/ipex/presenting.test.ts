/**
 * Single-signature presentation operations over two in-process parties. Ported from KERIpy
 * `tests/acdc/test_pending_presentation.py` where the case concerns what the presenting side owns: the exact
 * signed Grant is retained as signed, keeps its original deadline (`test_first_accepted_grant_keeps_original_
 * auxiliary_deadline`, `test_expired_evicted_grant_cannot_acquire_a_new_lifetime`) and an expired exchange is
 * not delivered. The remaining KERIpy cases exercise the receiver's escrows (missing openings, bad openings,
 * sender thresholds, authorization scope) and live in the Exchanger tests.
 *
 * The group cases at the end cover a group Grant that waits for its presentation registry update: the group IPEX
 * owner holds that wait as data and signs the member's contribution itself once it reads the update accepted.
 */
import { parseBytes, type SerderACDC, type SerderKERI, Vrsn_2_0 } from "cesr-ts";
import { call, type Operation, run } from "effection";
import { assert, assertEquals, assertMatch, assertNotEquals, assertThrows } from "jsr:@std/assert";
import { RegistryAuthor } from "../../../../src/acdc/authoring.ts";
import { type RegistryEventRef, registryEventStatus } from "../../../../src/app/credentials/registry-settling.ts";
import type { Poster, PosterEvent, PosterOutcome } from "../../../../src/app/delivery/forwarding.ts";
import type { Hab } from "../../../../src/app/identity/habbing.ts";
import {
  GroupIpexOperations,
  type GroupIpexPrerequisite,
  type GroupIpexStatus,
  groupIpexStatus,
} from "../../../../src/app/ipex/group-ipex.ts";
import { beginIssuance, issuanceStatus, proposeIssuance } from "../../../../src/app/ipex/issuance.ts";
import { pendingApplies } from "../../../../src/app/ipex/pending-presentations.ts";
import {
  abandonPresentation,
  present,
  type PresentationDeps,
  PresentationOperations,
  presentationStatus,
  proposeGroupPresentation,
  resendPresentation,
  waitForPresentation,
} from "../../../../src/app/ipex/presenting.ts";
import { dispatchEnvelope, envelopeFromFrame } from "../../../../src/app/protocol/parsering.ts";
import { ValidationError } from "../../../../src/core/errors.ts";
import type { KramConfig } from "../../../../src/core/mailbox/kraming.ts";
import { interact } from "../../../../src/core/protocol-eventing.ts";
import { messagize } from "../../../../src/core/protocol-serialization.ts";
import { timestampMicros } from "../../../../src/time/mod.ts";
import {
  deadlineOf,
  KRAM,
  type Party,
  party,
  pastDeadline,
  pump,
  route,
  scenario,
  TestClock,
} from "./issuance-fixtures.ts";

const text = (msg: Uint8Array) => new TextDecoder().decode(msg);

type Ctx = ReturnType<typeof setup> extends Operation<infer T> ? T : never;

/** The issuer presents (offers or grants) a credential it issued, as a wallet's views would select it. */
function* setup(kram: KramConfig = KRAM) {
  const s = yield* scenario(1, () => {}, true, kram);
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

Deno.test("the prior exchange is named by priorSaid; the builder's prior is refused, not silently ignored", async () => {
  await run(function*() {
    const { hab, credential, s, ops } = yield* setup();
    // `options` is the closed DisclosureBodyOptions: `prior` is a type error, and untyped input that carries it is refused.
    const untyped = { recipient: s.holder.habs[0].pre!, message: "offer", plan: [], prior: { said: "Eignored" } };
    let refused = "";
    try {
      yield* present(ops, {
        verb: "offer",
        hab,
        selection: { said: credential.said! },
        options: untyped as never,
      });
    } catch (error) {
      refused = (error as Error).message;
    }
    assert(refused.includes("priorSaid"), refused);
  });
});

Deno.test("a failing transport is retried with a doubling delay and ends the operation only at its deadline", async () => {
  await run(function*() {
    const { s, ops, offer } = yield* setup();
    s.fail.on = true;
    const { said } = yield* offer(ops);
    yield* ops.processOnce();
    let status = presentationStatus(ops, said);
    assertEquals(status.state === "active" && [status.failure?.attempts, status.failure?.reason], [
      1,
      "transport failed",
    ]);
    yield* ops.processOnce();
    assertEquals(s.log.length, 1, "no retry before the delay has passed");
    s.clock.skew += 1100;
    yield* ops.processOnce();
    status = presentationStatus(ops, said);
    assertEquals(status.state === "active" && status.failure?.attempts, 2, "a second failure does not end it");
    s.clock.skew += 1500;
    yield* ops.processOnce();
    assertEquals(s.log.length, 2, "the delay doubled, so one more second is not enough");
    s.fail.on = false;
    s.clock.skew += 2500;
    yield* ops.processOnce();
    assertEquals(presentationStatus(ops, said).state, "done");
    assertEquals(s.log.length, 3);

    // An Apply carries an original exchange deadline like any opener, so an exchange that never reaches its peer ends
    // at that deadline (`expired`) and never as `failed`.
    s.fail.on = true;
    const second = yield* present(ops, {
      verb: "apply",
      hab: s.issuer.habs[0],
      options: { recipient: s.holder.habs[0].pre!, message: "apply", plan: [] },
    });
    yield* ops.processOnce();
    assertEquals(presentationStatus(ops, second.said).state, "active");
    assertNotEquals(ops.live.get(second.said)!.expires, null, "an Apply carries a deadline");
    s.clock.skew = pastDeadline(s.issuer, second.said);
    yield* ops.processOnce();
    assertEquals(presentationStatus(ops, second.said), {
      state: "expired",
      verb: "apply",
      reason: "The presentation reached its original exchange deadline",
    });
  });
});

/** The issuer asks the holder with an Apply and delivers it; returns the Apply SAID and the holder's listing. */
function* deliveredApply({ s, ops }: Ctx) {
  const { said } = yield* present(ops, {
    verb: "apply",
    hab: s.issuer.habs[0],
    options: { recipient: s.holder.habs[0].pre!, message: "apply", plan: [] },
  });
  yield* ops.processOnce();
  assert(s.holder.runtime.exc.complete(said), "the holder accepted the Apply");
  const listing = () => pendingApplies({ hby: s.holder.hby, exc: s.holder.runtime.exc, clock: s.clock });
  return { apply: said, listing };
}

Deno.test("pendingApplies omits an Apply whose KRAM record was pruned", async () => {
  await run(function*() {
    const ctx = yield* setup(), { s } = ctx, { apply, listing } = yield* deliveredApply(ctx);
    const deadline = deadlineOf(s.holder, apply);
    assertEquals(listing().map((item) => [item.apply, item.state, item.deadline]), [[apply, "pending", deadline]]);
    s.clock.skew = pastDeadline(s.holder, apply);
    assertEquals(listing(), [], "past its deadline the Apply is not pending");
    yield* s.holder.runtime.protocol.processEscrowsOnce(); // KRAM prunes the Apply's cache row
    const exn = s.holder.hby.db.exns.get([apply])!;
    assertEquals(s.holder.runtime.exc.exchangeDeadline(exn), null, "the KRAM cache row is gone");
    assert(s.holder.runtime.exc.complete(apply), "the accepted Apply itself is kept");
    assertEquals(s.holder.runtime.exc.exchangeExpiry(apply), deadline, "its own stamp still gives the deadline");
    assertEquals(listing(), [], "after the prune the expired Apply is still not pending");
  });
});

Deno.test("pendingApplies without KRAM lists an Apply with no deadline", async () => {
  await run(function*() {
    const ctx = yield* setup({ enabled: false }), { s } = ctx, { apply, listing } = yield* deliveredApply(ctx);
    assertEquals(listing().map((item) => [item.apply, item.state, item.deadline]), [[apply, "pending", null]]);
    s.clock.skew = 3_600_000; // with no exchange window, time does not end it
    assertEquals(listing().map((item) => item.apply), [apply]);
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
    const agree = yield* present(answering, {
      verb: "agree",
      hab: s.holder.habs[0],
      priorSaid: first.said,
      message: "ok",
    });
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
    const agree = yield* present(answering, { verb: "agree", hab: holder, priorSaid: first.said, message: "ok" });
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
  const { grant } = yield* proposeIssuance(issuing, {
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
      yield* present(ops, { verb: "spurn", hab, priorSaid: "Eabsent" });
      throw new Error("expected refusal");
    } catch (error) {
      assert(error instanceof ValidationError && error.message.includes("must be accepted"), String(error));
    }
    assertEquals(ops.live.size, 0, "a refused consent queues nothing");
  });
});

/**
 * Past KRAM's timeliness reach for a group-signed message (drift plus the multi-signature window, 61 s with `KRAM`):
 * a Grant stamped this long before its member signs is refused by that member's own KRAM.
 */
const PAST_TIMELINESS_MS = 120_000;

/** A 2-of-2 group whose first member presents; the second member only signs group KEL events. */
interface GroupPresenter {
  clock: TestClock;
  one: Party;
  group: Hab;
  /** The first member's group IPEX owner, composed with group registry collaborators. */
  ops: GroupIpexOperations;
  deps: PresentationDeps;
  /** Every stream the first member published, in order. */
  sent: Uint8Array[];
  /** A credential the first member's local issuer issued to the group; `rd` declares its presentation registry. */
  issue(rd: boolean): Operation<SerderACDC>;
  /** The second member's signature on an event the first member proposed, taken into the first member's intake. */
  approve(event: SerderKERI): Operation<void>;
  /** An event both members signed, taken into the first member's intake. */
  adopt(event: SerderKERI): Operation<void>;
  /** Process the first member's escrows until the registry event is accepted. */
  settle(ref: RegistryEventRef): Operation<void>;
}

/** Poster whose sends all succeed at once and are recorded; the group's own steps, not delivery, are under test. */
function recordingPoster(sent: Uint8Array[]): Poster {
  const done = (evt: PosterEvent): PosterOutcome => ({ kin: "sent", evt, deliveries: [] });
  return {
    send: (evt: PosterEvent & { msg: Uint8Array }) => (sent.push(evt.msg), { ...evt, kin: "msg" }),
    sendStream: (evt: PosterEvent & { msgs: Uint8Array[] }) => (sent.push(...evt.msgs), { ...evt, kin: "stream" }),
    wait: (evt: PosterEvent): Operation<PosterOutcome> => call(() => Promise.resolve(done(evt))),
  } as unknown as Poster;
}

/**
 * Two members of a 2-of-2 group on KRAM, driven by one test clock. The group's presentation registry is incepted and
 * sealed by both members; a single-signature issuer in the first member's Habery issues credentials to the group with
 * public openings, so the first member can select them without DH.
 */
function* groupPresenter(): Operation<GroupPresenter> {
  const clock = new TestClock();
  const one = yield* party(clock, "MemberOne", ["one", "issuer"], undefined, false);
  const two = yield* party(clock, "MemberTwo", ["two"], undefined, false);
  for (const [from, to] of [[one, two], [two, one]] as const) {
    for (const wire of from.hby.db.clonePreIter(from.habs[0].pre!, 0)) {
      yield* dispatchEnvelope(envelopeFromFrame(parseBytes(wire)[0]), to.hby.rvy, to.hby.kevery);
    }
  }
  const signing = [one.habs[0].pre!, two.habs[0].pre!];
  const [first, second] = [one, two].map((member) =>
    member.hby.makeGroupHab("group", member.habs[0], signing, signing, undefined, { isith: "2", nsith: "2" })
  );
  const inception =
    parseBytes(messagize(first.serder, { sigers: [...first.sigers, ...second.sigers], gvrsn: Vrsn_2_0 }))[0];
  for (const member of [one, two]) {
    yield* dispatchEnvelope(envelopeFromFrame(inception, true), member.hby.rvy, member.hby.kevery);
  }
  const group = first.hab, peer = second.hab;
  const signedByBoth = (event: SerderKERI) =>
    messagize(event, { sigers: [...group.sign(event.raw, true), ...peer.sign(event.raw, true)], gvrsn: Vrsn_2_0 });

  // The group's presentation registry, its inception sealed by both members.
  const presentation = one.rgy.makeRegistry("presented", group.pre!);
  const rip = presentation.store.event(presentation.regk!)!;
  const state = group.kever!;
  const seal = interact(group.pre!, state.said, state.sn + 1, [{ i: rip.said!, s: rip.sad!.n, d: rip.said! }], {
    version: Vrsn_2_0,
  });
  for (const member of [one, two]) yield* member.runtime.reactor.processBytes(signedByBoth(seal), { local: true });
  yield* one.runtime.reactor.processBytes(rip.raw);
  yield* one.runtime.protocol.processEscrowsOnce();
  assert(one.rgy.store.seqEvent(presentation.regk!, 0), "the group's presentation registry is accepted");

  const issuer = one.habs[1], author = new RegistryAuthor(one.rgy, one.receiptor);
  yield* author.incept("issued", issuer.pre!);
  const issued = author.registry("issued", issuer.pre!);
  const credentials = new Map<string, SerderACDC>();
  const sent: Uint8Array[] = [], postman = recordingPoster(sent);
  const ops = new GroupIpexOperations({
    hby: one.hby,
    rgy: one.rgy,
    exc: one.runtime.exc,
    protocol: one.runtime.protocol,
    postman,
    clock,
    registry: {
      hby: one.hby,
      protocol: one.runtime.protocol,
      postman,
      counselor: { start: () => true },
      registryStore: one.rgy.store,
    },
  });
  const deps: PresentationDeps = {
    hby: one.hby,
    rgy: one.rgy,
    exc: one.runtime.exc,
    receiptor: one.receiptor,
    reactor: one.runtime.reactor,
    protocol: one.runtime.protocol,
    delivery: {
      *deliver() {
        throw new Error("a group Grant is delivered by the elected lead, not through this delivery");
      },
    },
    clock,
    views: {
      issued: (said) => credentials.get(said)!,
      issuedRegistry: () => issued.regk!,
      held: () => Promise.reject(new ValidationError("no held credential")),
    },
  };
  return {
    clock,
    one,
    group,
    ops,
    deps,
    sent,
    *issue(rd) {
      const credential = author.create(issued, {
        issuee: group.pre!,
        attribute: { name: crypto.randomUUID(), ...(rd ? { rd: presentation.regk! } : {}) },
      });
      yield* author.update(issued, credential, "issued", { public: true });
      credentials.set(credential.said!, credential);
      return credential;
    },
    *approve(event) {
      yield* one.runtime.reactor.processBytes(
        messagize(event, { sigers: peer.sign(event.raw, true), gvrsn: Vrsn_2_0 }),
      );
    },
    *adopt(event) {
      yield* one.runtime.reactor.processBytes(signedByBoth(event), { local: true });
    },
    *settle(ref) {
      const read = { db: one.hby.db, store: one.rgy.store };
      for (let i = 0; i < 5 && registryEventStatus(read, ref).state !== "accepted"; i++) {
        yield* one.runtime.protocol.processEscrowsOnce();
      }
      assertEquals(registryEventStatus(read, ref).state, "accepted", "the group accepted the registry update");
    },
  };
}

/** What the first member's consent to a Grant with a presentation proof left waiting, and the anchor it proposed. */
interface ProposedWithProof {
  said: string;
  awaited: GroupIpexPrerequisite;
  /** The group KEL event that seals the registry update, signed so far by the first member only. */
  anchor: SerderKERI;
}

/** The first member proposes a Grant whose presented-state proof needs a group registry update. */
function* proposeWithProof(g: GroupPresenter): Operation<ProposedWithProof> {
  const credential = yield* g.issue(true);
  const { said } = yield* proposeGroupPresentation(g.deps, g.ops, {
    hab: g.group,
    selection: { said: credential.said! },
    options: {
      recipient: g.one.habs[1].pre!,
      message: "grant",
      plan: [[(credential.schema as { $id: string }).$id, "/", []]],
      presentationRegistry: "presented",
    },
  });
  const awaited = g.ops.live.get(said)!.prerequisite!;
  const anchor = g.one.hby.db.getEvtSerder(awaited.anchor.anchor.pre, awaited.anchor.anchor.said)!;
  return { said, awaited, anchor };
}

Deno.test("a group presentation Grant is signed on the tock after its registry update is accepted", async () => {
  await run(function*() {
    const g = yield* groupPresenter();
    const { said, awaited, anchor } = yield* proposeWithProof(g);
    const waiting: GroupIpexStatus = { state: "active", phase: "awaitingRegistryUpdate" };
    assertEquals(groupIpexStatus(g.ops, said), waiting);
    const proposed = g.sent.length;
    yield* g.ops.processOnce();
    assertEquals(groupIpexStatus(g.ops, said), waiting, "the second member has not signed the anchor");
    assertEquals(g.sent.length, proposed, "nothing is signed or published while the update is pending");
    yield* g.approve(anchor);
    yield* g.settle(awaited.anchor);
    yield* g.ops.processOnce();
    assertEquals(groupIpexStatus(g.ops, said), { state: "active", phase: "awaitingMembers" });
    assertEquals(g.ops.live.get(said)!.prerequisite, null, "the awaited update is consumed");
    const published = g.sent.slice(proposed).map((msg) => new TextDecoder().decode(msg));
    assert(published.some((msg) => msg.includes(said)), "this member's contribution to the Grant was published");
    assert(
      published.some((msg) => msg.includes(said) && msg.includes(anchor.said!)),
      "the contribution carries the proof sealed by the accepted anchor",
    );
  });
});

Deno.test("a superseded registry update ends the Grant operation failed, naming the superseding event", async () => {
  await run(function*() {
    const g = yield* groupPresenter();
    const { said, awaited } = yield* proposeWithProof(g);
    const { pre, sn } = awaited.anchor.anchor;
    // Both members sign a different event at the anchor's sequence number, so the proposed anchor can never be accepted.
    const rival = interact(pre, g.group.kever!.said, sn, [], { version: Vrsn_2_0 });
    yield* g.adopt(rival);
    assertEquals(g.one.hby.db.kels.getLast(pre, sn), rival.said, "the rival event took the anchor's place");
    const proposed = g.sent.length;
    yield* g.ops.processOnce();
    assertEquals(groupIpexStatus(g.ops, said), {
      state: "failed",
      reason: `The registry update was superseded by ${rival.said}`,
    });
    assertEquals(g.ops.live.size, 0, "a failed operation stops waiting");
    assertEquals(g.sent.length, proposed, "nothing was signed for the Grant");
  });
});

Deno.test("a Grant past its window when the update is accepted ends expired", async () => {
  await run(function*() {
    const g = yield* groupPresenter();
    const { said, awaited, anchor } = yield* proposeWithProof(g);
    g.clock.skew += PAST_TIMELINESS_MS;
    yield* g.approve(anchor);
    yield* g.settle(awaited.anchor);
    const proposed = g.sent.length;
    yield* g.ops.processOnce();
    const status = groupIpexStatus(g.ops, said);
    assertEquals(status.state, "expired");
    assertMatch((status as { reason: string }).reason, /^KRAM refused message \S+: timeliness/);
    assertEquals(g.ops.live.size, 0, "an expired operation stops retrying");
    assertEquals(g.sent.length, proposed, "a refused contribution is never published");
  });
});

Deno.test("a Grant without a presentation registry begins publishing at once", async () => {
  await run(function*() {
    const g = yield* groupPresenter();
    const credential = yield* g.issue(false);
    const proposed = g.sent.length;
    const { said } = yield* proposeGroupPresentation(g.deps, g.ops, {
      hab: g.group,
      selection: { said: credential.said! },
      options: {
        recipient: g.one.habs[1].pre!,
        message: "grant",
        plan: [[(credential.schema as { $id: string }).$id, "/", []]],
      },
    });
    assertEquals(groupIpexStatus(g.ops, said), { state: "active", phase: "publishing" });
    assertEquals(g.ops.live.get(said)!.prerequisite, null, "no registry update is awaited");
    assertEquals(g.sent.length, proposed, "no registry update was proposed");
    yield* g.ops.processOnce();
    assertEquals(groupIpexStatus(g.ops, said), { state: "active", phase: "awaitingMembers" });
  });
});
