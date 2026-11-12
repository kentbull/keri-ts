/**
 * Counselor over real Haberys on in-memory stores.
 *
 * Tests named `KERIpy ...` port the cited KERIpy test (`tests/app/test_grouping.py`,
 * `tests/app/test_group_contribution.py`). The fake receipting collaborator
 * stands in for witnesses: it stores genuine witness signatures but proves
 * nothing about HTTP/TCP delivery, witness-side authorization, receipt intake
 * through Kevery, or fan-out to other witnesses (`Receiptor` owns those).
 */
import { Diger, NumberPrimitive, NumDex, type SerderKERI, Siger } from "cesr-ts";
import { ensure, type Operation, run } from "effection";
import { assert, assertEquals, assertThrows } from "jsr:@std/assert";
import { type Hab, type Habery, openHabery } from "../../../../src/app/identity/habbing.ts";
import {
  Counselor,
  DEFAULT_FALLBACK_AFTER_MS,
  type GroupEventRef,
  type GroupReceipting,
  waitForGroupEvent,
} from "../../../../src/app/multisig/counseling.ts";
import { groupElectedMember, groupWitnesser } from "../../../../src/app/multisig/group-members.ts";
import { MemoryChangeSink } from "../../../../src/app/runtime/workflow-contract.ts";
import { dgKey } from "../../../../src/db/core/keys.ts";
import { MemStoreOpener } from "../../../../src/db/core/memstore.ts";

interface Side {
  hby: Habery;
  hab: Hab;
}
interface Proposal {
  serder: SerderKERI;
  sigers: Siger[];
}

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const ref = (serder: SerderKERI): GroupEventRef => ({ pre: serder.pre!, sn: serder.sn!, said: serder.said! });

/** Accept `serder` at `hby` as group coordination does: local intake, then escrows. */
function deliver(hby: Habery, { serder, sigers }: Proposal, local = true) {
  hby.kevery.processEvent({ serder, sigers, wigers: [], frcs: [], sscs: [], ssts: [], local });
  hby.kevery.processEscrows();
}

/** Replay every accepted event of `pre` from `from` into each `to`. */
function share(from: Habery, pre: string, to: Habery[], local = false) {
  for (const [, said] of [...from.db.getKelItemIter(pre)]) {
    const serder = from.db.getEvtSerder(pre, said)!;
    for (const hby of to) deliver(hby, { serder, sigers: from.db.sigs.get(dgKey(pre, said)) }, local);
  }
}

/** Open `n` members, each in its own in-memory Habery that knows every other member's KEL. */
function* members(n: number): Operation<Side[]> {
  const sides: Side[] = [];
  for (let i = 0; i < n; i++) {
    const hby = yield* openHabery({
      name: crypto.randomUUID(),
      temp: true,
      skipConfig: true,
      opener: new MemStoreOpener(),
    });
    yield* ensure(() => hby.close(true));
    sides.push({ hby, hab: hby.makeHab(`member${i}`) });
  }
  for (const from of sides) share(from.hby, from.hab.pre!, sides.filter(s => s !== from).map(s => s.hby));
  return sides;
}

/** Rotate members and replay their new events to every side. */
function rotateMembers(all: Side[], rotating: Side[]) {
  for (const side of rotating) {
    side.hab.rotate();
    share(side.hby, side.hab.pre!, all.filter(s => s !== side).map(s => s.hby));
  }
}

/** Non-transferable witnesses that sign receipts, kept apart from every member. */
function* witnesses(n: number): Operation<Hab[]> {
  const hby = yield* openHabery({
    name: crypto.randomUUID(),
    temp: true,
    skipConfig: true,
    opener: new MemStoreOpener(),
  });
  yield* ensure(() => hby.close(true));
  return Array.from({ length: n }, (_, i) => hby.makeHab(`witness${i}`, undefined, { transferable: false }));
}

const pres = (sides: Side[]) => sides.map(s => s.hab.pre!);
const incept = (s: Side, smids: string[], args: object = {}) =>
  s.hby.makeGroupHab("g", s.hab, smids, undefined, undefined, args);
const rotate = (s: Side, smids: string[], rmids: string[], args: object = {}) =>
  s.hby.rotateGroupHab("g", smids, rmids, args);

/** A group both sides sign at inception; both hold it accepted. */
function pair(sides: Side[], args: object = {}): string {
  const smids = pres(sides);
  const created = sides.map(s => incept(s, smids, { isith: "2", nsith: "2", ...args }));
  sides.forEach((s, i) => created.forEach((c, j) => i !== j && deliver(s.hby, c)));
  return created[0].serder.pre!;
}

/** Stand-in for `Receiptor`: stores real witness signatures for each event's own witness set. */
class FakeReceipting implements GroupReceipting {
  calls: string[] = [];
  /** Auths seen by the last `receipt`. */
  auths: Record<string, string> = {};
  /** `receipt` throws this instead of storing receipts. */
  fail: string | null = null;
  /** `receipt` throws unless every witness has an auth entry. */
  requireAuth = false;
  /** `receipt` records the call but stores nothing. */
  silent = false;
  /** `get` finds and stores receipts. */
  fetchable = false;
  constructor(private readonly hby: Habery, private readonly signers: Hab[]) {}

  *receipt(pre: string, { sn, auths }: { sn: number; auths: Record<string, string> }) {
    this.calls.push(`receipt:${sn}`);
    this.auths = auths;
    if (this.fail) throw new Error(this.fail);
    if (this.requireAuth && this.signers.some(w => !auths[w.pre!])) throw new Error("401 unauthorized");
    if (!this.silent) this.store(pre, sn);
  }
  *get(pre: string, { sn }: { sn: number; said: string }) {
    this.calls.push(`get:${sn}`);
    if (this.fetchable) this.store(pre, sn);
    return this.fetchable;
  }
  store(pre: string, sn: number) {
    const said = this.hby.db.kels.getLast(pre, sn)!;
    const serder = this.hby.db.getEvtSerder(pre, said)!;
    const wits = this.hby.db.acceptedEventWitnesses(serder)!;
    const sigers = wits.map((wit, index) => {
      const signature = this.signers.find(w => w.pre === wit)!.sign(serder.raw, true)[0];
      return new Siger({ code: signature.code, raw: signature.raw, index });
    });
    this.hby.db.wigs.put(dgKey(pre, said), sigers);
  }
}

/** Counselor with a controllable clock over `side`. */
function counselor(side: Side, wits: Hab[] = [], clock = { t: 0 }) {
  const receipting = new FakeReceipting(side.hby, wits);
  const changes = new MemoryChangeSink();
  return { clock, receipting, changes, c: new Counselor(side.hby, receipting, { now: () => clock.t }, changes) };
}

Deno.test("KERIpy test_counselor: signatures stage across inception and three rotations", async () => {
  await run(function*() {
    const sides = yield* members(3);
    const [s0, s1, s2] = sides;
    const { c } = counselor(s0);
    const smids = pres(sides);
    const half = { isith: ["1/2", "1/2", "1/2"], nsith: ["1/2", "1/2", "1/2"], toad: 0, wits: [] };
    const created = [s0, s1].map(s => incept(s, smids, half));
    const gid = created[0].serder.pre!;
    const icp = ref(created[0].serder);

    assert(c.start(icp));
    const [[number, diger]] = s0.hby.db.gpse.get([gid]); // Escrowed the event for signatures
    assertEquals([number.num, diger.qb64], [0n, gid]);
    assertEquals(c.status(icp), {
      state: "pending",
      stage: "signatures",
      elected: null,
      receipts: { have: 0, need: 0 },
    });
    deliver(s0.hby, created[1]); // the second member's signature meets the threshold
    yield* c.processOnce();
    assertEquals(s0.hby.db.gpse.get([gid]), []);
    assert(c.complete(icp));

    deliver(s1.hby, created[0]);
    s2.hby.joinGroupHab(gid, "g", s2.hab, smids, smids);
    const rounds: Array<{ signers: Side[]; smids: Side[]; rmids: Side[] }> = [
      { signers: [s0, s1], smids: [s0, s1], rmids: [s0, s1] },
      { signers: [s0, s1], smids: [s0, s1], rmids: [s0, s1, s2] },
      { signers: [s0, s2], smids: [s0, s2], rmids: [s0, s2] }, // third rotation, recovery by a different pair
    ];
    for (const [round, { signers, smids: sm, rmids }] of rounds.entries()) {
      rotateMembers(sides, signers);
      share(s0.hby, gid, [s2.hby], true); // the newcomer replays the group's accepted history
      const proposals = signers.map(s => rotate(s, pres(sm), pres(rmids), { isith: "2", nsith: "2", toad: 0 }));
      const event = ref(proposals[0].serder);
      assertEquals(event.sn, round + 1);
      assert(c.start(event));
      const [[n, d]] = s0.hby.db.gpse.get([gid]);
      assertEquals([n.num, d.qb64], [BigInt(round + 1), event.said]);
      assert(s0.hby.db.getEvtSerder(gid, event.said));
      assertEquals(c.status(event).state, "pending");
      for (const s of signers) for (const p of proposals) if (s !== signers[0] || p !== proposals[0]) deliver(s.hby, p);
      yield* c.processOnce();
      assert(c.complete(event));
      assertEquals(s0.hby.db.getKever(gid)!.sn, round + 1);
      assertEquals(s0.hby.db.getKever(gid)!.verfers.map(v => v.qb64), sm.map(s => s.hab.kever!.verfers[0].qb64));
    }
  });
});

Deno.test("KERIpy test_counselor_pending_and_abandon: pending follows the escrows and abandon forgets one group", async () => {
  await run(function*() {
    const sides = yield* members(2);
    const [s0, s1] = sides;
    const { c } = counselor(s0);
    const smids = pres(sides);
    const group = incept(s0, smids, { isith: "2", nsith: "2", toad: 0 });
    const other = s0.hby.makeGroupHab("other", s0.hab, smids, undefined, undefined, {
      isith: "1",
      nsith: "2",
      toad: 0,
    });
    const [gid, oid] = [group.serder.pre!, other.serder.pre!];
    assertEquals(c.pending(gid), []);

    c.start(ref(group.serder), { auths: { a: "b" } });
    c.start(ref(other.serder));
    assertEquals(c.pending(gid), [{ ...ref(group.serder), stage: "signatures" }]);
    assertEquals(c.pending().map(p => [p.pre, p.stage]).sort(), [[gid, "signatures"], [oid, "signatures"]].sort());

    // The second member's signature completes inception; nothing stays pending.
    deliver(s0.hby, incept(s1, smids, { isith: "2", nsith: "2", toad: 0 }));
    yield* c.processOnce();
    assertEquals(c.pending(gid), []);
    assert(c.complete(ref(group.serder)));

    // Abandon forgets this group's markers, escrows and witness headers only.
    c.abandon(gid);
    assertEquals(c.complete(ref(group.serder)), false);
    assertEquals(c.pending(gid), []);
    assertEquals(c.status(ref(group.serder)), { state: "unknown" });
    assert(c.complete(ref(other.serder)));
    c.abandon(oid);
    assertEquals(c.pending(), []);
    assert(s0.hby.db.getKever(gid)); // accepted KEL state is untouched
  });
});

Deno.test("start validates the reference and is idempotent, including across stages", async () => {
  await run(function*() {
    const sides = yield* members(2);
    const [s0, s1] = sides;
    const { c } = counselor(s0);
    const created = [s0, s1].map(s => incept(s, pres(sides), { isith: "2", nsith: "2" }));
    const icp = ref(created[0].serder);
    assertThrows(() => c.start({ ...icp, pre: s0.hab.pre! }), Error, "not a local group");
    assertThrows(() => c.start({ ...icp, sn: -1 }), Error, "Invalid group event reference");
    assertThrows(() => c.start(icp, { fallbackAfterMs: -5 }), Error, "fallbackAfterMs");

    assertEquals([c.start(icp), c.start(icp)], [true, false]); // before acceptance, twice
    assertEquals(c.pending().length, 1);
    deliver(s0.hby, created[1]);
    c.start(icp);
    yield* c.processOnce();
    assert(c.complete(icp));
    assertEquals(c.start(icp), false); // complete events are not re-escrowed
    assertEquals(c.pending(), []);
    assertEquals(c.start({ ...icp, said: created[1].serder.said!.replace(/.$/, "A") }), false); // another SAID holds sn 0
  });
});

Deno.test("a different SAID accepted at the sn supersedes only its own tuple", async () => {
  await run(function*() {
    const sides = yield* members(2);
    const [s0, s1] = sides;
    const gid = pair(sides);
    const { c, changes } = counselor(s0);
    const seal = (d: string) => ({ data: [{ i: gid, s: "1", d }] });
    const stale = s0.hby.interactGroupHab("g", undefined, seal(gid)); // X: only s0 ever signs it
    const rival = [s0, s1].map(s => s.hby.interactGroupHab("g", undefined, seal(s0.hab.kever!.said)));
    const [x, y] = [ref(stale.serder), ref(rival[0].serder)];
    assertEquals([x.sn, y.sn], [1, 1]);
    const next = { pre: gid, sn: 2, said: "E" + "B".repeat(43) }; // a later event, not yet accepted
    c.start(x);
    c.start(y);
    c.start(next);
    assertEquals(s0.hby.db.gpse.get([gid]).length, 3); // three events pending for one prefix

    deliver(s0.hby, rival[1]); // Y reaches threshold and is accepted
    assertEquals(s0.hby.db.kels.getLast(gid, 1), y.said);
    yield* c.processOnce();
    // KERIpy would drop both rows with gpse.rem(keys=(pre,)); only X is stale.
    assertEquals(c.status(x), { state: "superseded", accepted: y.said });
    assertEquals(c.status(y), { state: "complete" });
    assertEquals(c.pending(), [{ ...next, stage: "signatures" }]);
    assertEquals(changes.changes.filter(ch => ch.id === `${gid}:1`).length > 0, true);
  });
});

Deno.test("completion counts against the event's own witness set after a later rotation", async () => {
  await run(function*() {
    const sides = yield* members(2);
    const [s0] = sides;
    const [w1, w2] = yield* witnesses(2);
    const gid = pair(sides, { wits: [w1.pre], toad: 1 });
    rotateMembers(sides, sides);
    const rots = sides.map(s =>
      rotate(s, pres(sides), pres(sides), { isith: "2", nsith: "2", toad: 2, adds: [w2.pre] })
    );
    sides.forEach((s, i) => deliver(s.hby, rots[1 - i]));
    assertEquals(s0.hby.db.getKever(gid)!.wits, [w1.pre, w2.pre]);

    const { c, clock, receipting } = counselor(s0, [w1, w2]);
    const [icp, rot] = [ref(s0.hby.db.getEvtSerder(gid, gid)!), ref(rots[0].serder)];
    c.start(icp);
    c.start(rot);
    receipting.silent = true;
    yield* c.processOnce();
    const pendingRot = c.status(rot);
    assertEquals(pendingRot.state === "pending" && pendingRot.receipts, { have: 0, need: 2 });

    // w1's receipt alone satisfies the inception's own cohort (1 of 1) but not the rotation's (2 of 2).
    const inceptionSerder = s0.hby.db.getEvtSerder(gid, gid)!;
    const sig = w1.sign(inceptionSerder.raw, true)[0];
    s0.hby.db.wigs.put(dgKey(gid, gid), [new Siger({ code: sig.code, raw: sig.raw, index: 0 })]);
    yield* c.processOnce();
    assertEquals(c.status(icp), { state: "complete" });
    assertEquals(c.status(rot).state, "pending");

    receipting.silent = false;
    clock.t = 5_000; // past the retry backoff of the silent attempt
    yield* c.processOnce();
    assertEquals(c.status(rot), { state: "complete" });
  });
});

Deno.test("KERIpy test_group_contribution: the witnesser is the member whose historical key holds the lowest verified index", async () => {
  await run(function*() {
    for (const local of [0, 1]) {
      const sides = yield* members(3);
      const [w] = yield* witnesses(1);
      const smids = pres(sides);
      const signing = [sides[local], sides[local + 1]];
      const args = { isith: "2", nsith: "2", wits: [w.pre], toad: 1 };
      const created = signing.map(s => incept(s, smids, args));
      signing.forEach((s, i) => deliver(s.hby, created[1 - i]));
      const hby = sides[local].hby, gid = created[0].serder.pre!;
      rotateMembers(sides, sides);
      sides[local + 1].hby.joinGroupHab(gid, "g", sides[local + 1].hab, smids, smids);
      const rots = signing.map(s => rotate(s, smids, smids, { isith: "2", nsith: "2", toad: 1 }));
      signing.forEach((s, i) => deliver(s.hby, rots[1 - i]));
      const at = ref(rots[0].serder);
      assertEquals(hby.db.getKever(gid)!.sn, 1);
      assert(groupWitnesser(hby, gid, at));

      // test_group_witnesser_uses_historical_contribution: a later member rotation changes nothing.
      sides[local].hab.rotate();
      assert(groupWitnesser(hby, gid, at));
      assertEquals(groupWitnesser(hby, gid, { sn: 0, said: at.said }), false);
      assertEquals(groupWitnesser(hby, gid, { sn: 1, said: "E" + "A".repeat(43) }), false);

      // test_group_witnesser_resolves_establishment_for_interaction
      const ixn = signing.map(s => s.hby.interactGroupHab("g"));
      signing.forEach((s, i) => deliver(s.hby, ixn[1 - i]));
      assertEquals(hby.db.getKever(gid)!.sn, 2);
      assert(groupWitnesser(hby, gid, ref(ixn[0].serder)));
    }
  });
});

Deno.test("KERIpy test_counselor_keeps_historical_elected_member / test_counselor_election_uses_escrow_event_after_later_rotation", async () => {
  await run(function*() {
    for (const local of [0, 1]) {
      for (const stage of ["signed", "witness"] as const) {
        for (const later of [false, true]) {
          const sides = yield* members(3);
          const [w] = yield* witnesses(1);
          const smids = pres(sides);
          const signing = [sides[local], sides[local + 1]];
          const created = signing.map(s => incept(s, smids, { isith: "2", nsith: "2", wits: [w.pre], toad: 1 }));
          signing.forEach((s, i) => deliver(s.hby, created[1 - i]));
          const hby = sides[local].hby, gid = created[0].serder.pre!;
          rotateMembers(sides, sides);
          sides[local + 1].hby.joinGroupHab(gid, "g", sides[local + 1].hab, smids, smids);
          const rots = signing.map(s => rotate(s, smids, smids, { isith: "2", nsith: "2", toad: 1 }));
          signing.forEach((s, i) => deliver(s.hby, rots[1 - i]));
          const event = ref(rots[0].serder);
          if (later) {
            // Another member leads the newer rotation, so the group's head is not ours; the escrowed event still is.
            rotateMembers(sides, sides);
            const order = [smids[(local + 1) % 3], smids[local], smids[(local + 2) % 3]];
            const newer = signing.map(s => rotate(s, order, order, { isith: "2", nsith: "2", toad: 1 }));
            signing.forEach((s, i) => deliver(s.hby, newer[1 - i]));
            assertEquals(hby.db.getKever(gid)!.sn, 2);
            assertEquals(groupWitnesser(hby, gid, ref(newer[0].serder)), false);
          }
          const { c, receipting } = counselor(sides[local], [w]);
          receipting.silent = true;
          if (stage === "signed") c.start(event);
          else hby.db.gpwe.add([gid], [NumberPrimitive.fromNum(1n), new Diger({ qb64: event.said })]);
          yield* c.processOnce();
          // The elected member submits (witDoer.msgs) and never fetches (witDoer.gets); no completion without receipts.
          assertEquals(receipting.calls, ["receipt:1"]);
          assertEquals(c.complete(event), false);
        }
      }
    }
  });
});

Deno.test("elected members submit, others fetch; fallbackAfterMs 0 makes every member submit", async () => {
  await run(function*() {
    const sides = yield* members(2);
    const [w] = yield* witnesses(1);
    const gid = pair(sides, { wits: [w.pre], toad: 1 });
    const event = ref(sides[0].hby.db.getEvtSerder(gid, gid)!);
    const [elected, other, eager] = [counselor(sides[0], [w]), counselor(sides[1], [w]), counselor(sides[1], [w])];
    elected.receipting.silent = true;
    eager.receipting.silent = true;
    elected.c.start(event);
    other.c.start(event);
    eager.c.start(event, { fallbackAfterMs: 0 });
    for (const x of [elected, other, eager]) yield* x.c.processOnce();
    assertEquals(elected.receipting.calls, ["receipt:0"]);
    assertEquals(other.receipting.calls, ["get:0"]);
    assertEquals(eager.receipting.calls, ["receipt:0"]);
    const status = (x: typeof elected) => x.c.status(event);
    assertEquals([status(elected), status(other)].map(s => s.state === "pending" && s.elected), [true, false]);

    other.receipting.fetchable = true; // a non-elected member completes from the elected member's receipts
    other.clock.t = 1_000;
    yield* other.c.processOnce();
    assertEquals(other.c.status(event), { state: "complete" });
  });
});

Deno.test("a non-elected member falls back to submitting after the grace, on an injected clock", async () => {
  await run(function*() {
    const sides = yield* members(2);
    const [w] = yield* witnesses(1);
    const gid = pair(sides, { wits: [w.pre], toad: 1 });
    const event = ref(sides[0].hby.db.getEvtSerder(gid, gid)!);
    const { c, clock, receipting } = counselor(sides[1], [w]);
    receipting.silent = true;
    c.start(event, { fallbackAfterMs: 2_500 });
    for (const t of [0, 500, 1_000, 2_000, 3_000, 3_500]) {
      clock.t = t;
      yield* c.processOnce();
    }
    // 500 and 3_500 fall inside a retry backoff; the grace elapses by 3_000.
    assertEquals(receipting.calls, ["get:0", "get:0", "get:0", "receipt:0"]);
    assert(DEFAULT_FALLBACK_AFTER_MS > 0);
  });
});

Deno.test("an elected member without usable auths reports witnessAuth, then completes once they are supplied", async () => {
  await run(function*() {
    const sides = yield* members(2);
    const [w] = yield* witnesses(1);
    const gid = pair(sides, { wits: [w.pre], toad: 1 });
    const event = ref(sides[0].hby.db.getEvtSerder(gid, gid)!);
    const { c, clock, receipting } = counselor(sides[0], [w]);
    receipting.requireAuth = true;
    c.start(event);
    yield* c.processOnce();
    assertEquals(c.status(event), {
      state: "pending",
      stage: "witnesses",
      elected: true,
      receipts: { have: 0, need: 1 },
      blocked: { kind: "witnessAuth", witnesses: [w.pre] },
    });

    const auths = { [w.pre!]: "code" };
    assertEquals(c.start(event, { auths }), false); // inputs re-arm; the row is not duplicated
    receipting.fail = "witness offline";
    clock.t = 10;
    yield* c.processOnce();
    const failed = c.status(event);
    assertEquals(failed.state === "pending" && failed.blocked, { kind: "witness", reason: "witness offline" });

    receipting.fail = null;
    c.start(event, { auths });
    yield* c.processOnce();
    assertEquals(receipting.auths, auths);
    assertEquals(c.status(event), { state: "complete" });
  });
});

Deno.test("a restarted Counselor resumes from stored rows and submits without any in-memory cue", async () => {
  await run(function*() {
    const sides = yield* members(2);
    const [w] = yield* witnesses(1);
    const smids = pres(sides);
    const created = sides.map(s => incept(s, smids, { isith: "2", nsith: "2", wits: [w.pre], toad: 1 }));
    const event = ref(created[0].serder);
    const first = counselor(sides[0], [w]);
    first.receipting.silent = true;
    first.c.start(event); // before acceptance
    yield* first.c.processOnce();
    const early = first.c.status(event);
    assertEquals(early.state === "pending" && early.stage, "signatures");
    deliver(sides[0].hby, created[1]);
    yield* first.c.processOnce(); // advances to witnesses and submits; receipts never arrive
    assertEquals(first.receipting.calls, ["receipt:0"]);

    // Drop the instance: auths, timers and "already submitted" memory are gone; the rows are not.
    const second = counselor(sides[0], [w]);
    assertEquals(second.c.pending(), [{ ...event, stage: "witnesses" }]);
    yield* second.c.processOnce();
    assertEquals(second.receipting.calls, ["receipt:0"]); // KERIpy's cue-based elected member would wait forever here
    assertEquals(second.c.status(event), { state: "complete" });
    assertEquals(second.c.pending(), []);
  });
});

Deno.test("processOnce on empty tables does nothing", async () => {
  await run(function*() {
    const sides = yield* members(1);
    const { c, receipting, changes } = counselor(sides[0]);
    yield* c.processOnce();
    assertEquals([receipting.calls, changes.changes, c.pending()], [[], [], []]);
  });
});

Deno.test("delegated dip is parked in the delegation stage and reported blocked", async () => {
  await run(function*() {
    const [s0] = yield* members(1);
    const delegator = s0.hby.makeHab("delegator");
    const created = s0.hby.makeGroupHab("g", s0.hab, [s0.hab.pre!], undefined, undefined, { delpre: delegator.pre! });
    const gid = created.serder.pre!;
    assertEquals(s0.hby.db.getKever(gid), null); // awaiting the delegator's anchor
    const { c, receipting } = counselor(s0);
    const event = ref(created.serder);
    c.start(event);
    delegator.interact({ data: [{ i: gid, s: "0", d: gid }] });
    s0.hby.kevery.processEscrowDelegables();
    s0.hby.kevery.processEscrows();
    assertEquals(s0.hby.db.kels.getLast(gid, 0), gid);
    yield* c.processOnce();
    assertEquals(s0.hby.db.gpse.get([gid]), []);
    assertEquals(s0.hby.db.gdee.get([gid]).length, 1);
    const status = c.status(event);
    assertEquals(status.state === "pending" && [status.stage, status.blocked], ["delegation", {
      kind: "notSupported",
      feature: "delegation",
    }]);
    yield* c.processOnce(); // stays parked, submits nothing
    assertEquals([c.status(event).state, receipting.calls], ["pending", []]);
  });
});

Deno.test("escrow rows and completion markers have KERIpy's raw key and value bytes", async () => {
  await run(function*() {
    const sides = yield* members(2);
    const [w] = yield* witnesses(1);
    const gid = pair(sides, { wits: [w.pre], toad: 1 });
    const event = ref(sides[0].hby.db.getEvtSerder(gid, gid)!);
    const { c, receipting } = counselor(sides[0], [w]);
    const db = sides[0].hby.db;
    // Reads the physical rows of one sub-database; `db` and `sdb` are protected on Suber.
    type Raw = { db: { scan(t: unknown): Iterable<{ key: Uint8Array; value: Uint8Array }> }; sdb: unknown };
    const rows = (table: unknown) => {
      const raw = table as Raw;
      return [...raw.db.scan(raw.sdb)].map(({ key, value }) => [text(key), text(value)]);
    };
    // IoSet key: pre + "." + 32 hex digits of insertion order; value: Number.qb64 + Diger.qb64 concatenated.
    const iokey = `${gid}.${"0".repeat(32)}`;

    c.start(event);
    assertEquals(rows(db.gpse), [[iokey, `MAAA${gid}`]]);
    receipting.silent = true;
    yield* c.processOnce();
    assertEquals(rows(db.gpse), []);
    assertEquals(rows(db.gpwe), [[iokey, `MAAA${gid}`]]);
    receipting.silent = false;
    receipting.store(gid, 0);
    yield* c.processOnce();
    assertEquals(rows(db.gpwe), []);
    // Completed: key pre + "." + number.qb64 (auto-sized code), value Diger.qb64.
    assertEquals(rows(db.cgms), [[`${gid}.MAAA`, gid]]);

    // Output of KERIpy gpse.add/gpwe.add/cgms.put for sn 1 and said EFWaD..., verified against KERIpy's LMDB.
    const said = "EFWaDXMVIhIMpsXMOcnXhU0tkJfD_rPULkQzphoM_EVb";
    c.abandon(gid);
    c.start({ pre: gid, sn: 1, said });
    assertEquals(rows(db.gpse), [[iokey, `MAAB${said}`]]);
    db.cgms.pin([gid, NumberPrimitive.fromNum(1n).qb64], new Diger({ qb64: said }));
    assertEquals(rows(db.cgms), [[`${gid}.MAAB`, said]]);
  });
});

Deno.test("complete reads a cgms key written with KERIpy's 0A number code, and abandon clears both widths", async () => {
  await run(function*() {
    const sides = yield* members(2);
    const gid = pair(sides);
    const db = sides[0].hby.db;
    const { c } = counselor(sides[0]);
    const event = { pre: gid, sn: 1, said: "EFWaDXMVIhIMpsXMOcnXhU0tkJfD_rPULkQzphoM_EVb" };
    const raw = new Uint8Array(16);
    raw[15] = 1;
    const huge = new NumberPrimitive({ code: NumDex.Huge, raw }); // Delegate confirm writes this width
    db.cgms.pin([gid, huge.qb64], new Diger({ qb64: event.said }));
    assertEquals(huge.qb64, "0AAAAAAAAAAAAAAAAAAAAAAB");
    assert(c.complete(event));
    assertEquals(c.status({ ...event, said: gid }), { state: "superseded", accepted: event.said });
    c.abandon(gid);
    assertEquals(db.cgms.cnt(), 0);
  });
});

Deno.test("waitForGroupEvent only observes and returns the status it read", async () => {
  await run(function*() {
    const sides = yield* members(2);
    const created = sides.map(s => incept(s, pres(sides), { isith: "2", nsith: "2" }));
    const { c, receipting } = counselor(sides[0]);
    const event = ref(created[0].serder);
    c.start(event);
    const timedOut = yield* waitForGroupEvent(c, event, { timeoutMs: 5 });
    assertEquals(timedOut.outcome, "timed-out");
    assertEquals(timedOut.status.state, "pending");

    deliver(sides[0].hby, created[1]);
    yield* c.processOnce();
    const settled = yield* waitForGroupEvent(c, event, { timeoutMs: 5 });
    assertEquals(settled, { outcome: "settled", status: { state: "complete" } });
    assertEquals(receipting.calls, []);
  });
});

Deno.test("groupElectedMember requires a current signing member; groupWitnesser keeps the historical one", async () => {
  await run(function*() {
    const sides = yield* members(3);
    const smids = pres(sides);
    const gid = pair(sides.slice(0, 2), { toad: 0 });
    const inception = { sn: 0, said: gid };
    const hby = sides[0].hby;
    assertEquals(groupElectedMember(hby, gid, inception), sides[0].hab.pre);
    // The local member later leaves the signing set but stays a rotation member.
    hby.joinGroupHab(gid, "g", sides[0].hab, smids.slice(1), smids);
    assertEquals(groupWitnesser(hby, gid, inception), true);
    assertEquals(groupElectedMember(hby, gid, inception), null);
  });
});
