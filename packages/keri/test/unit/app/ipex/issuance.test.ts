/**
 * Single-signature issuance operations over two in-process parties. Origins: KERIpy `IpexV2Issuance`
 * (`keri/cli/common/issuing.py`) cases are named "issuing.py: ...". KERIpy's only test in this area,
 * `tests/cli/common/test_issuing.py::test_record_publishes_initial_output_atomically`, covers the `--output`
 * evidence file of the Python CLI, which `tufa ipex --issue` has no counterpart for (its `--out` is an
 * exclusive-create write of the prepared Grant), so nothing of it is ported.
 */
import { parseBytes } from "cesr-ts";
import { type Operation, run } from "effection";
import { assert, assertEquals, assertThrows } from "jsr:@std/assert";
import {
  abandonIssuance,
  beginIssuance,
  type IssuanceStatus,
  issuanceStatus,
  prepareIssuanceGrant,
  resumeIssuance,
  waitForIssuance,
} from "../../../../src/app/ipex/issuance.ts";
import { ValidationError } from "../../../../src/core/errors.ts";
import { timestampMicros } from "../../../../src/time/mod.ts";
import { pump, route, type Scenario, scenario } from "./issuance-fixtures.ts";

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
    const begun = yield* beginIssuance(ops, { hab, credential, options: grantOptions(s) });
    grant = begun.grant;
    assertEquals(issuanceStatus(ops, grant), {
      state: "active",
      role: "issuer",
      phase: "exchangingKeys",
      deadline: s.store.get(grant)!.deadline,
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
    assert(!JSON.stringify(s.store.list()).includes(root.qb64), "the durable record holds no secret");
    assertEquals(new Set(s.changes.map((c) => c.id)), new Set([grant]));
    assertThrows(
      () => s.issuer.runtime.ipex!.dhke(hab).complete(grant),
      ValidationError,
      "unavailable, terminated or expired",
    );
  });
});

Deno.test("issuing.py: the query is resent unchanged each second until DH completes", async () => {
  await run(function*() {
    const s = yield* scenario(), ops = s.owner(), reg = yield* s.registry(0);
    const { grant } = yield* beginIssuance(ops, {
      hab: s.issuer.habs[0],
      credential: reg.credential(),
      options: grantOptions(s),
    });
    const queries = () => s.log.filter((m) => text(m.msg).includes("/ipex/dhke"));
    yield* ops.processOnce();
    yield* ops.processOnce();
    assertEquals(queries().length, 1, "no resend before a second has passed");
    s.clock.skew += 1100;
    yield* ops.processOnce();
    assertEquals(queries().length, 2);
    assertEquals(queries()[1].msg, queries()[0].msg, "start() is not repeated: same bytes, keys and lifetime");
    assertEquals(issuanceStatus(ops, grant).state, "active");
  });
});

Deno.test("issuing.py: a Grant past its original exchange deadline reads expired and nothing more is signed or sent", async () => {
  await run(function*() {
    const s = yield* scenario(), ops = s.owner(), reg = yield* s.registry(0), hab = s.issuer.habs[0];
    const { grant } = yield* beginIssuance(ops, { hab, credential: reg.credential(), options: grantOptions(s) });
    yield* ops.processOnce();
    const sent = s.log.length, sn = hab.kever!.sn;
    s.clock.skew = Number(timestampMicros(s.store.get(grant)!.deadline)! / 1000n) - Date.now() + 1;
    assertEquals(issuanceStatus(ops, grant).state, "expired", "the pure read already knows");
    yield* ops.processOnce();
    assertEquals(s.store.get(grant)!.ended!.state, "expired");
    assertEquals([s.log.length, hab.kever!.sn], [sent, sn]);
    assertThrows(() => s.issuer.runtime.ipex!.dhke(hab).complete(grant), ValidationError);
    yield* ops.processOnce();
    assertEquals(s.log.length, sent);
  });
});

Deno.test("a holder that never replies leaves the wait timed-out; abandon is local and final", async () => {
  await run(function*() {
    const s = yield* scenario(), ops = s.owner(), reg = yield* s.registry(0), hab = s.issuer.habs[0];
    const { grant } = yield* beginIssuance(ops, { hab, credential: reg.credential(), options: grantOptions(s) });
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
    assertEquals(s.store.get(grant)!.ended!.reason, "no reply", "a second abandon changes nothing");
    assertEquals(hab.mgr.getRegistryRoot(hab.pre!, reg.regid), null);
  });
});

Deno.test("a failed delivery ends the issuance as failed with the transport's reason", async () => {
  await run(function*() {
    const s = yield* scenario(), ops = s.owner(), reg = yield* s.registry(0), hab = s.issuer.habs[0];
    const { grant } = yield* beginIssuance(ops, { hab, credential: reg.credential(), options: grantOptions(s) });
    s.fail.on = true;
    yield* ops.processOnce();
    assertEquals(issuanceStatus(ops, grant), { state: "failed", role: "issuer", reason: "transport failed" });
  });
});

Deno.test("begin refuses another identifier's Grant and a repeat; status of an unknown Grant is refused", async () => {
  await run(function*() {
    const s = yield* scenario(2), ops = s.owner(), reg = yield* s.registry(0);
    const [a, b] = s.issuer.habs;
    const prepared = yield* prepareIssuanceGrant(ops, {
      hab: a,
      credential: reg.credential(),
      options: grantOptions(s),
    });
    yield* refuses(() => beginIssuance(ops, { hab: b, grant: prepared.grant }), "exact unanchored pending");
    yield* beginIssuance(ops, { hab: a, grant: prepared.grant });
    yield* refuses(() => beginIssuance(ops, { hab: a, grant: prepared.grant }), "already begun");
    assertThrows(() => issuanceStatus(ops, "Eunknown"), ValidationError, "No issuance");
  });
});

Deno.test("reload mid-exchange: interrupted, nothing signed or sent; a new Grant starts but the holder's retained root blocks its consent", async () => {
  await run(function*() {
    const s = yield* scenario(), ops = s.owner(), reg = yield* s.registry(0), hab = s.issuer.habs[0];
    const first = yield* beginIssuance(ops, { hab, credential: reg.credential(), options: grantOptions(s) });
    yield* ops.processOnce();
    holderApproves(s, first.grant); // the holder generates keys, retains the root and queues its reply
    const holderHab = s.holder.habs[0], lateReply = s.holder.runtime.ipex!.dhke(holderHab).outgoing.pull()!;
    assert(holderHab.mgr.getRegistryRoot(holderHab.pre!, reg.regid), "the holder retained the root on replying");

    // Reload: ephemeral DH keys and the live table are gone; the stores and the operation store remain.
    s.issuer.runtime.ipex!.release(hab.pre!);
    const sent = s.log.length, sn = hab.kever!.sn, reloaded = s.owner();
    assertEquals(issuanceStatus(reloaded, first.grant).state, "interrupted");
    yield* reloaded.processOnce();
    assertEquals(s.store.get(first.grant)!.ended!.state, "interrupted");
    assertEquals([s.log.length, hab.kever!.sn], [sent, sn], "no message sent, no KEL event signed");
    try {
      yield* s.issuer.runtime.reactor.processBytes(lateReply.msg); // the reply that was in flight
    } catch { /* an unowned reply may surface as a routing error; either way it changes nothing */ }
    assertEquals(hab.mgr.getRegistryRoot(hab.pre!, reg.regid), null);
    assertEquals(issuanceStatus(reloaded, first.grant).state, "interrupted");

    // A NEW Grant on the same registry begins on the issuer ...
    const second = yield* beginIssuance(reloaded, { hab, credential: reg.credential(), options: grantOptions(s) });
    yield* reloaded.processOnce();
    assertEquals(issuanceStatus(reloaded, second.grant).state, "active");
    // ... but the holder still holds the first exchange's root and cannot consent to the second.
    assertThrows(
      () => holderApproves(s, second.grant),
      ValidationError,
      "Registry root conflicts with this live DH operation",
    );
  });
});

Deno.test("reload after DH completed but before the anchor: resumable, nothing signed until the user resumes, then it completes", async () => {
  await run(function*() {
    const s = yield* scenario(), ops = s.owner(), reg = yield* s.registry(0), hab = s.issuer.habs[0];
    const first = yield* beginIssuance(ops, { hab, credential: reg.credential(), options: grantOptions(s) });
    yield* ops.processOnce();
    holderApproves(s, first.grant);
    yield* pump(s.holder, route([s.issuer, s.holder], s.log)); // the reply reaches the issuer: DH is complete
    assert(hab.mgr.getRegistryRoot(hab.pre!, reg.regid), "the issuer retained the root");
    s.issuer.runtime.ipex!.release(hab.pre!); // reload before the next pass anchors
    const sent = s.log.length, sn = hab.kever!.sn, reloaded = s.owner();
    assertEquals(issuanceStatus(reloaded, first.grant), {
      state: "active",
      role: "issuer",
      phase: "rootRetained",
      needs: "anchor",
      deadline: s.store.get(first.grant)!.deadline,
    });
    yield* reloaded.processOnce();
    assertEquals(s.store.get(first.grant)!.ended, undefined, "the restart does not end a resumable issuance");
    assertEquals([s.log.length, hab.kever!.sn], [sent, sn], "the anchor is not signed without its live authorisation");
    assertEquals(s.issuer.rgy.store.headEvent(reg.regid)!.ilk, "rip");
    // While the first Grant can resume, a new Grant on its registry is still refused: resume is preferred.
    yield* refuses(
      () => beginIssuance(reloaded, { hab, credential: reg.credential(), options: grantOptions(s) }),
      "Registry root conflicts with this live DH operation",
    );
    yield* refuses(() => resumeIssuance(reloaded, { hab: s.issuer.habs[0], grant: "Eunknown" }), "can be resumed");

    // The user's explicit step re-establishes the authorisation; the loop then finishes as if uninterrupted.
    yield* resumeIssuance(reloaded, { hab, grant: first.grant });
    assertEquals(
      issuanceStatus(reloaded, first.grant).state === "active" && "needs" in issuanceStatus(reloaded, first.grant),
      false,
    );
    assertEquals(s.log.length, sent, "resuming sends nothing itself");
    yield* reloaded.processOnce();
    assertEquals(issuanceStatus(reloaded, first.grant), { state: "done", role: "issuer", phase: "issued" });
    assertEquals(hab.kever!.sn, sn + 1, "exactly one KEL event anchors the registry update");
    assertEquals(s.issuer.rgy.store.headEvent(reg.regid)!.ilk, "bup");
    assert(s.issuer.runtime.exc.complete(first.grant));
    assert(
      !text(s.log.at(-1)!.msg).includes("/ipex/grant"),
      "final message is proof support only, the Grant is not resent",
    );
    // The holder verifies the update against the root it retained before the restart.
    assertEquals((yield* s.holder.runtime.ipex!.dhke(s.holder.habs[0]).finish(first.grant)).kind, "accept");
    assertEquals(s.store.get(first.grant)!.resumed !== undefined, true);
  });
});

Deno.test("late and duplicate DH traffic after completion is harmless", async () => {
  await run(function*() {
    const s = yield* scenario(), ops = s.owner(), reg = yield* s.registry(0), hab = s.issuer.habs[0];
    const { grant } = yield* beginIssuance(ops, { hab, credential: reg.credential(), options: grantOptions(s) });
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
        (yield* beginIssuance(ops, { hab, credential: regs[i].credential(), options: grantOptions(s, i) })).grant,
      );
    }
    yield* ops.processOnce();
    for (const [i, grant] of grants.entries()) holderApproves(s, grant, i);
    yield* settle(s, ops, grants);
    for (const [i, grant] of grants.entries()) {
      assertEquals(issuanceStatus(ops, grant).state, "done");
      const [issuerHab, holderHab] = [s.issuer.habs[i], s.holder.habs[i]], other = s.issuer.habs[1 - i];
      assertEquals(s.store.get(grant)!.hab, issuerHab.pre);
      assert(issuerHab.mgr.getRegistryRoot(issuerHab.pre!, regs[i].regid));
      assertEquals(other.mgr.getRegistryRoot(other.pre!, regs[i].regid), null, "the other identifier holds no root");
      assertEquals(
        issuerHab.mgr.getRegistryRoot(issuerHab.pre!, regs[i].regid)!.qb64,
        holderHab.mgr.getRegistryRoot(holderHab.pre!, regs[i].regid)!.qb64,
      );
      assertEquals(s.log.filter((m) => m.src === issuerHab.pre).every((m) => m.dest === holderHab.pre), true);
    }
    assertEquals(s.store.list().length, 2);
    assert(grants[0] !== grants[1]);
  });
});
