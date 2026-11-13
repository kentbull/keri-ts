/**
 * The holder's receive workflow over two in-process parties: the whole individual path (approve the DH exchange,
 * wait, admit, the host's step, deliver), a wait that times out and is resumed by calling again, an exchange
 * that ended, and a Grant admitted before.
 */
import { run, spawn } from "effection";
import { assert, assertEquals } from "jsr:@std/assert";
import { type Operation } from "npm:effection@^3.6.0";
import {
  abandonIssuance,
  approveIssuanceExchange,
  beginIssuance,
  type IssuanceOperations,
  issuanceStatus,
  proposeIssuance,
} from "../../../../src/app/ipex/issuance.ts";
import { admitAndDeliver, receiveIssuance } from "../../../../src/app/ipex/receive-issuance.ts";
import { KramRefusedError } from "../../../../src/core/errors.ts";
import { deadlineOf, pastDeadline, type Scenario, scenario } from "./issuance-fixtures.ts";

/** The issuer has begun a fresh issuance to the holder and its Grant and query are on the way. */
function* begun(s: Scenario) {
  const issuerOps = s.owner(), holderOps = s.holderOwner(), reg = yield* s.registry(0);
  const [issuerHab, holderHab] = [s.issuer.habs[0], s.holder.habs[0]];
  const { grant } = yield* proposeIssuance(issuerOps, {
    credential: reg.credential(),
    options: { recipient: holderHab.pre!, message: "Issue" },
  });
  yield* issuerOps.processOnce();
  return { issuerOps, holderOps, grant, holderHab };
}

/** Alternate both owners until `done` holds. */
function* drive(a: IssuanceOperations, b: IssuanceOperations, done: () => boolean, passes = 60): Operation<void> {
  for (let i = 0; i < passes && !done(); i++) {
    yield* a.processOnce();
    yield* b.processOnce();
  }
}

Deno.test("receiveIssuance approves, waits, admits, runs the host step before delivery, and delivers", async () => {
  await run(function*() {
    const s = yield* scenario(), { issuerOps, holderOps, grant, holderHab } = yield* begun(s);
    const order: string[] = [];
    const task = yield* spawn(() =>
      receiveIssuance(holderOps, {
        grant,
        message: "Accepted",
        timeoutMs: 5000,
        *onAdmitted(admitted) {
          order.push(`recorded:${s.issuer.hby.db.erpy.get([grant]) === null ? "before-delivery" : "after-delivery"}`);
          assertEquals(admitted.dest, s.issuer.habs[0].pre);
        },
      })
    );
    yield* drive(issuerOps, holderOps, () => issuanceStatus(holderOps, grant).state !== "active", 60);
    const received = yield* task;
    assert(received.outcome === "admitted");
    assertEquals(order, ["recorded:before-delivery"]);
    assertEquals(received.delivery, { state: "delivered", to: [s.issuer.habs[0].pre] });
    assertEquals(received.admit, received.admitted?.admit.said);
    assertEquals(s.issuer.hby.db.erpy.get([grant])!.qb64, received.admit);
  });
});

Deno.test("receiveIssuance times out with the status it read, and calling again resumes the same exchange", async () => {
  await run(function*() {
    const s = yield* scenario(), { issuerOps, holderOps, grant, holderHab } = yield* begun(s);
    const first = yield* receiveIssuance(holderOps, { grant, timeoutMs: 20 });
    assert(first.outcome === "timed-out");
    assertEquals(first.timeoutMs, 20);
    assertEquals(first.status.state, "active");
    const resumed = yield* spawn(() => receiveIssuance(holderOps, { grant, timeoutMs: 5000 }));
    yield* drive(issuerOps, holderOps, () => issuanceStatus(holderOps, grant).state !== "active", 60);
    const second = yield* resumed;
    assert(second.outcome === "admitted");
    assertEquals(second.delivery.state, "delivered");
    // Admitted already: a third call reports it and does not sign or send again.
    const third = yield* receiveIssuance(holderOps, { grant, timeoutMs: 20 });
    assert(third.outcome === "admitted");
    assertEquals([third.admit, third.admitted, third.delivery.state], [second.admit, undefined, "undelivered"]);
  });
});

Deno.test("receiveIssuance reports an exchange that ended", async () => {
  await run(function*() {
    const s = yield* scenario(), { holderOps, grant, holderHab } = yield* begun(s);
    const timedOut = yield* receiveIssuance(holderOps, { grant, timeoutMs: 20 });
    assert(timedOut.outcome === "timed-out");
    abandonIssuance(holderOps, grant, "changed my mind");
    const ended = yield* receiveIssuance(holderOps, { grant, timeoutMs: 20 });
    assert(ended.outcome === "ended");
    assertEquals(ended.status.state, "abandoned");
  });
});

Deno.test("receive after escrow ejection throws KramRefusedError", async () => {
  await run(function*() {
    const s = yield* scenario(), { holderOps, grant } = yield* begun(s);
    const deadline = deadlineOf(s.holder, grant);
    s.clock.skew = pastDeadline(s.holder, grant);
    yield* s.holder.runtime.protocol.processEscrowsOnce(); // prunes the KRAM row, then ejects the Grant
    assertEquals(s.holder.hby.db.epse.get([grant]), null);
    let refused: unknown;
    try {
      yield* receiveIssuance(holderOps, { grant, timeoutMs: 20 });
    } catch (error) {
      refused = error;
    }
    assert(refused instanceof KramRefusedError, String(refused));
    assertEquals([refused.said, refused.refusal], [grant, { kind: "drop", reason: "lifetime", deadline }]);
  });
});

Deno.test("admitAndDeliver leaves delivery to the caller when told, and the Admit is still accepted", async () => {
  await run(function*() {
    const s = yield* scenario(), { issuerOps, holderOps, grant, holderHab } = yield* begun(s);
    approveIssuanceExchange(holderOps, grant);
    yield* drive(
      issuerOps,
      holderOps,
      () => issuanceStatus(holderOps, grant).state !== "active" || "needs" in issuanceStatus(holderOps, grant),
      60,
    );
    const done = yield* admitAndDeliver(holderOps.deps, { grant, deliver: false });
    assertEquals(done.delivery.state, "undelivered");
    assert(done.admitted.wire.length > 0);
    assert(s.holder.runtime.exc.complete(done.admitted.admit.said!));
    assertEquals(s.issuer.hby.db.erpy.get([grant]), null, "nothing was sent");
  });
});
