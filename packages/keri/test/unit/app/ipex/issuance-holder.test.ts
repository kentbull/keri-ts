/**
 * Holder side of issuance operations: the exchange consent, reload and expiry, and the separate Admit consent.
 * The issuer runs in its own owner, so both halves of one exchange are the library's code.
 */
import { Encrypter, MtrDex, parseBytes, Salter, type SerderACDC } from "cesr-ts";
import { run } from "effection";
import { assert, assertEquals, assertThrows } from "jsr:@std/assert";
import { type Operation } from "npm:effection@^3.6.0";
import { RegistryAuthor } from "../../../../src/acdc/authoring.ts";
import { BaserDerivedUpdateStore, RegistryCustody } from "../../../../src/acdc/custody.ts";
import { RootDeferred } from "../../../../src/acdc/salting.ts";
import {
  abandonIssuance,
  admitIssuance,
  approveIssuanceExchange,
  beginIssuance,
  deliverIssuanceAdmit,
  type IssuanceOperations,
  issuanceStatus,
  prepareIssuanceGrant,
  waitForIssuance,
} from "../../../../src/app/ipex/issuance.ts";
import { ValidationError } from "../../../../src/core/errors.ts";
import { deadlineOf, pastDeadline, route, type Scenario, scenario } from "./issuance-fixtures.ts";

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

Deno.test("holder reload before it answered: consent is asked again, no reply is sent, and nothing can be admitted", async () => {
  await run(function*() {
    const s = yield* scenario(), { holderOps, grant, holderHab, reg } = yield* started(s);
    approveIssuanceExchange(holderOps, { hab: holderHab, grant });
    // As if the process ended before the holder answered: approval retains at once when the query is waiting.
    holderHab.mgr.ks.rroots.rem([holderHab.pre!, reg.regid]);
    s.holder.runtime.ipex!.release(holderHab.pre!);
    const sent = s.log.length, reloaded = s.holderOwner();
    const status = issuanceStatus(reloaded, grant);
    assertEquals(status.state === "active" && [status.phase, status.needs], ["awaitingExchangeConsent", "exchange"]);
    yield* reloaded.processOnce();
    assertEquals(s.log.length, sent);
    let refused = "";
    try {
      yield* admitIssuance(reloaded.deps, { hab: holderHab, grant });
    } catch (error) {
      refused = (error as Error).message;
    }
    assert(refused.includes("Accepted ACDC v2 exchange"), refused);
  });
});

Deno.test("holder expiry and abandon end the exchange locally", async () => {
  await run(function*() {
    const s = yield* scenario(), { holderOps, grant, holderHab } = yield* started(s);
    approveIssuanceExchange(holderOps, { hab: holderHab, grant });
    s.clock.skew = pastDeadline(s.holder, grant);
    assertEquals(issuanceStatus(holderOps, grant).state, "expired");
    const sent = s.log.length;
    yield* holderOps.processOnce();
    assertEquals([issuanceStatus(holderOps, grant).state, s.log.length], ["expired", sent]);

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

Deno.test("Admit of an accepted Grant reads admitted from the stored Admit, and cannot repeat", async () => {
  await run(function*() {
    const s = yield* scenario(), { issuerOps, holderOps, grant, holderHab } = yield* started(s);
    approveIssuanceExchange(holderOps, { hab: holderHab, grant });
    yield* exchange(
      issuerOps,
      holderOps,
      () => issuanceStatus(holderOps, grant).state === "active" && "needs" in issuanceStatus(holderOps, grant),
    );
    yield* admitIssuance(holderOps.deps, { hab: holderHab, grant });
    assertEquals(issuanceStatus(s.holderOwner(), grant), { state: "done", role: "holder", phase: "admitted" });
    let refused = "";
    try {
      yield* admitIssuance(holderOps.deps, { hab: holderHab, grant });
    } catch (error) {
      refused = (error as Error).message;
    }
    assert(refused.includes("cannot be admitted"), refused);
  });
});

/** The holder has consented and answered, and the issuer has the reply: both retained the same root, nothing is anchored. */
function* bothRetained(s: Scenario) {
  const begun = yield* started(s);
  approveIssuanceExchange(begun.holderOps, { hab: begun.holderHab, grant: begun.grant });
  yield* begun.holderOps.processOnce(); // the holder's reply reaches the issuer
  const { issuerHab, holderHab, reg } = begun;
  assert(
    issuerHab.mgr.getRegistryRoot(issuerHab.pre!, reg.regid)
      && holderHab.mgr.getRegistryRoot(holderHab.pre!, reg.regid),
  );
  return begun;
}

Deno.test("holder away while the issuer anchors: the next pass completes it, nothing signed, then Admit", async () => {
  await run(function*() {
    const s = yield* scenario(), { issuerOps, grant, holderHab, reg } = yield* bothRetained(s);
    s.holder.runtime.ipex!.release(holderHab.pre!); // the holder closed its tab
    yield* issuerOps.processOnce(); // the issuer anchors, finishes and sends proof support
    assertEquals(issuanceStatus(issuerOps, grant), { state: "done", role: "issuer", phase: "issued" });
    assertEquals(s.holder.rgy.store.headEvent(reg.regid)!.ilk, "bup", "the update arrived while the holder was away");
    const reloaded = s.holderOwner(), sent = s.log.length, sn = holderHab.kever!.sn;
    const waiting = {
      state: "active",
      role: "holder",
      phase: "rootRetained",
      deadline: deadlineOf(s.holder, grant),
    } as const;
    assertEquals(issuanceStatus(reloaded, grant), waiting);
    assertEquals(s.holder.runtime.exc.complete(grant), false);
    yield* reloaded.processOnce(); // no user step: finishing signs nothing
    yield* reloaded.processOnce();
    const ready = issuanceStatus(reloaded, grant);
    assertEquals(ready.state === "active" && [ready.phase, ready.needs], ["awaitingAdmitConsent", "admit"]);
    assert(s.holder.runtime.exc.complete(grant));
    assertEquals([s.log.length, holderHab.kever!.sn], [sent, sn], "nothing sent, no KEL event signed");
    const admitted = yield* admitIssuance(reloaded.deps, { hab: holderHab, grant });
    yield* deliverIssuanceAdmit(reloaded.deps, holderHab, admitted);
    assertEquals(s.issuer.hby.db.erpy.get([grant])!.qb64, admitted.admit.said);
  });
});

Deno.test("holder restarts before the update: it waits, then completes by itself when the update arrives", async () => {
  await run(function*() {
    const s = yield* scenario(), { issuerOps, grant, holderHab } = yield* bothRetained(s);
    s.holder.runtime.ipex!.release(holderHab.pre!);
    const reloaded = s.holderOwner();
    yield* reloaded.processOnce();
    const waiting = issuanceStatus(reloaded, grant);
    assertEquals(waiting.state === "active" && waiting.phase, "rootRetained");
    assertEquals(s.holder.runtime.exc.complete(grant), false);
    yield* issuerOps.processOnce();
    yield* reloaded.processOnce();
    const ready = issuanceStatus(reloaded, grant);
    assertEquals(ready.state === "active" && ready.phase, "awaitingAdmitConsent");
  });
});

Deno.test("holder away past the deadline: expired, and the reason says when the update arrived in time", async () => {
  await run(function*() {
    const s = yield* scenario(), { grant, holderHab } = yield* bothRetained(s);
    s.holder.runtime.ipex!.release(holderHab.pre!);
    const silent = s.holderOwner();
    s.clock.skew = pastDeadline(s.holder, grant);
    const never = issuanceStatus(silent, grant);
    assertEquals(never.state, "expired");
    assert(never.state === "expired" && !never.reason.includes("update arrived"), String(never));

    // The update arrived in time, but completing a Grant needs it live (`acceptPendingGrantProof`).
    const t = yield* scenario(), late = yield* bothRetained(t);
    t.holder.runtime.ipex!.release(late.holderHab.pre!);
    yield* late.issuerOps.processOnce();
    t.clock.skew = pastDeadline(t.holder, late.grant);
    const returned = t.holderOwner(), status = issuanceStatus(returned, late.grant);
    assertEquals(status.state, "expired");
    assert(status.state === "expired" && status.reason.includes("ask the issuer for a new Grant"), String(status));
    yield* returned.processOnce();
    assertEquals(t.holder.runtime.exc.complete(late.grant), false);
  });
});

Deno.test("a returning holder whose held root does not open the update refuses it and reports why", async () => {
  await run(function*() {
    const s = yield* scenario(), { issuerOps, grant, holderHab, issuerHab, reg } = yield* bothRetained(s);
    const wrong = new Salter({ raw: crypto.getRandomValues(new Uint8Array(16)), code: MtrDex.Salt_128 });
    // The issuer's stored root no longer matches the holder's, so its update opens only under the wrong root.
    issuerHab.mgr.ks.rroots.pin(
      [issuerHab.pre!, reg.regid],
      new Encrypter({ verkey: issuerHab.mgr.aeid }).encrypt({ prim: wrong }),
    );
    s.holder.runtime.ipex!.release(holderHab.pre!);
    yield* issuerOps.processOnce();
    const holderRoot = holderHab.mgr.getRegistryRoot(holderHab.pre!, reg.regid)!.qb64;
    const reloaded = s.holderOwner();
    yield* reloaded.processOnce();
    const failed = issuanceStatus(reloaded, grant);
    assertEquals(failed.state, "failed");
    assert(failed.state === "failed" && failed.reason.includes("does not open this credential"), String(failed));
    assertEquals(s.holder.runtime.exc.complete(grant), false, "the Grant is not accepted");
    assertEquals(holderHab.mgr.getRegistryRoot(holderHab.pre!, reg.regid)!.qb64, holderRoot);
  });
});

Deno.test("an issuer that crashed after anchoring completes by itself without a second update", async () => {
  await run(function*() {
    const s = yield* scenario(), { holderOps, grant, issuerHab, reg } = yield* bothRetained(s);
    const credential = s.issuer.runtime.exc.retainedInput(grant)!.nests![0].body as SerderACDC;
    s.issuer.runtime.ipex!.release(issuerHab.pre!);
    // The crash window: the update is staged, anchored and accepted, but the Grant is not finished or proved.
    const custody = new RegistryCustody({
      hby: s.issuer.hby,
      hab: issuerHab,
      registry: s.issuer.rgy.store,
      store: s.derived,
    });
    const author = new RegistryAuthor(s.issuer.rgy, s.issuer.receiptor, custody),
      registry = s.issuer.rgy.regs.get(reg.regid)!;
    yield* author.anchor(registry, author.stage(registry, credential, "issued").event);
    const head = s.issuer.rgy.store.headEvent(reg.regid)!, sn = issuerHab.kever!.sn;
    assertEquals(head.ilk, "bup");
    const reloaded = s.owner();
    assertEquals(issuanceStatus(reloaded, grant).state === "active" && issuanceStatus(reloaded, grant), {
      state: "active",
      role: "issuer",
      phase: "rootRetained",
      deadline: deadlineOf(s.issuer, grant),
    });
    for (let i = 0; i < 40 && issuanceStatus(reloaded, grant).state === "active"; i++) {
      yield* reloaded.processOnce();
      yield* holderOps.processOnce();
    }
    assertEquals(issuanceStatus(reloaded, grant), { state: "done", role: "issuer", phase: "issued" });
    assertEquals(
      [issuerHab.kever!.sn, s.issuer.rgy.store.headEvent(reg.regid)!.said],
      [sn, head.said],
      "no second update",
    );
    const ready = issuanceStatus(holderOps, grant);
    assertEquals(ready.state === "active" && ready.phase, "awaitingAdmitConsent");
  });
});

Deno.test("two live Grants on one registry cannot both take its root", async () => {
  await run(function*() {
    const s = yield* scenario(), { issuerOps, grant, issuerHab, holderHab, reg } = yield* started(s);
    const other = yield* prepareIssuanceGrant(issuerOps, {
      hab: issuerHab,
      credential: reg.credential(),
      options: { recipient: holderHab.pre!, message: "Issue again" },
    });
    yield* refuses(
      () => beginIssuance(issuerOps, { hab: issuerHab, grant: other.grant }),
      "Another live DH operation uses this registry",
    );
    abandonIssuance(issuerOps, grant, "starting over");
    yield* beginIssuance(issuerOps, { hab: issuerHab, grant: other.grant });
  });
});

Deno.test("a second interruption before the new exchange retains its root leaves the old root", async () => {
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
    abandonIssuance(holderOps, first.grant, "starting over");
    hold = true;
    const second = yield* beginIssuance(reloaded, {
      hab: issuerHab,
      credential: reg.credential(),
      options: { recipient: holderHab.pre!, message: "Issue again" },
    });
    yield* reloaded.processOnce(); // the Grant arrives, the query is held back
    assertEquals(held.length, 1);
    const oldRoot = holderHab.mgr.getRegistryRoot(holderHab.pre!, reg.regid)!.qb64;
    approveIssuanceExchange(holderOps, { hab: holderHab, grant: second.grant });
    assertEquals(
      holderHab.mgr.getRegistryRoot(holderHab.pre!, reg.regid)!.qb64,
      oldRoot,
      "approving overwrites nothing",
    );

    // The holder restarts: the second consent is gone, the registry still has its root, and consent works again.
    s.holder.runtime.ipex!.release(holderHab.pre!);
    const holderAgain = s.holderOwner();
    assertEquals(holderHab.mgr.getRegistryRoot(holderHab.pre!, reg.regid)!.qb64, oldRoot);
    approveIssuanceExchange(holderAgain, { hab: holderHab, grant: second.grant });
    hold = false;
    s.clock.skew += 1100; // the issuer resends its unchanged query
    for (let i = 0; i < 40 && issuanceStatus(reloaded, second.grant).state === "active"; i++) {
      yield* reloaded.processOnce();
      yield* holderAgain.processOnce();
    }
    assertEquals(issuanceStatus(reloaded, second.grant), { state: "done", role: "issuer", phase: "issued" });
    assert(holderHab.mgr.getRegistryRoot(holderHab.pre!, reg.regid)!.qb64 !== oldRoot, "overwritten on retention");
  });
});

Deno.test("a staged or accepted update keeps the refusal of a second exchange on that registry", async () => {
  await run(function*() {
    const s = yield* scenario(), first = yield* bothRetained(s), { issuerOps, issuerHab, holderHab, reg } = first;
    const options = { recipient: holderHab.pre!, message: "Issue again" };
    const credential = s.issuer.runtime.exc.retainedInput(first.grant)!.nests![0].body as SerderACDC;
    const pending = yield* prepareIssuanceGrant(issuerOps, { hab: issuerHab, credential: reg.credential(), options });
    abandonIssuance(issuerOps, first.grant, "starting over");
    // A staged update was derived from the held root, so that root is no longer unused.
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
    // The staged update is listable from the escrow and the held root reproduces its blind: staging it again
    // returns the same event. Anchoring it would need an explicit step this design does not have (reported).
    assertEquals([...s.issuer.rgy.store.baser.maes.getTopItemIter(reg.regid)].length, 1);
    const root = issuerHab.mgr.getRegistryRoot(issuerHab.pre!, reg.regid)!.qb64;
    yield* refuses(
      () => beginIssuance(issuerOps, { hab: issuerHab, grant: pending.grant }),
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
    assertThrows(() => s.issuer.runtime.ipex!.dhke(issuerHab).approve(pending.grant), ValidationError);
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

Deno.test("an honest issuer cannot send a second Grant after anchoring, and a holder with its first exchange live refuses one", async () => {
  await run(function*() {
    const s = yield* scenario(),
      first = yield* bothRetained(s),
      { issuerOps, holderOps, issuerHab, holderHab, reg } = first;
    const options = { recipient: holderHab.pre!, message: "Issue again" };
    const second = yield* prepareIssuanceGrant(issuerOps, { hab: issuerHab, credential: reg.credential(), options });
    // A second Grant is prepared and in hand while the registry is fresh; then the first update is anchored but
    // the holder is away from it. The issuer cannot send the second Grant: its registry is no longer fresh.
    yield* issuerOps.processOnce();
    assertEquals(s.issuer.rgy.store.headEvent(reg.regid)!.ilk, "bup");
    yield* refuses(() => beginIssuance(issuerOps, { hab: issuerHab, grant: second.grant }), "fresh");
    // Even a Grant forced onto the holder (a dishonest issuer) cannot take the root: the first exchange is live.
    yield* s.holder.runtime.reactor.processBytes(second.wire);
    yield* s.holder.runtime.protocol.processEscrowsOnce();
    assertEquals(s.holder.runtime.exc.retainedInput(second.grant, { pending: true }) !== null, true);
    const root = holderHab.mgr.getRegistryRoot(holderHab.pre!, reg.regid)!.qb64;
    assertThrows(
      () => approveIssuanceExchange(holderOps, { hab: holderHab, grant: second.grant }),
      ValidationError,
    );
    assertEquals(holderHab.mgr.getRegistryRoot(holderHab.pre!, reg.regid)!.qb64, root);
  });
});

Deno.test("status after a reopen equals status before, for issuer and holder at each phase the stores prove", async () => {
  await run(function*() {
    const s = yield* scenario(), { issuerOps, holderOps, grant, holderHab, issuerHab } = yield* started(s);
    const reopened = () => [s.owner(), s.holderOwner()] as const;
    // Holder before consent: the pending Grant alone proves it.
    assertEquals(issuanceStatus(reopened()[1], grant), issuanceStatus(holderOps, grant));
    approveIssuanceExchange(holderOps, { hab: holderHab, grant });
    yield* holderOps.processOnce(); // answers; the root is retained and the issuer anchors on its next pass
    s.holder.runtime.ipex!.release(holderHab.pre!);
    assertEquals(issuanceStatus(reopened()[1], grant).state, "active");
    // Holder waiting for the update (root held): live reads rootRetained, a reopened owner reads the same.
    const fresh = s.holderOwner();
    yield* fresh.processOnce();
    const waiting = issuanceStatus(fresh, grant);
    assertEquals(waiting.state === "active" && waiting.phase, "rootRetained");
    assertEquals(issuanceStatus(reopened()[1], grant), waiting);
    // Issuer anchors; holder is ready for Admit; issuer is done.
    yield* issuerOps.processOnce();
    yield* fresh.processOnce();
    for (const [live, again] of [[issuerOps, reopened()[0]], [fresh, reopened()[1]]] as const) {
      assertEquals(issuanceStatus(again, grant), issuanceStatus(live, grant));
    }
    assertEquals(issuanceStatus(reopened()[0], grant), { state: "done", role: "issuer", phase: "issued" });
    // Holder admitted.
    yield* admitIssuance(fresh.deps, { hab: holderHab, grant });
    assertEquals(issuanceStatus(reopened()[1], grant), issuanceStatus(fresh, grant));
    assertEquals(issuanceStatus(reopened()[1], grant), { state: "done", role: "holder", phase: "admitted" });
    assert(issuerHab.pre);
  });
});

Deno.test("the registry database keeps derivation coordinates durably as the runtime default", async () => {
  await run(function*() {
    const s = yield* scenario();
    const store = new BaserDerivedUpdateStore(s.issuer.rgy.store.baser);
    assertEquals(store.get("Eevent"), null);
    store.pin("Eevent", { credential: "Ecred", state: "issued", bound: { bn: "1", bd: "Ebound" } });
    assertEquals(new BaserDerivedUpdateStore(s.issuer.rgy.store.baser).get("Eevent"), {
      credential: "Ecred",
      state: "issued",
      bound: { bn: "1", bd: "Ebound" },
    });
  });
});
