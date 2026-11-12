/**
 * Holder side of issuance operations: the exchange consent, reload and expiry, and the separate Admit consent.
 * The issuer runs in its own owner, so both halves of one exchange are the library's code.
 */
import { parseBytes } from "cesr-ts";
import { run } from "effection";
import { assert, assertEquals, assertThrows } from "jsr:@std/assert";
import { type Operation } from "npm:effection@^3.6.0";
import {
  abandonIssuance,
  admitIssuance,
  approveIssuanceExchange,
  beginIssuance,
  deliverIssuanceAdmit,
  type IssuanceOperations,
  issuanceStatus,
  MemoryIssuanceOperationStore,
  prepareIssuanceGrant,
  resumeIssuance,
  waitForIssuance,
} from "../../../../src/app/ipex/issuance.ts";
import { ValidationError } from "../../../../src/core/errors.ts";
import { timestampMicros } from "../../../../src/time/mod.ts";
/** Assert that an operation refuses with a ValidationError containing `message`. */
function* refuses(op: () => Operation<unknown>, message: string): Operation<void> {
  try {
    yield* op();
  } catch (error) {
    assert(error instanceof ValidationError && error.message.includes(message), String(error));
    return;
  }
  throw new Error(`expected refusal: ${message}`);
}
import { type Scenario, scenario } from "./issuance-fixtures.ts";

/** One exchange up to the point where the holder has consented and the issuer has begun. */
function* started(s: Scenario) {
  const issuerOps = s.owner(), holderOps = s.holderOwner(), reg = yield* s.registry(0);
  const [issuerHab, holderHab] = [s.issuer.habs[0], s.holder.habs[0]];
  const { grant } = yield* beginIssuance(issuerOps, {
    hab: issuerHab,
    credential: reg.credential(),
    options: { recipient: holderHab.pre!, message: "Issue" },
  });
  yield* issuerOps.processOnce(); // the Grant and the query reach the holder
  return { issuerOps, holderOps, reg, grant, issuerHab, holderHab };
}

/**
 * Undo a retention, as if the process had ended after the consent was recorded but before the holder answered
 * the query: the Keeper then holds no root. (`approveIssuanceExchange` retains at once when the query is waiting.)
 */
function crashBeforeRetention(
  hab: {
    pre?: string;
    mgr: { ks: { rroots: { rem(k: string[]): unknown }; rrgrants: { rem(k: string[]): unknown } } };
  },
  registry: string,
) {
  hab.mgr.ks.rroots.rem([hab.pre!, registry]);
  hab.mgr.ks.rrgrants.rem([hab.pre!, registry]);
}

/** Alternate both owners until `done` holds. */
function* exchange(a: IssuanceOperations, b: IssuanceOperations, done: () => boolean, passes = 40): Operation<void> {
  for (let i = 0; i < passes && !done(); i++) {
    yield* a.processOnce();
    yield* b.processOnce();
  }
}

Deno.test("holder: consent, exchange, wait for the registry update, finish, then a separate Admit", async () => {
  await run(function*() {
    const s = yield* scenario(), { issuerOps, holderOps, reg, grant, holderHab } = yield* started(s);
    const awaiting = issuanceStatus(holderOps, grant);
    assertEquals(awaiting.state === "active" && [awaiting.phase, awaiting.needs], [
      "awaitingExchangeConsent",
      "exchange",
    ]);
    approveIssuanceExchange(holderOps, { hab: holderHab, grant });
    assertEquals(
      issuanceStatus(holderOps, grant).state === "active" && "phase" in issuanceStatus(holderOps, grant),
      true,
    );
    // The holder answers; the issuer completes DH; the holder then waits for the registry update.
    yield* holderOps.processOnce();
    yield* holderOps.processOnce();
    const waiting = issuanceStatus(holderOps, grant);
    assertEquals(waiting.state === "active" && waiting.phase, "rootRetained");
    yield* exchange(
      issuerOps,
      holderOps,
      () => issuanceStatus(holderOps, grant).state === "active" && "needs" in issuanceStatus(holderOps, grant),
    );
    assertEquals(issuanceStatus(issuerOps, grant), { state: "done", role: "issuer", phase: "issued" });
    const ready = issuanceStatus(holderOps, grant);
    assertEquals(ready.state === "active" && [ready.phase, ready.needs], ["awaitingAdmitConsent", "admit"]);
    assertEquals(s.holder.rgy.store.headEvent(reg.regid)!.ilk, "bup");
    assertEquals(s.holder.runtime.exc.complete(grant), true);
    assertEquals(s.holder.hby.db.erpy.get([grant]), null, "finishing the exchange creates no Admit");
    const waited = yield* waitForIssuance(holderOps, grant, {
      timeoutMs: 100,
      until: (status) => status.state !== "active" || status.needs === "admit",
    });
    assertEquals(waited.outcome, "settled");

    // Admit is its own consent: it signs, accepts locally, records, and is delivered separately.
    const admitted = yield* admitIssuance(holderOps.deps, { hab: holderHab, grant, message: "Accepted" });
    assertEquals(issuanceStatus(holderOps, grant), { state: "done", role: "holder", phase: "admitted" });
    assert(s.holder.runtime.exc.complete(admitted.admit.said!));
    assertEquals(s.issuer.runtime.exc.complete(admitted.admit.said!), false, "not delivered yet");
    assertEquals(yield* deliverIssuanceAdmit(holderOps.deps, holderHab, admitted), [s.issuer.habs[0].pre]);
    assertEquals(s.issuer.hby.db.erpy.get([grant])!.qb64, admitted.admit.said);
    assert(s.holderChanges.some((c) => c.id === grant));
  });
});

Deno.test("holder reload: interrupted, no reply is sent, and an interrupted exchange cannot be admitted", async () => {
  await run(function*() {
    const s = yield* scenario(), { holderOps, grant, holderHab, reg } = yield* started(s);
    approveIssuanceExchange(holderOps, { hab: holderHab, grant });
    crashBeforeRetention(holderHab, reg.regid);
    s.holder.runtime.ipex!.release(holderHab.pre!);
    const sent = s.log.length, reloaded = s.holderOwner();
    assertEquals(issuanceStatus(reloaded, grant).state, "interrupted");
    yield* reloaded.processOnce();
    assertEquals(s.holderStore.get(grant)!.ended!.state, "interrupted");
    assertEquals(s.log.length, sent);
    let refused = "";
    try {
      yield* admitIssuance(reloaded.deps, { hab: holderHab, grant });
    } catch (error) {
      refused = (error as Error).message;
    }
    assert(refused.includes("cannot be admitted"), refused);
  });
});

Deno.test("holder expiry and abandon end the exchange locally", async () => {
  await run(function*() {
    const s = yield* scenario(), { holderOps, grant, holderHab } = yield* started(s);
    approveIssuanceExchange(holderOps, { hab: holderHab, grant });
    s.clock.skew = Number(timestampMicros(s.holderStore.get(grant)!.deadline)! / 1000n) - Date.now() + 1;
    assertEquals(issuanceStatus(holderOps, grant).state, "expired");
    const sent = s.log.length;
    yield* holderOps.processOnce();
    assertEquals([s.holderStore.get(grant)!.ended!.state, s.log.length], ["expired", sent]);

    const other = yield* scenario(), second = yield* started(other);
    approveIssuanceExchange(second.holderOps, { hab: second.holderHab, grant: second.grant });
    abandonIssuance(second.holderOps, second.grant, "declined");
    assertEquals(issuanceStatus(second.holderOps, second.grant), {
      state: "abandoned",
      role: "holder",
      reason: "declined",
    });
    const before = other.log.length;
    yield* second.holderOps.processOnce();
    assertEquals(other.log.length, before, "an abandoned exchange answers nothing");
  });
});

Deno.test("holder refusals: another party's Grant, a repeat, an unaccepted Grant and an unknown Grant", async () => {
  await run(function*() {
    const s = yield* scenario(), { holderOps, grant, issuerHab, holderHab } = yield* started(s);
    assertThrows(
      () => approveIssuanceExchange(holderOps, { hab: issuerHab, grant }),
      ValidationError,
      "exact unanchored",
    );
    approveIssuanceExchange(holderOps, { hab: holderHab, grant });
    assertThrows(() => approveIssuanceExchange(holderOps, { hab: holderHab, grant }), ValidationError, "already begun");
    let refused = "";
    try {
      yield* admitIssuance(holderOps.deps, { hab: holderHab, grant }); // DH has not finished: the Grant is not accepted
    } catch (error) {
      refused = (error as Error).message;
    }
    assert(refused.includes("Accepted ACDC v2 exchange"), refused);
    assertThrows(() => issuanceStatus(holderOps, "Eunknown"), ValidationError, "No issuance");
  });
});

Deno.test("Admit of an accepted Grant with no issuance record creates the record", async () => {
  await run(function*() {
    const s = yield* scenario(), { issuerOps, holderOps, grant, holderHab } = yield* started(s);
    approveIssuanceExchange(holderOps, { hab: holderHab, grant });
    yield* exchange(
      issuerOps,
      holderOps,
      () => issuanceStatus(holderOps, grant).state === "active" && "needs" in issuanceStatus(holderOps, grant),
    );
    const fresh = new MemoryIssuanceOperationStore();
    yield* admitIssuance({ ...holderOps.deps, store: fresh }, { hab: holderHab, grant });
    assertEquals(fresh.get(grant)!.role, "holder");
    assertEquals(issuanceStatus({ deps: { ...holderOps.deps, store: fresh }, live: new Map() }, grant), {
      state: "done",
      role: "holder",
      phase: "admitted",
    });
  });
});

/** The holder has consented and answered, and the issuer has the reply: both sides retained the same root, nothing is anchored. */
function* bothRetained(s: Scenario) {
  const started_ = yield* started(s);
  approveIssuanceExchange(started_.holderOps, { hab: started_.holderHab, grant: started_.grant });
  yield* started_.holderOps.processOnce(); // the holder's reply reaches the issuer
  const { issuerHab, holderHab, reg } = started_;
  assert(
    issuerHab.mgr.getRegistryRoot(issuerHab.pre!, reg.regid)
      && holderHab.mgr.getRegistryRoot(holderHab.pre!, reg.regid),
  );
  return started_;
}

Deno.test("issuer restart after both roots were retained: resume anchors an update the holder verifies, then Admit", async () => {
  await run(function*() {
    const s = yield* scenario(), { holderOps, grant, issuerHab, holderHab, reg } = yield* bothRetained(s);
    const root = issuerHab.mgr.getRegistryRoot(issuerHab.pre!, reg.regid)!.qb64;
    assertEquals(
      issuerHab.mgr.ks.registryRootGrant([issuerHab.pre!, reg.regid]),
      grant,
      "the Keeper binds root to Grant",
    );
    s.issuer.runtime.ipex!.release(issuerHab.pre!);
    const reloaded = s.owner(), sn = issuerHab.kever!.sn;
    assertEquals(issuanceStatus(reloaded, grant), {
      state: "active",
      role: "issuer",
      phase: "rootRetained",
      needs: "anchor",
      deadline: s.store.get(grant)!.deadline,
    });
    yield* resumeIssuance(reloaded, { hab: issuerHab, grant });
    yield* exchange(
      reloaded,
      holderOps,
      () => issuanceStatus(holderOps, grant).state === "active" && "needs" in issuanceStatus(holderOps, grant),
    );
    assertEquals(issuanceStatus(reloaded, grant), { state: "done", role: "issuer", phase: "issued" });
    const ready = issuanceStatus(holderOps, grant);
    assertEquals(ready.state === "active" && [ready.phase, ready.needs], ["awaitingAdmitConsent", "admit"]);
    assertEquals(issuerHab.kever!.sn, sn + 1);
    assertEquals(issuerHab.mgr.getRegistryRoot(issuerHab.pre!, reg.regid)!.qb64, root, "the root is unchanged");
    assertEquals(s.holder.rgy.store.headEvent(reg.regid)!.ilk, "bup");
    const admitted = yield* admitIssuance(holderOps.deps, { hab: holderHab, grant });
    yield* deliverIssuanceAdmit(holderOps.deps, holderHab, admitted);
    assertEquals(s.issuer.hby.db.erpy.get([grant])!.qb64, admitted.admit.said);
  });
});

Deno.test("holder restart after both roots were retained: resume waits for the update, verifies it and finishes", async () => {
  await run(function*() {
    const s = yield* scenario(), { issuerOps, grant, holderHab, reg } = yield* bothRetained(s);
    s.holder.runtime.ipex!.release(holderHab.pre!);
    const reloaded = s.holderOwner(), sent = s.log.length;
    const expected = {
      state: "active",
      role: "holder",
      phase: "rootRetained",
      needs: "finish",
      deadline: s.holderStore.get(grant)!.deadline,
    } as const;
    assertEquals(issuanceStatus(reloaded, grant), expected);
    yield* reloaded.processOnce();
    assertEquals(issuanceStatus(reloaded, grant), expected, "the restart does not end a resumable issuance");
    assertEquals(s.log.length, sent);

    yield* resumeIssuance(reloaded, { hab: holderHab, grant });
    yield* reloaded.processOnce();
    const waiting = issuanceStatus(reloaded, grant);
    assertEquals(waiting.state === "active" && [waiting.phase, "needs" in waiting], ["rootRetained", false]);
    // The issuer's resent query reaches the resumed owner, which holds no ephemeral key: it is dropped, not answered.
    const root = holderHab.mgr.getRegistryRoot(holderHab.pre!, reg.regid)!.qb64;
    const query = s.log.find((m) => parseBytes(m.msg)[0].body.ilk === "qry")!;
    yield* s.holder.runtime.reactor.processBytes(query.msg);
    assertEquals(s.holder.runtime.ipex!.dhke(holderHab).outgoing.length, 0);
    assertEquals(holderHab.mgr.getRegistryRoot(holderHab.pre!, reg.regid)!.qb64, root);

    yield* exchange(
      issuerOps,
      reloaded,
      () => issuanceStatus(reloaded, grant).state === "active" && "needs" in issuanceStatus(reloaded, grant),
    );
    assertEquals(issuanceStatus(issuerOps, grant), { state: "done", role: "issuer", phase: "issued" });
    const ready = issuanceStatus(reloaded, grant);
    assertEquals(ready.state === "active" && [ready.phase, ready.needs], ["awaitingAdmitConsent", "admit"]);
    assert(s.holder.runtime.exc.complete(grant));
  });
});

Deno.test("resume refusals: nothing retained yet, the update already accepted, and the deadline passed", async () => {
  await run(function*() {
    // Keys were still being exchanged: no root was retained, so there is nothing to resume.
    const s = yield* scenario(), { holderOps, grant, holderHab, reg } = yield* started(s);
    approveIssuanceExchange(holderOps, { hab: holderHab, grant });
    crashBeforeRetention(holderHab, reg.regid);
    s.holder.runtime.ipex!.release(holderHab.pre!);
    const neverRooted = s.holderOwner();
    assertEquals(issuanceStatus(neverRooted, grant).state, "interrupted");
    yield* refuses(() => resumeIssuance(neverRooted, { hab: holderHab, grant }), "can be resumed");
    assertThrows(
      () => s.holder.runtime.ipex!.dhke(holderHab).resume(grant),
      ValidationError,
      "No exchange of this pending Grant retained its root",
    );

    // Once the update is accepted the holder can no longer resume, though its Grant is still pending.
    const t = yield* scenario(), done = yield* bothRetained(t);
    yield* done.issuerOps.processOnce(); // anchors the update and sends it
    assertEquals(t.holder.rgy.store.headEvent(done.reg.regid)!.ilk, "bup");
    t.holder.runtime.ipex!.release(done.holderHab.pre!);
    const holderAfter = t.holderOwner();
    assertEquals(issuanceStatus(holderAfter, done.grant).state, "interrupted");
    yield* refuses(() => resumeIssuance(holderAfter, { hab: done.holderHab, grant: done.grant }), "can be resumed");

    // The Grant's original exchange deadline ends a resumable issuance.
    const u = yield* scenario(), late = yield* bothRetained(u);
    u.issuer.runtime.ipex!.release(late.issuerHab.pre!);
    const reloaded = u.owner();
    assertEquals(issuanceStatus(reloaded, late.grant).state, "active");
    u.clock.skew = Number(timestampMicros(u.store.get(late.grant)!.deadline)! / 1000n) - Date.now() + 1;
    assertEquals(issuanceStatus(reloaded, late.grant).state, "expired");
    yield* refuses(() => resumeIssuance(reloaded, { hab: late.issuerHab, grant: late.grant }), "can be resumed");
  });
});

Deno.test("a root is bound to the Grant whose exchange retained it: another Grant on that registry cannot resume it", async () => {
  await run(function*() {
    const s = yield* scenario(), first = yield* bothRetained(s);
    const second = yield* prepareIssuanceGrant(first.issuerOps, {
      hab: first.issuerHab,
      credential: first.reg.credential(),
      options: { recipient: first.holderHab.pre!, message: "Issue again" },
    });
    s.issuer.runtime.ipex!.release(first.issuerHab.pre!);
    assertThrows(
      () => s.issuer.runtime.ipex!.dhke(first.issuerHab).resume(second.grant),
      ValidationError,
      "No exchange of this pending Grant retained its root",
    );
    assertEquals(
      first.issuerHab.mgr.ks.registryRootGrant([first.issuerHab.pre!, first.reg.regid]),
      first.grant,
    );
  });
});
