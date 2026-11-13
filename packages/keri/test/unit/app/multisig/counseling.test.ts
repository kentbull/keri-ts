/**
 * Counselor over real Haberys on in-memory stores.
 *
 * Tests named `KERIpy ...` port the cited KERIpy test (`tests/app/test_grouping.py`,
 * `tests/app/test_group_contribution.py`). The fake receipting collaborator
 * stands in for witnesses: it stores genuine witness signatures but proves
 * nothing about HTTP/TCP delivery, witness-side authorization, receipt intake
 * through Kevery, or fan-out to other witnesses (`Receiptor` owns those).
 */
import { Dater, Diger, GroupSizeError, NumberPrimitive, NumDex, type SerderKERI, Siger } from "cesr-ts";
import { ensure, type Operation, run } from "effection";
import { assert, assertEquals, assertThrows } from "jsr:@std/assert";
import type { RegistryRoot } from "../../../../src/acdc/salting.ts";
import { RootReplicator } from "../../../../src/app/credentials/root-replicator.ts";
import type { Poster } from "../../../../src/app/delivery/forwarding.ts";
import { Anchorer } from "../../../../src/app/identity/delegating.ts";
import { type Hab, type Habery, openHabery } from "../../../../src/app/identity/habbing.ts";
import { IssuanceOperations, partyKey } from "../../../../src/app/ipex/issuance.ts";
import { unblindingKey, UnblindingOperations } from "../../../../src/app/ipex/unblinding-workflow.ts";
import { KelPublisher } from "../../../../src/app/mailbox/kel-publisher.ts";
import {
  Counselor,
  DEFAULT_FALLBACK_AFTER_MS,
  type GroupEventRef,
  type GroupForwarding,
  type GroupReceipting,
  waitForGroupEvent,
} from "../../../../src/app/multisig/counseling.ts";
import { groupElectedMember, groupWitnesser } from "../../../../src/app/multisig/group-members.ts";
import { replaceGroupMember } from "../../../../src/app/multisig/replace-member.ts";
import type { AgentRuntime } from "../../../../src/app/runtime/agent-runtime.ts";
import { MemoryChangeSink } from "../../../../src/app/runtime/workflow-contract.ts";
import { exchange } from "../../../../src/core/protocol-eventing.ts";
import { dgKey } from "../../../../src/db/core/keys.ts";
import { MemStoreOpener } from "../../../../src/db/core/memstore.ts";
import { FakeRuntimeHttpClient, ManualRuntimeClock } from "../../../support/runtime-fakes.ts";

interface Side {
  hby: Habery;
  hab: Hab;
}
interface Proposal {
  serder: SerderKERI;
  sigers: Siger[];
  wigers?: Siger[];
}

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const ref = (serder: SerderKERI): GroupEventRef => ({ pre: serder.pre!, sn: serder.sn!, said: serder.said! });

/** Accept `serder` at `hby` as group coordination does: local intake, then escrows. */
function deliver(hby: Habery, { serder, sigers, wigers = [] }: Proposal, local = true) {
  hby.kevery.processEvent({ serder, sigers, wigers, frcs: [], sscs: [], ssts: [], local });
  hby.kevery.processEscrows();
}

/** Replay every accepted event of `pre` from `from` into each `to`. */
function share(from: Habery, pre: string, to: Habery[], local = false) {
  for (const [, said] of [...from.db.getKelItemIter(pre)]) {
    const serder = from.db.getEvtSerder(pre, said)!;
    for (const hby of to) {
      deliver(
        hby,
        { serder, sigers: from.db.sigs.get(dgKey(pre, said)), wigers: from.db.wigs.get(dgKey(pre, said)) },
        local,
      );
    }
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

/** A group every side signs at inception with its own member; all hold it accepted. */
function pairAt(sides: Side[], smids: string[], rmids: string[]): string {
  const created = sides.map(s =>
    s.hby.makeGroupHab("g", s.hab, smids, rmids, undefined, { isith: "2", nsith: "2", toad: 0 })
  );
  sides.forEach((s, i) => created.forEach((c, j) => i !== j && deliver(s.hby, c)));
  return created[0].serder.pre!;
}

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
  /** `get` throws this, as for a witness reply that cannot be read. */
  unreadable: Error | null = null;
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
    if (this.unreadable) throw this.unreadable;
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
function counselor(
  side: Side,
  wits: Hab[] = [],
  clock = { t: 0 },
  delegated = false,
  mailboxes?: ConstructorParameters<typeof Counselor>[5],
  forwarding?: GroupForwarding,
) {
  const receipting = new FakeReceipting(side.hby, wits);
  const changes = new MemoryChangeSink();
  const anchorer = new FakeAnchorer();
  const queries: unknown[] = [];
  const delegation = delegated ? { anchorer, querying: { enqueue: (q: unknown) => queries.push(q) } } : undefined;
  const c = new Counselor(
    side.hby,
    receipting,
    { now: () => clock.t },
    changes,
    delegation,
    mailboxes,
    undefined,
    forwarding,
  );
  return { clock, receipting, changes, anchorer, queries, c };
}

/** Stand-in for the Anchorer: records `begin`; the test marks events done as the Anchorer would. */
class FakeAnchorer {
  begun: Array<{ said: string; sender: string | undefined }> = [];
  done = new Set<string>();
  begin(serder: SerderKERI, options: { communicationHab?: Hab } = {}) {
    this.begun.push({ said: serder.said!, sender: options.communicationHab?.pre });
  }
  complete(pre: string, sn: number | string) {
    return this.done.has(`${pre}:${sn}`);
  }
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

Deno.test("a completed group rotation, and only a rotation, is announced for the group's mailboxes", async () => {
  await run(function*() {
    const sides = yield* members(2);
    const [s0, s1] = sides;
    const told: string[] = [];
    const { c } = counselor(s0, [], { t: 0 }, false, { rotated: cue => told.push(cue.pre) });
    const smids = pres(sides);
    const created = [s0, s1].map(s => incept(s, smids, { isith: "2", nsith: "2", toad: 0, wits: [] }));
    const gid = created[0].serder.pre!;
    c.start(ref(created[0].serder));
    deliver(s0.hby, created[1]);
    yield* c.processOnce();
    assertEquals(told, [], "an inception announces nothing");
    deliver(s1.hby, created[0]);
    rotateMembers(sides, sides);
    const proposals = sides.map(s => rotate(s, smids, smids, { isith: "2", nsith: "2", toad: 0 }));
    const event = ref(proposals[0].serder);
    c.start(event);
    deliver(s0.hby, proposals[1]);
    yield* c.processOnce();
    assert(c.complete(event));
    assertEquals(told, [gid], "the completed rotation is announced once");
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

Deno.test("a non-elected member whose fetched receipt reply cannot be read submits at its next attempt, not after the grace", async () => {
  await run(function*() {
    const sides = yield* members(2);
    const [w] = yield* witnesses(1);
    const gid = pair(sides, { wits: [w.pre], toad: 1 });
    const event = ref(sides[0].hby.db.getEvtSerder(gid, gid)!);
    const { c, clock, receipting } = counselor(sides[1], [w]);
    receipting.unreadable = new GroupSizeError("Incomplete item inside -L payload");
    c.start(event);
    for (const t of [0, 500, 1_000]) {
      clock.t = t;
      yield* c.processOnce();
    }
    assertEquals(
      receipting.calls,
      ["get:0", "receipt:0"],
      "the unreadable reply is not retried until the grace passes",
    );
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

Deno.test("joinGroupHab replaces a local member that left the accepted key state, and only then", async () => {
  await run(function*() {
    const sides = yield* members(3);
    const [a, b, c] = sides, fresh = a.hby.makeHab("replacement");
    share(a.hby, fresh.pre!, [b.hby, c.hby]);
    const smids = pres(sides), rmids = [...smids, fresh.pre!], gid = pairAt(sides, smids, rmids);
    const body = new TextEncoder().encode("signed by the replacement");

    // A recorded member that is a signing member of the accepted state is kept, whatever the caller lists.
    assertThrows(
      () => a.hby.joinGroupHab(gid, "g", fresh, [fresh.pre!], [fresh.pre!]),
      Error,
      "still a member",
    );
    assertEquals(a.hby.db.getHab(gid)!.mid, a.hab.pre);

    // Only the rotation list: a member that merely holds a next key is kept too.
    const other = [b, a], smidsH = [fresh.pre!, b.hab.pre!], rmidsH = [fresh.pre!, b.hab.pre!, a.hab.pre!];
    const created = other.map(s =>
      s.hby.makeGroupHab("h", s.hab, smidsH, rmidsH, undefined, { isith: "2", nsith: "2", toad: 0 })
    );
    deliver(a.hby, created[0]);
    const hid = created[0].serder.pre!;
    assertEquals(a.hby.db.getKever(hid)!.sn, 0);
    assertEquals(a.hby.db.getHab(hid)!.mid, a.hab.pre);
    assertThrows(() => a.hby.joinGroupHab(hid, "h", fresh, smidsH, rmidsH), Error, "still a member");
    assertEquals(a.hby.db.getHab(hid)!.mid, a.hab.pre);

    // A group with no accepted key state yet cannot be judged, so the recorded member is kept.
    const pending = a.hby.makeGroupHab(
      "p",
      a.hab,
      [a.hab.pre!, b.hab.pre!],
      [
        a.hab.pre!,
        b.hab.pre!,
        fresh.pre!,
      ],
      undefined,
      { isith: "2", nsith: "2", toad: 0 },
    );
    const pid = pending.serder.pre!;
    assertEquals(a.hby.db.getKever(pid), null);
    assertThrows(
      () => a.hby.joinGroupHab(pid, "p", fresh, [a.hab.pre!, b.hab.pre!], [a.hab.pre!, b.hab.pre!, fresh.pre!]),
      Error,
      "cannot be judged",
    );
    assertEquals(a.hby.db.getHab(pid)!.mid, a.hab.pre);

    // The other members rotate a out; the Habery's recorded member is no longer in the accepted state.
    b.hab.rotate();
    c.hab.rotate();
    fresh.rotate();
    share(b.hby, b.hab.pre!, [a.hby, c.hby]);
    share(c.hby, c.hab.pre!, [a.hby, b.hby]);
    share(a.hby, fresh.pre!, [b.hby, c.hby]);
    const next = [b.hab.pre!, c.hab.pre!, fresh.pre!];
    const rots = [b, c].map(s => rotate(s, next, next, { isith: "2", nsith: "2", toad: 0 }));
    [b, c].forEach((s, i) => deliver(s.hby, rots[1 - i]));
    rots.forEach(r => deliver(a.hby, r));
    assertEquals(a.hby.db.getKever(gid)!.sn, 1);
    assertEquals(a.hby.db.getHab(gid)!.mid, a.hab.pre, "the record is not changed by a rotation alone");

    // Rows addressed to the old member: an escrowed root copy for it, and a marker of one sent to it.
    const copy = exchange("/registry/root", {
      sender: b.hab.pre!,
      receiver: a.hab.pre!,
      attributes: { essr: "E", gid, rd: "Eregistry" },
    });
    a.hby.db.exns.pin([copy.said!], copy);
    a.hby.db.rrpe.pin([copy.said!], new Dater({ dts: "2026-01-01T00:00:00.000000+00:00" }));
    a.hby.db.rrsn.pin([gid, "Eregistry", a.hab.pre!], { key: "K", dt: "2026-01-01T00:00:00.000000+00:00" });
    a.hby.db.rrsn.pin([gid, "Eregistry", b.hab.pre!], { key: "K", dt: "2026-01-01T00:00:00.000000+00:00" });

    // The new member is judged from accepted state too: a local habitat that is not a member is refused.
    const stray = a.hby.makeHab("stray");
    assertThrows(
      () => a.hby.joinGroupHab(gid, "g", stray, [...next, stray.pre!], [...next, stray.pre!]),
      Error,
      "not a member in the accepted key state",
    );
    assertEquals(a.hby.db.getHab(gid)!.mid, a.hab.pre);

    // Live operations: one bound to the old member (as party member or as frozen custodian), one of another group.
    const held = new Set(["old-member", "old-custodian", "other-group", "unblind-old", "unblind-other"]);
    const party = (group: string, member: string, custodian: string) => ({
      group: { pre: group },
      member: { pre: member },
      custodian,
    });
    const issuance = Object.create(IssuanceOperations.prototype) as IssuanceOperations;
    const live = new Map<string, unknown>();
    for (
      const [grant, row, who] of [
        ["Gmember", "old-member", party(gid, a.hab.pre!, b.hab.pre!)],
        ["Gcustodian", "old-custodian", party(gid, fresh.pre!, a.hab.pre!)],
        ["Gother", "other-group", party("Eother", a.hab.pre!, a.hab.pre!)],
      ] as const
    ) {
      live.set(partyKey(grant, "holder"), {
        grant,
        role: "holder",
        group: { party: who },
        dh: { abandon: () => held.delete(row) },
      });
    }
    Object.assign(issuance, { live, ended: new Map(), deps: {} });
    const unblinding = Object.create(UnblindingOperations.prototype) as UnblindingOperations;
    const unblinds = new Map<string, unknown>();
    for (
      const [grant, row, group] of [["Umember", "unblind-old", gid], ["Uother", "unblind-other", "Eother"]] as const
    ) {
      unblinds.set(unblindingKey(grant, "responder"), {
        grant,
        role: "responder",
        hab: { pre: group },
        group: { member: { pre: a.hab.pre! } },
        owner: { abandon: () => held.delete(row) },
      });
    }
    Object.assign(unblinding, { live: unblinds, settled: new Map(), deps: {} });
    const runtime = {
      hby: a.hby,
      operations: { issuance, unblinding },
      mailboxPoller: { prompt() {} },
      kelPublisher: { prompt() {} },
      rootReplicator: null,
    } as unknown as AgentRuntime;

    const replaced = replaceGroupMember(runtime, { group: gid, member: fresh, smids: next, rmids: next });
    assertEquals(replaced, { previous: a.hab.pre, issuance: ["Gmember", "Gcustodian"], unblinding: ["Umember"] });
    assertEquals([...held], ["other-group", "unblind-other"], "ended operations leave no held row; others stay");
    const ended = (issuance as unknown as { ended: Map<string, { state: string; reason: string }> }).ended;
    assertEquals(ended.get(partyKey("Gmember", "holder"))?.state, "abandoned");
    assert(ended.get(partyKey("Gcustodian", "holder"))?.reason.includes("was replaced by"));
    assertEquals(issuance.liveOf("Gother", "holder") !== undefined, true);
    assertEquals(issuance.liveOf("Gmember", "holder"), undefined);
    assertEquals(unblinding.liveOf("Uother", "responder") !== undefined, true);
    const group = a.hby.habs.get(gid)!;
    assertEquals(a.hby.db.rrpe.get([copy.said!]), null, "no escrowed copy stays addressed to the old member");
    assertEquals(a.hby.db.rrsn.get([gid, "Eregistry", a.hab.pre!]), null);
    assert(a.hby.db.rrsn.get([gid, "Eregistry", b.hab.pre!]), "rows for other members stay");
    const record = a.hby.db.getHab(gid)!;
    assertEquals(record.mid, fresh.pre);
    assertEquals(record.name, "g");
    assertEquals([record.smids, record.rmids], [next, next]);
    assertEquals(a.hby.ks.getSmids(gid).map(t => t[0].qb64), next);
    assertEquals(a.hby.db.getKever(gid)!.sn, 1, "no event was made");

    // The re-pointed habitat signs as the replacement, at the replacement's index.
    const signed = group.sign(body, true);
    assertEquals(signed.map(sig => sig.index), [2]);
    assert(fresh.kever!.verfers[0].verify(signed[0].raw, body));
    const interaction = a.hby.interactGroupHab("g");
    assertEquals(interaction.sigers.map(sig => sig.index), [2]);

    // It contributes to a rotation: its next key was committed by the group's last rotation.
    for (const side of [b, c]) side.hab.rotate();
    fresh.rotate();
    share(b.hby, b.hab.pre!, [a.hby]);
    share(c.hby, c.hab.pre!, [a.hby]);
    const contributed = a.hby.rotateGroupHab("g", undefined, undefined, { isith: "2", nsith: "2", toad: 0 });
    assertEquals(contributed.sigers.map(sig => sig.index), [2]);

    // A reopen's member-list repair keeps the replacement.
    assertEquals(a.hby.recoverAcceptedGroupMembers(gid), false);
    (a.hby as unknown as { loadHabs(): void }).loadHabs();
    assertEquals(a.hby.db.getHab(gid)!.mid, fresh.pre);
    assertEquals(a.hby.habs.get(gid)!.sign(body, true).map(sig => sig.index), [2]);
  });
});

const blockedOf = (status: ReturnType<Counselor["status"]>) => status.state === "pending" ? status.blocked : undefined;
const stageOf = (status: ReturnType<Counselor["status"]>) => status.state === "pending" ? status.stage : undefined;

/** Witness `serder` at `hby` with `witness` as receipt index 0. */
function witness(hby: Habery, serder: SerderKERI, witness: Hab) {
  const signature = witness.sign(serder.raw, true)[0];
  hby.db.wigs.put(dgKey(serder.pre!, serder.said!), [
    new Siger({ code: signature.code, raw: signature.raw, index: 0 }),
  ]);
}

/**
 * Two members delegate a group (witnessed by `gw`) under delegator `del` (witnessed by `dw` when `witnessed`).
 * Every side holds every KEL; the group's own event is accepted by both members, with no anchor yet.
 */
function* delegated({ witnessed = false, known = true, delegateWits = true } = {}) {
  const sides = yield* members(3);
  const [a, b, d] = sides;
  const [dw, gw] = yield* witnesses(2);
  const del = witnessed
    ? d.hby.makeHab("delegator", undefined, { wits: [dw.pre!], toad: 1 })
    : d.hby.makeHab("delegator");
  if (witnessed) witness(d.hby, del.kever!.serder, dw);
  if (known) share(d.hby, del.pre!, [a.hby, b.hby]);
  const smids = pres([a, b]);
  const args = { isith: "2", nsith: "2", delpre: del.pre!, ...(delegateWits ? { wits: [gw.pre!], toad: 1 } : {}) };
  const created = [a, b].map(s => incept(s, smids, args));
  [a, b].forEach((s, i) => deliver(s.hby, created[1 - i]));
  const anchor = (serder: SerderKERI) => {
    del.interact({ data: [{ i: serder.pre, s: serder.snh, d: serder.said }] });
    const ixn = d.hby.db.getEvtSerder(del.pre!, del.kever!.said)!;
    if (witnessed) witness(d.hby, ixn, dw);
    share(d.hby, del.pre!, [a.hby, b.hby]);
    return ixn;
  };
  return { a, b, d, del, dw, gw, smids, created, gid: created[0].serder.pre!, anchor, dip: ref(created[0].serder) };
}

Deno.test("design risk 4: a delegate accepts its own delegated event and takes witness receipts before the delegator's anchor", async () => {
  await run(function*() {
    const w = yield* delegated();
    const { a, gid, gw, dip, anchor } = w;
    const seal = { i: gid, s: "0", d: gid };
    assertEquals(a.hby.db.kels.getLast(gid, 0), gid); // accepted by its own members, unanchored
    assertEquals(a.hby.db.fetchLastSealingEventByEventSeal(w.del.pre!, seal), null);
    witness(a.hby, w.created[0].serder, gw);
    assert(a.hby.db.fullyWitnessed(w.created[0].serder)); // receipts count with no anchor
    const { c } = counselor(a, [gw], undefined, true);
    c.start(dip);
    yield* c.processOnce();
    // So the delegation stage follows acceptance and holds the Anchorer's receipts-request-anchor-publish phases.
    assertEquals(stageOf(c.status(dip)), "delegation");
    anchor(w.created[0].serder);
    assert(a.hby.db.fetchLastSealingEventByEventSeal(w.del.pre!, seal));
  });
});

Deno.test("KERIpy test_counselor (delegated): the publishing member drives the Anchorer with the member hab, an explicit proxy wins, and it completes", async () => {
  await run(function*() {
    const { a, gid, gw, dip } = yield* delegated();
    const x = counselor(a, [gw], undefined, true);
    x.c.start(dip);
    yield* x.c.processOnce();
    // KERIpy sends group traffic from the member hab: an inception needs no proxy.
    assertEquals(x.anchorer.begun, [{ said: gid, sender: a.hab.pre }]);
    assertEquals(x.receipting.calls, ["receipt:0"]);
    assertEquals(blockedOf(x.c.status(dip)), undefined);

    const proxy = a.hby.makeHab("proxy");
    x.c.supply(dip, { proxy });
    yield* x.c.processOnce();
    yield* x.c.processOnce();
    assertEquals(x.anchorer.begun.at(-1), { said: gid, sender: proxy.pre }); // re-pinned once, then stable
    assertEquals(x.anchorer.begun.length, 2);
    assertEquals(blockedOf(x.c.status(dip)), undefined);
    assertEquals(x.c.status(dip).state, "pending");

    x.anchorer.done.add(`${gid}:0`); // the Anchorer finished: request, anchor, publication
    yield* x.c.processOnce();
    assertEquals(x.c.status(dip), { state: "complete" });
    assertEquals([a.hby.db.gdee.get([gid]), a.hby.db.cgms.get([gid, "MAAA"])?.qb64], [[], gid]);
  });
});

Deno.test("a delegated rotation completes through the member's own hab, with no proxy", async () => {
  await run(function*() {
    const w = yield* delegated();
    const { a, b, gid, gw, d, smids } = w;
    rotateMembers([a, b, d], [a, b]);
    const rots = [a, b].map(s => rotate(s, smids, smids, { isith: "2", nsith: "2", toad: 1 }));
    [a, b].forEach((s, i) => deliver(s.hby, rots[1 - i]));
    const drt = ref(rots[0].serder);
    assertEquals([rots[0].serder.ilk, drt.sn], ["drt", 1]);
    const x = counselor(a, [gw], undefined, true);
    x.c.start(drt);
    yield* x.c.processOnce();
    assertEquals(x.anchorer.begun, [{ said: drt.said, sender: a.hab.pre }]);
    assertEquals([stageOf(x.c.status(drt)), blockedOf(x.c.status(drt))], ["delegation", undefined]);
    x.anchorer.done.add(`${gid}:1`);
    yield* x.c.processOnce();
    assertEquals(x.c.status(drt), { state: "complete" });
  });
});

Deno.test("a non-elected member queries the delegator's witness, pins the anchor seal, and continues to witness receipts", async () => {
  await run(function*() {
    const w = yield* delegated({ witnessed: true });
    const { b, gid, gw, dw, dip, anchor } = w;
    b.hby.db.locs.pin([dw.pre!, "http"], { url: "http://127.0.0.1:1" } as never);
    const y = counselor(b, [gw], undefined, true);
    y.c.start(dip);
    yield* y.c.processOnce();
    const waiting = y.c.status(dip);
    assertEquals([waiting.state === "pending" && waiting.elected, blockedOf(waiting), y.queries.length], [
      false,
      undefined,
      1,
    ]);
    assertEquals(y.anchorer.begun, []); // only the publishing member begins the Anchorer

    const ixn = anchor(w.created[0].serder);
    yield* y.c.processOnce();
    // test_anchorer's final check: aess holds the delegating event's sn and said.
    const seal = b.hby.db.aess.get(dgKey(gid, gid))!;
    assertEquals([seal[0].num, seal[1].qb64], [BigInt(ixn.sn!), ixn.said]);
    assertEquals([stageOf(y.c.status(dip)), y.queries.length], ["witnesses", 1]);

    assertEquals(y.receipting.calls, ["get:0"]); // fetching, not submitting
    y.receipting.fetchable = true; // the elected member's receipts become fetchable
    y.clock.t = 5_000; // past the retry backoff
    yield* y.c.processOnce();
    assertEquals([y.receipting.calls, y.c.status(dip)], [["get:0", "get:0"], { state: "complete" }]);
  });
});

Deno.test("fallback publishes the delegation request at 0 and after a positive grace", async () => {
  await run(function*() {
    const { b, gid, gw, dip } = yield* delegated();
    const proxy = b.hby.makeHab("proxy");
    const eager = counselor(b, [gw], undefined, true);
    eager.c.start(dip, { fallbackAfterMs: 0, proxy });
    yield* eager.c.processOnce();
    assertEquals(eager.anchorer.begun, [{ said: gid, sender: proxy.pre }]); // every member publishes

    const patient = counselor(b, [gw], { t: 0 }, true);
    patient.c.start(dip, { fallbackAfterMs: 3_000, proxy });
    for (const t of [0, 2_999]) {
      patient.clock.t = t;
      yield* patient.c.processOnce();
    }
    assertEquals(patient.anchorer.begun, []);
    patient.clock.t = 3_000;
    yield* patient.c.processOnce();
    assertEquals(patient.anchorer.begun.length, 1);
  });
});

Deno.test("a restarted Counselor resumes a delegated inception from its rows with the member hab, and re-pins a supplied proxy", async () => {
  await run(function*() {
    const { a, gid, gw, dip } = yield* delegated();
    const proxy = a.hby.makeHab("proxy");
    const first = counselor(a, [gw], undefined, true);
    first.c.start(dip, { proxy });
    yield* first.c.processOnce();
    assertEquals(first.anchorer.begun.length, 1);

    // The rows survive; the proxy and the Anchorer hand-off do not.
    const second = counselor(a, [gw], undefined, true);
    assertEquals(second.c.pending(), [{ ...dip, stage: "delegation" }]);
    yield* second.c.processOnce();
    assertEquals([blockedOf(second.c.status(dip)), second.anchorer.begun], [undefined, [{
      said: gid,
      sender: a.hab.pre,
    }]]);
    second.c.supply(dip, { proxy });
    yield* second.c.processOnce();
    assertEquals(second.anchorer.begun.at(-1), { said: gid, sender: proxy.pre });
    second.anchorer.done.add(`${gid}:0`);
    yield* second.c.processOnce();
    assertEquals(second.c.status(dip), { state: "complete" });
  });
});

Deno.test("a delegated event reads delegatorUnknown until the delegator's KEL arrives, and supersession drops only its tuple", async () => {
  await run(function*() {
    const w = yield* delegated({ known: false });
    const { a, gid, gw, dip, d, del } = w;
    const x = counselor(a, [gw], undefined, true);
    x.c.start(dip);
    yield* x.c.processOnce();
    assertEquals(blockedOf(x.c.status(dip)), { kind: "delegatorUnknown", delpre: del.pre });
    assertEquals(x.anchorer.begun, []);
    share(d.hby, del.pre!, [a.hby]);
    assertEquals(blockedOf(x.c.status(dip)), undefined);

    // A stale tuple at the same sn is removed alone.
    const stale = { pre: gid, sn: 0, said: "E" + "C".repeat(43) };
    a.hby.db.gdee.add([gid], [NumberPrimitive.fromNum(0n), new Diger({ qb64: stale.said })]);
    assertEquals(x.c.status(stale), { state: "superseded", accepted: gid });
    yield* x.c.processOnce();
    assertEquals(x.c.pending(), [{ ...dip, stage: "delegation" }]);
  });
});

Deno.test("G1 review: a counseled event whose body is not stored reads pending, never unknown", async () => {
  await run(function*() {
    const sides = yield* members(2);
    const gid = pair(sides);
    const { c } = counselor(sides[0]);
    const future = { pre: gid, sn: 5, said: "E" + "D".repeat(43) };
    c.start(future);
    assertEquals(c.status(future), {
      state: "pending",
      stage: "signatures",
      elected: null,
      receipts: { have: 0, need: 0 },
    });
  });
});

Deno.test("G1 review: start does not retain inputs for a complete or superseded event, and keeps them for a counseled one", async () => {
  await run(function*() {
    const sides = yield* members(2);
    const gid = pair(sides);
    const { c } = counselor(sides[0]);
    const runs = () => (c as unknown as { runs: Map<string, unknown> }).runs.size;
    const icp = { pre: gid, sn: 0, said: gid };
    c.start(icp, { auths: { a: "b" } });
    assertEquals(c.start(icp, { auths: { a: "c" } }), false); // counseled: inputs are re-supplied
    assertEquals(runs(), 1);
    yield* c.processOnce();
    assertEquals(c.status(icp), { state: "complete" });
    assertEquals([c.start(icp, { auths: { a: "d" } }), runs()], [false, 0]); // complete
    const rival = { ...icp, said: "E" + "F".repeat(43) };
    assertEquals([c.start(rival, { auths: { a: "d" } }), runs()], [false, 0]); // another SAID holds sn 0
    c.supply(icp, { auths: { a: "e" } });
    assertEquals(runs(), 0);
  });
});

Deno.test("G1 review: abandon publishes one <pre>:<sn> change per removed event", async () => {
  await run(function*() {
    const sides = yield* members(2);
    const gid = pair(sides);
    const { c, changes } = counselor(sides[0]);
    c.start({ pre: gid, sn: 0, said: gid });
    yield* c.processOnce(); // sn 0 completes (cgms)
    c.start({ pre: gid, sn: 1, said: "E" + "D".repeat(43) }); // sn 1 stays in gpse
    changes.changes.length = 0;
    c.abandon(gid);
    assertEquals(changes.changes.map(change => change.id).sort(), [`${gid}:0`, `${gid}:1`]);
  });
});

Deno.test("the real Anchorer, begun by the Counselor, completes and the Counselor records it", async () => {
  await run(function*() {
    const w = yield* delegated({ delegateWits: false });
    const { a, gid, dip, anchor } = w;
    const sent: unknown[] = [];
    const postman = {
      send: (request: unknown) => sent.push(request),
      *wait() {
        return { kin: "sent" };
      },
    };
    const clock = { now: () => 0 } as never;
    const anchorer = new Anchorer(a.hby, postman as never, { enqueue() {} }, null, {} as never, clock);
    const receipting = new FakeReceipting(a.hby, []);
    const c = new Counselor(a.hby, receipting, clock, undefined, { anchorer, querying: { enqueue() {} } });
    const proxy = a.hby.makeHab("proxy");
    c.start(dip, { proxy });
    yield* c.processOnce();
    assertEquals(anchorer.workflowStatus(gid, "0"), {
      phase: "waitingWitnessReceipts",
      proxyDependent: true,
      complete: false,
    });
    yield* anchorer.processAllOnce(); // request and event go to the delegator through the proxy
    assertEquals(sent.length, 2);
    assertEquals(anchorer.workflowStatus(gid, "0").phase, "waitingDelegatorAnchor");
    anchor(w.created[0].serder);
    yield* anchorer.processAllOnce();
    assert(anchorer.complete(gid, 0));
    yield* c.processOnce();
    assertEquals(c.status(dip), { state: "complete" });
  });
});

Deno.test("the elected member forwards a completed event to the other members, retrying the ones it could not reach", async () => {
  await run(function*() {
    const sides = yield* members(3);
    const gid = pair(sides);
    const event = ref(sides[0].hby.db.getEvtSerder(gid, gid)!);
    const sent: string[][] = [];
    let reachable = false;
    const forwarding: GroupForwarding = {
      *forward(forwarded, to) {
        sent.push([...to]);
        return to.map(recipient => {
          const failed = !reachable && recipient === pres(sides)[2];
          return {
            recipient,
            exnSaid: forwarded.said,
            payloadSaid: forwarded.said,
            outcome: failed ? "failed" as const : "delivered" as const,
            deliveries: [],
            ...(failed ? { reason: "no route" } : {}),
          };
        });
      },
    };
    const elected = counselor(sides[0], [], { t: 0 }, false, undefined, forwarding);
    const other = counselor(sides[1], [], { t: 0 }, false, undefined, forwarding);
    elected.c.start(event);
    other.c.start(event);
    yield* elected.c.processOnce();
    yield* other.c.processOnce();
    assertEquals(sent, [[pres(sides)[1], pres(sides)[2]]], "only the elected member forwards, to every other member");
    assertEquals(
      elected.c.forwardOutcomes(event).map(({ recipient, outcome }) => [recipient, outcome]),
      [[pres(sides)[1], "delivered"], [pres(sides)[2], "failed"]],
    );
    // The member it could not reach is tried again after the delay, alone, and never again once it took the event.
    reachable = true;
    yield* elected.c.processOnce();
    assertEquals(sent.length, 1, "not before the retry delay");
    elected.clock.t = 2_000;
    yield* elected.c.processOnce();
    assertEquals(sent, [[pres(sides)[1], pres(sides)[2]], [pres(sides)[2]]]);
    elected.clock.t = 60_000;
    yield* elected.c.processOnce();
    assertEquals(sent.length, 2);
  });
});

/**
 * A group whose local member `a` was rotated out by the others, with `fresh` (another habitat of `a`'s Habery)
 * in the accepted state: the point where `replaceGroupMember` applies. Nothing is replaced yet.
 */
function* rotatedOutMember() {
  const [a, b, c] = yield* members(3), fresh = a.hby.makeHab("replacement");
  share(a.hby, fresh.pre!, [b.hby, c.hby]);
  const smids = pres([a, b, c]), gid = pairAt([a, b, c], smids, [...smids, fresh.pre!]);
  b.hab.rotate();
  c.hab.rotate();
  fresh.rotate();
  share(b.hby, b.hab.pre!, [a.hby, c.hby]);
  share(c.hby, c.hab.pre!, [a.hby, b.hby]);
  share(a.hby, fresh.pre!, [b.hby, c.hby]);
  const next = [b.hab.pre!, c.hab.pre!, fresh.pre!];
  const rots = [b, c].map(s => rotate(s, next, next, { isith: "2", nsith: "2", toad: 0 }));
  [b, c].forEach((s, i) => deliver(s.hby, rots[1 - i]));
  rots.forEach(r => deliver(a.hby, r));
  return { a, b, c, fresh, gid, next };
}

Deno.test("replaceGroupMember prompts poller, publisher and replicator", async () => {
  await run(function*() {
    const { a, fresh, gid, next } = yield* rotatedOutMember();
    const prompted: string[] = [];
    const spy = (name: string) => ({ prompt: (group: string) => void prompted.push(`${name}:${group}`) });
    const runtime = {
      hby: a.hby,
      operations: null,
      mailboxPoller: spy("poller"),
      kelPublisher: spy("publisher"),
      rootReplicator: spy("replicator"),
    } as unknown as AgentRuntime;
    replaceGroupMember(runtime, { group: gid, member: fresh, smids: next });
    assertEquals(prompted, [`poller:${gid}`, `publisher:${gid}`, `replicator:${gid}`]);
    // A runtime without a root replicator (no IPEX) is replaced all the same.
    const { a: other, fresh: replacement, gid: group, next: members2 } = yield* rotatedOutMember();
    replaceGroupMember(
      { ...runtime, hby: other.hby, rootReplicator: null } as unknown as AgentRuntime,
      { group, member: replacement, smids: members2 },
    );
    assertEquals(other.hby.db.getHab(group)!.mid, replacement.pre);
  });
});

Deno.test("expired KEL budget re-arms after member replacement", async () => {
  await run(function*() {
    const { a, fresh, gid, next } = yield* rotatedOutMember();
    const http = new FakeRuntimeHttpClient();
    let status = 500;
    http.registerOrigin("http://alpha.test/", () => new Response(null, { status }));
    a.hby.db.ends.pin([gid, "mailbox", "alpha"], { allowed: true });
    a.hby.db.locs.pin(["alpha", "http"], { url: "http://alpha.test/" });
    const clock = new ManualRuntimeClock(0);
    const publisher = new KelPublisher({ hby: a.hby, http, clock });
    // The old member's posts fail until the five-minute budget is used up.
    for (let second = 0; second <= 400; second++) {
      yield* publisher.processOnce();
      clock.advance(1_000);
    }
    assertEquals(publisher.statusOf(gid).map(entry => entry.state), ["timed-out"]);
    status = 204;
    assertEquals(yield* publisher.processDue(), [], "an expired budget is not retried by itself");

    const runtime = {
      hby: a.hby,
      operations: null,
      mailboxPoller: { prompt() {} },
      kelPublisher: publisher,
      rootReplicator: null,
    } as unknown as AgentRuntime;
    replaceGroupMember(runtime, { group: gid, member: fresh, smids: next });
    assertEquals((yield* publisher.processDue()).map(result => result.outcome), ["told"]);
    assertEquals(publisher.statusOf(gid).map(entry => entry.state), ["published"]);
    assertEquals(a.hby.db.kpub.get([gid, "alpha"])?.m, fresh.kever!.lastEst.d, "the new member's head is recorded");
  });
});

Deno.test("root copies re-derive for the new sender", async () => {
  await run(function*() {
    const { a, b, c, fresh, gid, next } = yield* rotatedOutMember();
    const everyone = [a.hab.pre!, ...next];
    // Only what the replicator reads of the root: the held registry, the members and the contribution key.
    const root = { hby: a.hby, held: () => ["Eregistry"], members: () => everyone, contributor: () => "K" };
    const replicator = new RootReplicator({
      root: root as unknown as RegistryRoot,
      postman: {} as Poster,
      clock: new ManualRuntimeClock(0),
    });
    const owed = () => replicator.status().owed.map(copy => copy.recipient).sort();
    replicator.sweep();
    assertEquals(owed(), [b.hab.pre!, c.hab.pre!, fresh.pre!].sort(), "the recorded member sends to every other");

    const runtime = {
      hby: a.hby,
      operations: null,
      mailboxPoller: { prompt() {} },
      kelPublisher: { prompt() {} },
      rootReplicator: replicator,
    } as unknown as AgentRuntime;
    replaceGroupMember(runtime, { group: gid, member: fresh, smids: next });
    replicator.sweep();
    assertEquals(owed(), [a.hab.pre!, b.hab.pre!, c.hab.pre!].sort(), "the new sender owes the old member, not itself");
  });
});
