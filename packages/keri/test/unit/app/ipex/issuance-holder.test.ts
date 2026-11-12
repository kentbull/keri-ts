/**
 * Holder side of issuance operations: the exchange consent, reload and expiry, and the separate Admit consent.
 * The issuer runs in its own owner, so both halves of one exchange are the library's code.
 */
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
  waitForIssuance,
} from "../../../../src/app/ipex/issuance.ts";
import { ValidationError } from "../../../../src/core/errors.ts";
import { timestampMicros } from "../../../../src/time/mod.ts";
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
    const s = yield* scenario(), { holderOps, grant, holderHab } = yield* started(s);
    approveIssuanceExchange(holderOps, { hab: holderHab, grant });
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
