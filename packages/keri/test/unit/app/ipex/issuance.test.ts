/**
 * Single-signature issuance operations over two in-process parties. Origins: KERIpy `IpexV2Issuance`
 * (`keri/cli/common/issuing.py`) cases are named "issuing.py: ...". KERIpy's only test in this area,
 * `tests/cli/common/test_issuing.py::test_record_publishes_initial_output_atomically`, covers the `--output`
 * evidence file of the Python CLI, which `tufa ipex --issue` has no counterpart for (its `--out` is an
 * exclusive-create write of the prepared Grant), so nothing of it is ported.
 */
import { bytesEqual, parseBytes } from "cesr-ts";
import { type Operation, run, sleep } from "effection";
import { assert, assertEquals, assertThrows } from "jsr:@std/assert";
import {
  abandonIssuance,
  approveIssuanceExchange,
  beginIssuance,
  type IssuanceStatus,
  issuanceStatus,
  prepareIssuanceGrant,
  proposeIssuance,
  waitForIssuance,
} from "../../../../src/app/ipex/issuance.ts";
import { ValidationError } from "../../../../src/core/errors.ts";
import { deadlineOf, pastDeadline, pump, route, type Scenario, scenario } from "./issuance-fixtures.ts";

const grantOptions = (s: Scenario, index = 0) => ({ recipient: s.holder.habs[index].pre!, message: "Issue" });
const text = (msg: Uint8Array) => new TextDecoder().decode(msg);

/** Drive both sides until `grants` have all left the active state or `passes` run out. */
function* settle(s: Scenario, ops: ReturnType<Scenario["owner"]>, grants: string[], passes = 40) {
  const deliver = route([s.issuer, s.holder], s.log);
  for (let i = 0; i < passes; i++) {
    yield* ops.processOnce();
    yield* pump(s.holder, deliver);
    if (grants.every((g) => issuanceStatus(ops, g).state !== "active")) return;
  }
}

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

/** The holder's explicit consent, which in these tests is the raw DH owner. */
function holderApproves(s: Scenario, grant: string, index = 0) {
  return s.holder.runtime.ipex!.dhke(s.holder.habs[index]).approve(grant);
}

Deno.test("issuance completes: Grant, query, reply, anchored BUP, finish, proof support, done", async () => {
  await run(function*() {
    const phases: string[] = [];
    let ops!: ReturnType<Scenario["owner"]>, grant = "";
    const s = yield* scenario(1, () => {
      if (grant) phases.push((issuanceStatus(ops, grant) as { phase: string }).phase);
    });
    const hab = s.issuer.habs[0], reg = yield* s.registry(0);
    ops = s.owner();
    const credential = reg.credential();
    const begun = yield* proposeIssuance(ops, { credential, options: grantOptions(s) });
    grant = begun.grant;
    assertEquals(issuanceStatus(ops, grant), {
      state: "active",
      role: "issuer",
      phase: "exchangingKeys",
      deadline: deadlineOf(s.issuer, grant),
    });
    assertEquals(s.log.length, 0, "begin sends nothing");
    yield* ops.processOnce();
    assertEquals(s.log.length, 2, "proof support with the Grant, then the query");
    assert(text(s.log[0].msg).includes("/ipex/grant"));
    assert(text(s.log[1].msg).includes("/ipex/dhke") && parseBytes(s.log[1].msg)[0].body.ilk === "qry");
    holderApproves(s, grant);
    const sn = hab.kever!.sn;
    yield* settle(s, ops, [grant]);
    assertEquals(issuanceStatus(ops, grant), { state: "done", role: "issuer", phase: "issued" });
    assertEquals(phases, ["awaitingAnchor"], "the anchor receipt is collected while awaitingAnchor");
    assertEquals(hab.kever!.sn, sn + 1, "exactly one KEL event anchors the registry update");
    assertEquals(s.issuer.rgy.store.headEvent(reg.regid)!.ilk, "bup");
    assert(s.issuer.runtime.exc.complete(grant));
    const last = s.log.at(-1)!;
    assertEquals(last.dest, s.holder.habs[0].pre);
    assert(!text(last.msg).includes("/ipex/grant"), "final message is proof support only");
    // The independent holder can finish the original Grant from what crossed the wire.
    assertEquals((yield* s.holder.runtime.ipex!.dhke(s.holder.habs[0]).finish(grant)).kind, "accept");
    const root = hab.mgr.getRegistryRoot(hab.pre!, credential.regid!)!;
    assertEquals(s.holder.habs[0].mgr.getRegistryRoot(s.holder.habs[0].pre!, credential.regid!)!.qb64, root.qb64);
    assertEquals(new Set(s.changes.map((c) => c.id)), new Set([grant]));
    assertThrows(
      () => s.issuer.runtime.ipex!.dhke(hab).complete(grant),
      ValidationError,
      "unavailable, terminated or expired",
    );
  });
});

Deno.test("the query is resent each second, freshly dated with the same keys, until DH completes", async () => {
  await run(function*() {
    const s = yield* scenario(), ops = s.owner(), reg = yield* s.registry(0);
    const { grant } = yield* proposeIssuance(ops, { credential: reg.credential(), options: grantOptions(s) });
    const queries = () => s.log.filter((m) => text(m.msg).includes("/ipex/dhke"));
    yield* ops.processOnce();
    yield* ops.processOnce();
    assertEquals(queries().length, 1, "no resend before a second has passed");
    s.clock.skew += 1100;
    yield* ops.processOnce();
    assertEquals(queries().length, 2);
    const [first, resent] = queries().map((sent) => new TextDecoder().decode(parseBytes(sent.msg)[0].body.raw));
    assert(first !== resent, "an identical resend would be a KRAM replay");
    const keys = (query: string) => JSON.stringify(JSON.parse(query).q);
    assertEquals(keys(resent), keys(first), "start() is not repeated: same transaction and ephemeral keys");
    assertEquals(issuanceStatus(ops, grant).state, "active");
  });
});

Deno.test("issuing.py: a Grant past its original exchange deadline reads expired and nothing more is signed or sent", async () => {
  await run(function*() {
    const s = yield* scenario(), ops = s.owner(), reg = yield* s.registry(0), hab = s.issuer.habs[0];
    const { grant } = yield* proposeIssuance(ops, { credential: reg.credential(), options: grantOptions(s) });
    yield* ops.processOnce();
    const sent = s.log.length, sn = hab.kever!.sn;
    s.clock.skew = pastDeadline(s.issuer, grant);
    assertEquals(issuanceStatus(ops, grant).state, "expired", "the pure read already knows");
    yield* ops.processOnce();
    assertEquals(issuanceStatus(ops, grant).state, "expired");
    assertEquals([s.log.length, hab.kever!.sn], [sent, sn]);
    assertThrows(() => s.issuer.runtime.ipex!.dhke(hab).complete(grant), ValidationError);
    yield* ops.processOnce();
    assertEquals(s.log.length, sent);
  });
});

Deno.test("a holder that never replies leaves the wait timed-out; abandon is local and final", async () => {
  await run(function*() {
    const s = yield* scenario(), ops = s.owner(), reg = yield* s.registry(0), hab = s.issuer.habs[0];
    const { grant } = yield* proposeIssuance(ops, { credential: reg.credential(), options: grantOptions(s) });
    yield* ops.processOnce();
    const waited = yield* waitForIssuance(ops, grant, { timeoutMs: 150 });
    assertEquals(waited.outcome, "timed-out");
    assertEquals(waited.status.state, "active");
    assertEquals(waited.outcome === "timed-out" && waited.timeoutMs, 150);
    const sent = s.log.length;
    abandonIssuance(ops, grant, "no reply");
    assertEquals(issuanceStatus(ops, grant), { state: "abandoned", role: "issuer", reason: "no reply" });
    assertEquals((yield* waitForIssuance(ops, grant, { timeoutMs: 150 })).outcome, "settled");
    yield* ops.processOnce();
    assertEquals(s.log.length, sent);
    assertThrows(() => s.issuer.runtime.ipex!.dhke(hab).complete(grant), ValidationError);
    abandonIssuance(ops, grant);
    assertEquals(
      issuanceStatus(ops, grant),
      { state: "abandoned", role: "issuer", reason: "no reply" },
      "a second abandon changes nothing",
    );
    assertEquals(hab.mgr.getRegistryRoot(hab.pre!, reg.regid), null);
  });
});

Deno.test("a failed delivery is retried with backoff and the issuance goes on once the transport recovers", async () => {
  await run(function*() {
    const s = yield* scenario(), ops = s.owner(), reg = yield* s.registry(0), hab = s.issuer.habs[0];
    const { grant } = yield* proposeIssuance(ops, { credential: reg.credential(), options: grantOptions(s) });
    s.fail.on = true;
    yield* ops.processOnce();
    assertEquals(issuanceStatus(ops, grant).state, "active", "the first failure does not end the issuance");
    yield* ops.processOnce();
    assertEquals(s.log.length, 1, "no new attempt before the backoff has passed");
    s.fail.on = false;
    s.clock.skew += 1100;
    yield* ops.processOnce();
    assert(text(s.log[1].msg).includes("/ipex/grant"), "the queued Grant is delivered first");
    assert(s.log.length >= 3 && text(s.log[2].msg).includes("/ipex/dhke"), "then the query");
    assertEquals(issuanceStatus(ops, grant).state, "active");
  });
});

Deno.test("delivery failures last no longer than the Grant deadline: the issuance then reads expired", async () => {
  await run(function*() {
    const s = yield* scenario(), ops = s.owner(), reg = yield* s.registry(0), hab = s.issuer.habs[0];
    const { grant } = yield* proposeIssuance(ops, { credential: reg.credential(), options: grantOptions(s) });
    s.fail.on = true;
    yield* ops.processOnce();
    s.clock.skew = pastDeadline(s.issuer, grant);
    yield* ops.processOnce();
    assertEquals(issuanceStatus(ops, grant).state, "expired");
  });
});

Deno.test("begin refuses another identifier's Grant and a repeat; status of an unknown Grant is refused", async () => {
  await run(function*() {
    const s = yield* scenario(2), ops = s.owner(), reg = yield* s.registry(0);
    const [a, b] = s.issuer.habs;
    const prepared = yield* prepareIssuanceGrant(ops, {
      credential: reg.credential(),
      options: grantOptions(s),
    });
    yield* refuses(() => beginIssuance(ops, prepared.grant), "exact unanchored pending");
    yield* beginIssuance(ops, prepared.grant);
    yield* refuses(() => beginIssuance(ops, prepared.grant), "already begun");
    assertThrows(() => issuanceStatus(ops, "Eunknown"), ValidationError, "No issuance");
  });
});

Deno.test("reload mid-exchange: interrupted; a new Grant replaces the holder's unused root once its old exchange is abandoned", async () => {
  await run(function*() {
    const s = yield* scenario(), ops = s.owner(), holderOps = s.holderOwner(), reg = yield* s.registry(0);
    const hab = s.issuer.habs[0], holderHab = s.holder.habs[0];
    const first = yield* proposeIssuance(ops, { credential: reg.credential(), options: grantOptions(s) });
    yield* ops.processOnce();
    approveIssuanceExchange(holderOps, first.grant); // retains the root on replying
    const lateReply = s.holder.runtime.ipex!.dhke(holderHab).outgoing.pull()!;
    const firstRoot = holderHab.mgr.getRegistryRoot(holderHab.pre!, reg.regid)!;

    // Reload: ephemeral DH keys and the live table are gone; the protocol stores remain.
    s.issuer.runtime.ipex!.release(hab.pre!);
    const sent = s.log.length, sn = hab.kever!.sn, reloaded = s.owner();
    assertEquals(issuanceStatus(reloaded, first.grant).state, "interrupted");
    yield* reloaded.processOnce();
    assertEquals(issuanceStatus(reloaded, first.grant).state, "interrupted");
    assertEquals([s.log.length, hab.kever!.sn], [sent, sn], "no message sent, no KEL event signed");
    try {
      yield* s.issuer.runtime.reactor.processBytes(lateReply.msg); // the reply that was in flight
    } catch { /* an unowned reply may surface as a routing error; either way it changes nothing */ }
    assertEquals(hab.mgr.getRegistryRoot(hab.pre!, reg.regid), null);
    assertEquals(issuanceStatus(reloaded, first.grant).state, "interrupted");

    // A NEW Grant on the same registry begins on the issuer ...
    const second = yield* proposeIssuance(reloaded, { credential: reg.credential(), options: grantOptions(s) });
    yield* reloaded.processOnce();
    assertEquals(issuanceStatus(reloaded, second.grant).state, "active");
    // ... the holder's first exchange is still live there, so resuming it is preferred and the consent is refused ...
    assertThrows(
      () => approveIssuanceExchange(holderOps, second.grant),
      ValidationError,
      "Another live DH operation uses this registry",
    );
    // ... until the user abandons it: the root was never used, so the second exchange may replace it.
    abandonIssuance(holderOps, first.grant, "superseded by a new Grant");
    approveIssuanceExchange(holderOps, second.grant);
    assert(holderHab.mgr.getRegistryRoot(holderHab.pre!, reg.regid)!.qb64 !== firstRoot.qb64);
    for (let i = 0; i < 40 && issuanceStatus(reloaded, second.grant).state === "active"; i++) {
      yield* reloaded.processOnce();
      yield* holderOps.processOnce();
    }
    assertEquals(issuanceStatus(reloaded, second.grant), { state: "done", role: "issuer", phase: "issued" });
    const ready = issuanceStatus(holderOps, second.grant);
    assertEquals(ready.state === "active" && [ready.phase, ready.needs], ["awaitingAdmitConsent", "admit"]);
    assertEquals(
      hab.mgr.getRegistryRoot(hab.pre!, reg.regid)!.qb64,
      holderHab.mgr.getRegistryRoot(holderHab.pre!, reg.regid)!.qb64,
    );
    assertEquals(s.holder.rgy.store.headEvent(reg.regid)!.ilk, "bup");
  });
});

Deno.test("reload after DH completed but before the anchor: interrupted, nothing signed; a new Grant replaces the unused root", async () => {
  await run(function*() {
    const s = yield* scenario(), ops = s.owner(), holderOps = s.holderOwner(), reg = yield* s.registry(0);
    const hab = s.issuer.habs[0], holderHab = s.holder.habs[0];
    const first = yield* proposeIssuance(ops, { credential: reg.credential(), options: grantOptions(s) });
    yield* ops.processOnce();
    approveIssuanceExchange(holderOps, first.grant);
    yield* holderOps.processOnce(); // the reply reaches the issuer: DH is complete on both sides
    const oldRoot = hab.mgr.getRegistryRoot(hab.pre!, reg.regid)!.qb64;
    assert(oldRoot, "the issuer retained the root");
    s.issuer.runtime.ipex!.release(hab.pre!); // reload before the next pass anchors
    const sent = s.log.length, sn = hab.kever!.sn, reloaded = s.owner();
    assertEquals(issuanceStatus(reloaded, first.grant).state, "interrupted");
    yield* reloaded.processOnce();
    assertEquals(issuanceStatus(reloaded, first.grant).state, "interrupted");
    assertEquals([s.log.length, hab.kever!.sn], [sent, sn], "the anchor is not signed without its live authorisation");
    assertEquals(s.issuer.rgy.store.headEvent(reg.regid)!.ilk, "rip");

    // A new Grant begins over the unused root; the old root stays until the new exchange retains its own.
    const second = yield* proposeIssuance(reloaded, { credential: reg.credential(), options: grantOptions(s) });
    assertEquals(hab.mgr.getRegistryRoot(hab.pre!, reg.regid)!.qb64, oldRoot);
    yield* reloaded.processOnce();
    abandonIssuance(holderOps, first.grant, "superseded by a new Grant");
    approveIssuanceExchange(holderOps, second.grant);
    for (let i = 0; i < 40 && issuanceStatus(reloaded, second.grant).state === "active"; i++) {
      yield* reloaded.processOnce();
      yield* holderOps.processOnce();
    }
    assertEquals(issuanceStatus(reloaded, second.grant), { state: "done", role: "issuer", phase: "issued" });
    const ready = issuanceStatus(holderOps, second.grant);
    assertEquals(ready.state === "active" && [ready.phase, ready.needs], ["awaitingAdmitConsent", "admit"]);
    const root = hab.mgr.getRegistryRoot(hab.pre!, reg.regid)!.qb64;
    assert(root !== oldRoot, "the root was replaced");
    assertEquals(holderHab.mgr.getRegistryRoot(holderHab.pre!, reg.regid)!.qb64, root);
    assertEquals(s.holder.rgy.store.headEvent(reg.regid)!.ilk, "bup");
  });
});

Deno.test("late and duplicate DH traffic after completion is harmless", async () => {
  await run(function*() {
    const s = yield* scenario(), ops = s.owner(), reg = yield* s.registry(0), hab = s.issuer.habs[0];
    const { grant } = yield* proposeIssuance(ops, { credential: reg.credential(), options: grantOptions(s) });
    yield* ops.processOnce();
    holderApproves(s, grant);
    const replies: Uint8Array[] = [];
    const deliver = route([s.issuer, s.holder], s.log);
    yield* pump(s.holder, function*(sent) {
      replies.push(sent.msg);
      return yield* deliver(sent);
    });
    yield* settle(s, ops, [grant]);
    assertEquals(issuanceStatus(ops, grant).state, "done");
    const sent = s.log.length, sn = hab.kever!.sn, head = s.issuer.rgy.store.headEvent(reg.regid)!.said;
    const queries = s.log.filter((m) => text(m.msg).includes("/ipex/dhke") && parseBytes(m.msg)[0].body.ilk === "qry");
    for (const bytes of [...replies, queries[0].msg]) {
      for (const party of [s.issuer, s.holder]) {
        try {
          yield* party.runtime.reactor.processBytes(bytes);
        } catch { /* an unowned message may surface as a routing error; it must change nothing */ }
      }
    }
    yield* ops.processOnce();
    assertEquals(issuanceStatus(ops, grant), { state: "done", role: "issuer", phase: "issued" });
    assertEquals([s.log.length, hab.kever!.sn, s.issuer.rgy.store.headEvent(reg.regid)!.said], [sent, sn, head]);
  });
});

Deno.test("two identifiers issue concurrently on one owner without crossing", async () => {
  await run(function*() {
    const s = yield* scenario(2), ops = s.owner();
    const regs = [yield* s.registry(0), yield* s.registry(1)];
    const grants: string[] = [];
    for (const [i, hab] of s.issuer.habs.entries()) {
      grants.push(
        (yield* proposeIssuance(ops, { credential: regs[i].credential(), options: grantOptions(s, i) })).grant,
      );
    }
    yield* ops.processOnce();
    for (const [i, grant] of grants.entries()) holderApproves(s, grant, i);
    yield* settle(s, ops, grants);
    for (const [i, grant] of grants.entries()) {
      assertEquals(issuanceStatus(ops, grant).state, "done");
      const [issuerHab, holderHab] = [s.issuer.habs[i], s.holder.habs[i]], other = s.issuer.habs[1 - i];
      assert(issuerHab.mgr.getRegistryRoot(issuerHab.pre!, regs[i].regid));
      assertEquals(other.mgr.getRegistryRoot(other.pre!, regs[i].regid), null, "the other identifier holds no root");
      assertEquals(
        issuerHab.mgr.getRegistryRoot(issuerHab.pre!, regs[i].regid)!.qb64,
        holderHab.mgr.getRegistryRoot(holderHab.pre!, regs[i].regid)!.qb64,
      );
      assertEquals(s.log.filter((m) => m.src === issuerHab.pre).every((m) => m.dest === holderHab.pre), true);
    }
    assert(grants[0] !== grants[1]);
  });
});

Deno.test("a query the peer never got is replaced by a freshly dated one, which is accepted", async () => {
  await run(function*() {
    // A 300 ms single-key window lets the query age in real time.
    const s = yield* scenario(1, undefined, true, {
      enabled: true,
      caches: { "~": [100, 300, 60000, 300000, 300, 60000, 300000] },
    });
    let lose = true;
    const queries: Uint8Array[] = [];
    const ops = s.owner({
      queryResendMs: 100,
      delivery: {
        *deliver(sent) {
          if (text(sent.msg).includes("/ipex/dhke") && parseBytes(sent.msg)[0].body.ilk === "qry") {
            queries.push(sent.msg);
            if (lose) return [sent.dest]; // the transport reported success, the peer never got it
          }
          return yield* s.delivery(sent);
        },
      },
    });
    const reg = yield* s.registry(0);
    const { grant } = yield* proposeIssuance(ops, { credential: reg.credential(), options: grantOptions(s) });
    yield* ops.processOnce();
    holderApproves(s, grant); // the Grant arrived; the query did not
    yield* sleep(350); // past the 100 ms resend interval and the 300 ms window
    lose = false;
    yield* ops.processOnce();
    assertEquals(queries.length, 2, "the query was due again");
    assert(text(queries[0]) !== text(queries[1]), "the resend is signed with a new date, not repeated");
    yield* settle(s, ops, [grant]);
    assertEquals(issuanceStatus(ops, grant), { state: "done", role: "issuer", phase: "issued" });
  });
});

Deno.test("a peer that took the query and lost it before consenting still answers it from the persisted copy", async () => {
  await run(function*() {
    const s = yield* scenario(), ops = s.owner(), reg = yield* s.registry(0);
    const { grant } = yield* proposeIssuance(ops, { credential: reg.credential(), options: grantOptions(s) });
    yield* ops.processOnce(); // Grant and query reach the holder, which retains the query for its consent
    const holderDh = s.holder.runtime.ipex!.dhke(s.holder.habs[0]);
    holderDh.close(); // the process that held it ends: KRAM keeps the replay record, the persisted query stays
    holderApproves(s, grant);
    assertEquals(holderDh.outgoing.length, 1, "consent replays the persisted query without a resend");
    yield* settle(s, ops, [grant]);
    assertEquals(issuanceStatus(ops, grant), { state: "done", role: "issuer", phase: "issued" });
  });
});

Deno.test("a fresh query that reaches a peer holding a persisted one replaces it, and consent answers the latest", async () => {
  await run(function*() {
    const s = yield* scenario(), ops = s.owner(), reg = yield* s.registry(0);
    const { grant } = yield* proposeIssuance(ops, { credential: reg.credential(), options: grantOptions(s) });
    yield* ops.processOnce();
    const holderDh = s.holder.runtime.ipex!.dhke(s.holder.habs[0]);
    holderDh.close();
    const db = s.holder.hby.db, first = db.heldq.get([grant]);
    assert(first);
    s.clock.skew += 1100; // past the single-key window: the issuer signs a fresh query on its next resend
    yield* ops.processOnce();
    const latest = db.heldq.get([grant]);
    assert(latest && !bytesEqual(latest, first), "the successor replaced the persisted query");
    holderApproves(s, grant);
    assertEquals(holderDh.outgoing.length, 1);
    yield* settle(s, ops, [grant]);
    assertEquals(issuanceStatus(ops, grant), { state: "done", role: "issuer", phase: "issued" });
  });
});
