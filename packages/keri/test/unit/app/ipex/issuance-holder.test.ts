/**
 * Holder side of issuance operations: the exchange consent, reload and expiry, and the separate Admit consent.
 * The issuer runs in its own owner, so both halves of one exchange are the library's code.
 */
import { MtrDex, parseBytes, Saider, Salter, type SerderACDC } from "cesr-ts";
import { run } from "effection";
import { assert, assertEquals, assertThrows } from "jsr:@std/assert";
import { type Operation } from "npm:effection@^3.6.0";
import { RegistryAuthor } from "../../../../src/acdc/authoring.ts";
import { RegistryCustody } from "../../../../src/acdc/custody.ts";
import { RootDeferred } from "../../../../src/acdc/salting.ts";
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
import { route, type Scenario, scenario } from "./issuance-fixtures.ts";

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

/** Both parties end the first exchange explicitly, as a user starting over would. */
function abandonBoth(issuer: IssuanceOperations, holder: IssuanceOperations, grant: string) {
  abandonIssuance(issuer, grant, "starting over");
  abandonIssuance(holder, grant, "starting over");
  assertEquals([issuanceStatus(issuer, grant).state, issuanceStatus(holder, grant).state], ["abandoned", "abandoned"]);
}

Deno.test("an exchange abandoned after both roots were retained is replaced by a new Grant on both sides", async () => {
  await run(function*() {
    const s = yield* scenario(), first = yield* bothRetained(s), { holderOps, issuerHab, holderHab, reg } = first;
    const keys = [issuerHab.pre!, reg.regid], oldRoot = issuerHab.mgr.getRegistryRoot(issuerHab.pre!, reg.regid)!.qb64;
    s.issuer.runtime.ipex!.release(issuerHab.pre!);
    const reloaded = s.owner();
    abandonBoth(reloaded, holderOps, first.grant);
    const second = yield* beginIssuance(reloaded, {
      hab: issuerHab,
      credential: reg.credential(),
      options: { recipient: holderHab.pre!, message: "Issue again" },
    });
    assertEquals(
      issuerHab.mgr.ks.registryRootGrant(keys),
      first.grant,
      "the old root stays until the new exchange retains",
    );
    yield* reloaded.processOnce();
    approveIssuanceExchange(holderOps, { hab: holderHab, grant: second.grant });
    yield* exchange(
      reloaded,
      holderOps,
      () =>
        issuanceStatus(holderOps, second.grant).state === "active"
        && "needs" in issuanceStatus(holderOps, second.grant),
    );
    assertEquals(issuanceStatus(reloaded, second.grant), { state: "done", role: "issuer", phase: "issued" });
    const ready = issuanceStatus(holderOps, second.grant);
    assertEquals(ready.state === "active" && [ready.phase, ready.needs], ["awaitingAdmitConsent", "admit"]);
    const root = issuerHab.mgr.getRegistryRoot(issuerHab.pre!, reg.regid)!.qb64;
    assert(root !== oldRoot, "the root was replaced");
    assertEquals(holderHab.mgr.getRegistryRoot(holderHab.pre!, reg.regid)!.qb64, root);
    assertEquals([
      issuerHab.mgr.ks.registryRootGrant(keys),
      holderHab.mgr.ks.registryRootGrant([holderHab.pre!, reg.regid]),
    ], [
      second.grant,
      second.grant,
    ]);
    assertEquals(s.holder.rgy.store.headEvent(reg.regid)!.ilk, "bup");
  });
});

Deno.test("a second interruption before the new exchange retains its root leaves the old root and a way back", async () => {
  await run(function*() {
    const s = yield* scenario(), first = yield* bothRetained(s), { holderOps, issuerHab, holderHab, reg } = first;
    const held: Uint8Array[] = [], deliver = route([s.issuer, s.holder], s.log);
    let hold = false;
    const delivery = {
      *deliver(sent: { src: string; dest: string; msg: Uint8Array }) {
        if (hold && parseBytes(sent.msg)[0].body.ilk === "qry") {
          held.push(sent.msg); // the second query is in flight when the holder restarts
          return [sent.dest];
        }
        return yield* deliver(sent);
      },
    };
    s.issuer.runtime.ipex!.release(issuerHab.pre!);
    const reloaded = s.owner({ delivery });
    abandonBoth(reloaded, holderOps, first.grant);
    hold = true;
    const second = yield* beginIssuance(reloaded, {
      hab: issuerHab,
      credential: reg.credential(),
      options: { recipient: holderHab.pre!, message: "Issue again" },
    });
    yield* reloaded.processOnce(); // the Grant arrives, the query is held back
    assertEquals(held.length, 1);
    const keys = [holderHab.pre!, reg.regid], oldRoot = holderHab.mgr.getRegistryRoot(holderHab.pre!, reg.regid)!.qb64;
    approveIssuanceExchange(holderOps, { hab: holderHab, grant: second.grant });
    assertEquals(
      holderHab.mgr.getRegistryRoot(holderHab.pre!, reg.regid)!.qb64,
      oldRoot,
      "approving overwrites nothing",
    );
    assertEquals(holderHab.mgr.ks.registryRootGrant(keys), first.grant);

    // The holder restarts: the second consent is gone, the registry still has its root, and consent works again.
    s.holder.runtime.ipex!.release(holderHab.pre!);
    const holderAgain = s.holderOwner();
    assertEquals(holderHab.mgr.getRegistryRoot(holderHab.pre!, reg.regid)!.qb64, oldRoot);
    assertEquals(issuanceStatus(holderAgain, second.grant).state, "interrupted");
    approveIssuanceExchange(holderAgain, { hab: holderHab, grant: second.grant });
    hold = false;
    s.clock.skew += 1100; // the issuer resends its unchanged query
    for (let i = 0; i < 40 && issuanceStatus(reloaded, second.grant).state === "active"; i++) {
      yield* reloaded.processOnce();
      yield* holderAgain.processOnce();
    }
    assertEquals(issuanceStatus(reloaded, second.grant), { state: "done", role: "issuer", phase: "issued" });
    assertEquals(holderHab.mgr.ks.registryRootGrant(keys), second.grant);
    assert(holderHab.mgr.getRegistryRoot(holderHab.pre!, reg.regid)!.qb64 !== oldRoot);
  });
});

Deno.test("what the rule refuses: an unproven or live exchange, an unbound root, a staged update, an accepted update", async () => {
  await run(function*() {
    // The exchange cannot be proven dead: the operations record is missing while the Grant is still pending.
    const s = yield* scenario(), first = yield* bothRetained(s), { issuerHab, holderHab, reg } = first;
    const credential = s.issuer.runtime.exc.retainedInput(first.grant)!.nests![0].body as SerderACDC;
    s.issuer.runtime.ipex!.release(issuerHab.pre!);
    const lostStore = s.owner({ store: new MemoryIssuanceOperationStore() });
    const options = { recipient: holderHab.pre!, message: "Issue again" };
    yield* refuses(
      () => beginIssuance(lostStore, { hab: issuerHab, credential: reg.credential(), options }),
      "Registry root conflicts with this live DH operation",
    );

    // An unbound root has an unknown origin (for instance provisioned custody): it conflicts as it always did.
    const ended = s.owner();
    abandonIssuance(ended, first.grant);
    issuerHab.mgr.ks.rrgrants.rem([issuerHab.pre!, reg.regid]);
    yield* refuses(
      () => beginIssuance(ended, { hab: issuerHab, credential: reg.credential(), options }),
      "Registry root conflicts with this live DH operation",
    );
    issuerHab.mgr.ks.rrgrants.put([issuerHab.pre!, reg.regid], new Saider({ qb64: first.grant }));

    // A staged update was derived from the old root, so the root is no longer unused.
    const custody = new RegistryCustody({
      hby: s.issuer.hby,
      hab: issuerHab,
      registry: s.issuer.rgy.store,
      store: s.derived,
    });
    new RegistryAuthor(s.issuer.rgy, s.issuer.receiptor, custody).stage(
      s.issuer.rgy.regs.get(reg.regid)!,
      credential,
      "issued",
    );
    assertEquals(s.issuer.rgy.store.headEvent(reg.regid)!.ilk, "rip", "staged, not accepted");
    const root = issuerHab.mgr.getRegistryRoot(issuerHab.pre!, reg.regid)!.qb64;
    yield* refuses(
      () => beginIssuance(ended, { hab: issuerHab, credential: reg.credential(), options }),
      "Registry root conflicts with this live DH operation",
    );
    assertEquals(issuerHab.mgr.getRegistryRoot(issuerHab.pre!, reg.regid)!.qb64, root);
  });
});

Deno.test("once the update is accepted a new exchange on that registry is refused as before and the root is untouched", async () => {
  await run(function*() {
    const s = yield* scenario(), first = yield* bothRetained(s), { issuerOps, issuerHab, holderHab, reg } = first;
    const pending = yield* prepareIssuanceGrant(issuerOps, {
      hab: issuerHab,
      credential: reg.credential(),
      options: { recipient: holderHab.pre!, message: "Issue again" },
    }); // a second Grant, pending while the registry is still fresh
    yield* issuerOps.processOnce(); // the first exchange anchors its update
    assertEquals(s.issuer.rgy.store.headEvent(reg.regid)!.ilk, "bup");
    const root = issuerHab.mgr.getRegistryRoot(issuerHab.pre!, reg.regid)!.qb64;
    assertThrows(
      () => s.issuer.runtime.ipex!.dhke(issuerHab).approve(pending.grant, { replaces: first.grant }),
      ValidationError,
    );
    yield* refuses(
      () =>
        prepareIssuanceGrant(issuerOps, {
          hab: issuerHab,
          credential: reg.credential(),
          options: { recipient: holderHab.pre!, message: "Too late" },
        }),
      "Fresh issuance requires the issuer's accepted anchored RIP without updates",
    );
    assertEquals(issuerHab.mgr.getRegistryRoot(issuerHab.pre!, reg.regid)!.qb64, root);
    assertEquals(issuerHab.mgr.ks.registryRootGrant([issuerHab.pre!, reg.regid]), first.grant);
  });
});

Deno.test("a root that no accepted update commits is never offered for copying to other members", async () => {
  await run(function*() {
    const s = yield* scenario(), { issuerOps, issuerHab, reg } = yield* bothRetained(s);
    const copies = s.issuer.runtime.registryRoot!;
    assertEquals(copies.held(issuerHab.pre!), [reg.regid], "the issuer holds the uncommitted root");
    // Every copy is authorized through `registry()`, which needs the accepted, anchored update.
    assertThrows(() => copies.registry(reg.regid), RootDeferred, "not yet accepted locally");
    yield* issuerOps.processOnce(); // the update is anchored
    assertEquals(copies.registry(reg.regid).said, reg.regid);
  });
});

Deno.test("an expired exchange that left an unused root says to start again, and a later Grant may begin over it", async () => {
  await run(function*() {
    const s = yield* scenario(), first = yield* bothRetained(s), { issuerOps, issuerHab, holderHab, reg } = first;
    const later = yield* prepareIssuanceGrant(issuerOps, {
      hab: issuerHab,
      credential: reg.credential(),
      options: { recipient: holderHab.pre!, message: "Issue again" },
    });
    s.issuer.runtime.ipex!.release(issuerHab.pre!);
    const reloaded = s.owner();
    s.clock.skew = Number(timestampMicros(s.store.get(first.grant)!.deadline)! / 1000n) - Date.now() + 1;
    const expired = issuanceStatus(reloaded, first.grant);
    assertEquals(expired.state, "expired");
    assert(expired.state === "expired" && expired.reason.includes("Start again with a new Grant"), String(expired));
    // The first exchange can no longer finish and its root was never used: the later Grant is not blocked.
    assertEquals((yield* beginIssuance(reloaded, { hab: issuerHab, grant: later.grant })).grant, later.grant);
    assertEquals(
      issuerHab.mgr.ks.registryRootGrant([issuerHab.pre!, reg.regid]),
      first.grant,
      "replaced only on retention",
    );
  });
});

Deno.test("Manager.putRegistryRoot with an exchange: the identical root for the same Grant is a no-op; any other held root refuses", async () => {
  await run(function*() {
    const s = yield* scenario(), { issuerHab, grant, reg } = yield* bothRetained(s);
    const mgr = issuerHab.mgr, root = mgr.getRegistryRoot(issuerHab.pre!, reg.regid)!;
    assertEquals(mgr.registryRootGrant(issuerHab.pre!, reg.regid), grant);
    assertEquals(mgr.putRegistryRoot(issuerHab.pre!, reg.regid, root, { grant }), false);
    assertEquals(mgr.registryRootGrant(issuerHab.pre!, reg.regid), grant);
    const other = new Salter({ raw: crypto.getRandomValues(new Uint8Array(16)), code: MtrDex.Salt_128 });
    assertThrows(() => mgr.putRegistryRoot(issuerHab.pre!, reg.regid, other, { grant }), Error, "already retained");
    assertThrows(
      () => mgr.putRegistryRoot(issuerHab.pre!, reg.regid, root, { grant: reg.regid }),
      Error,
      "different exchange",
    );
    assertEquals(mgr.putRegistryRoot(issuerHab.pre!, reg.regid, root), false, "unbound repeat of an identical root");
    assertEquals(mgr.getRegistryRoot(issuerHab.pre!, reg.regid)!.qb64, root.qb64);
  });
});
