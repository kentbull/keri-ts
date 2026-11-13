/**
 * `rejoinGroup` over two in-memory runtimes: a custodial agent that holds the group and serves its OOBI
 * through the in-process Tufa app, and a wallet that lost its store and re-adopted its non-transferable,
 * held member. Every wallet member has signing weight 0, so membership is never read from weight.
 */
import { ensure, type Operation, run } from "effection";
import { assert, assertEquals } from "jsr:@std/assert";
import { MtrDex, type SerderKERI, type Siger, Signer, Vrsn_2_0 } from "../../../../../cesr/mod.ts";
import { type Hab, type Habery, openHabery } from "../../../../src/app/identity/habbing.ts";
import { type RejoinDeps, rejoinGroup, type RejoinResult } from "../../../../src/app/multisig/rejoin-group.ts";
import { type AgentRuntime, createAgentRuntime } from "../../../../src/app/runtime/agent-runtime.ts";
import { systemClock } from "../../../../src/app/runtime/runtime-clock.ts";
import { MemoryChangeSink } from "../../../../src/app/runtime/workflow-contract.ts";
import { withRuntimeWorkers } from "../../../../src/cli/common/runtime-workers.ts";
import { ValidationError } from "../../../../src/core/errors.ts";
import { incept } from "../../../../src/core/protocol-eventing.ts";
import { dgKey } from "../../../../src/db/core/keys.ts";
import { MemStoreOpener } from "../../../../src/db/core/memstore.ts";
import { FakeRuntimeHttpClient, InProcessRuntimeHost } from "../../../support/runtime-fakes.ts";

/** A non-transferable single-key identifier built outside any Habery, as a browser wallet holds it. */
interface HeldMember {
  signer: Signer;
  serder: SerderKERI;
  sigers: Siger[];
  pre: string;
}

/** The custodial co-member: its Habery, its member `a`, and the origin serving its OOBIs. */
interface Agent {
  http: FakeRuntimeHttpClient;
  hby: Habery;
  a: Hab;
  origin: string;
}

/** A wallet after losing its store: a fresh Habery with its member re-adopted and held, and a runtime. */
interface Wallet {
  hby: Habery;
  runtime: AgentRuntime;
  member: Hab;
}

/** Wallet members carry no signing weight; `a` alone satisfies the group's thresholds. */
const groupArgs = { isith: ["1", "0"], nsith: "1", toad: 0 };

function heldMember(): HeldMember {
  const signer = Signer.random({ code: MtrDex.Ed25519_Seed, transferable: false });
  const serder = incept([signer.verfer.qb64], { version: Vrsn_2_0, code: signer.verfer.code, nsith: "0", toad: 0 });
  return { signer, serder, sigers: [signer.sign(serder.raw, { index: 0 }) as Siger], pre: serder.pre! };
}

function* memHabery(): Operation<Habery> {
  const hby = yield* openHabery({
    name: crypto.randomUUID(),
    temp: true,
    skipConfig: true,
    opener: new MemStoreOpener(),
  });
  yield* ensure(() => hby.close(true));
  return hby;
}

/** Accept every accepted event of `pre` from `from` at `to`. */
function share(from: Habery, pre: string, to: Habery) {
  for (const [, said] of [...from.db.getKelItemIter(pre)]) {
    const serder = from.db.getEvtSerder(pre, said)!;
    const sigers = from.db.sigs.get(dgKey(pre, said));
    to.kevery.processEvent({ serder, sigers, wigers: [], frcs: [], sscs: [], ssts: [], local: false });
  }
  to.kevery.processEscrows();
}

/** Accept a held member's inception at `hby`. */
function learn(hby: Habery, member: HeldMember) {
  const { serder, sigers } = member;
  hby.kevery.processEvent({ serder, sigers, wigers: [], frcs: [], sscs: [], ssts: [], local: false });
}

function* agent(): Operation<Agent> {
  const http = new FakeRuntimeHttpClient();
  const hby = yield* memHabery();
  const a = hby.makeHab("a");
  const runtime = yield* createAgentRuntime(hby, http, systemClock);
  yield* ensure(() => runtime.close());
  return { http, hby, a, origin: new InProcessRuntimeHost(http, { runtime }).origin };
}

/** A group at the agent whose signing members are `a` and `members`, and whose only rotation member is `a`. */
function inceptGroup(agent: Agent, members: HeldMember[]): string {
  for (const member of members) learn(agent.hby, member);
  const smids = [agent.a.pre!, ...members.map((m) => m.pre)];
  const created = agent.hby.makeGroupHab("g", agent.a, smids, [agent.a.pre!], undefined, {
    ...groupArgs,
    isith: smids.map((_, i) => i === 0 ? "1" : "0"),
  });
  const gid = created.serder.pre!;
  assert(agent.hby.db.getKever(gid), "a alone accepts the inception");
  return gid;
}

/**
 * The wallet re-adopts `member` with `makeSignedHab` and holds its signer. With `knowsAgent`, it already knows
 * the co-member's KEL (from resolving its OOBI earlier, for example).
 */
function* wallet(agent: Agent, member: HeldMember, knowsAgent = true): Operation<Wallet> {
  const hby = yield* memHabery();
  const hab = hby.makeSignedHab("member", undefined, { serder: member.serder, sigers: member.sigers });
  hby.mgr.hold([member.signer]);
  if (knowsAgent) share(agent.hby, agent.a.pre!, hby);
  const runtime = yield* createAgentRuntime(hby, agent.http, systemClock);
  yield* ensure(() => runtime.close());
  return { hby, runtime, member: hab };
}

const groupOobi = (agent: Agent, gid: string) => `${agent.origin}/oobi/${gid}/controller`;

/** What a test varies per rejoin; the member is the wallet's and the alias is `g`. */
interface RejoinCall {
  oobi: string;
  group: string;
  timeoutMs?: number;
}

/** Run `rejoinGroup` with the wallet's runtime workers around it. */
function* rejoin(w: Wallet, input: RejoinCall, deps: RejoinDeps = w.runtime): Operation<RejoinResult> {
  return yield* withRuntimeWorkers(
    w.runtime,
    { pollMailbox: false },
    () => rejoinGroup(deps, { member: w.member, alias: "g", timeoutMs: 10_000, ...input }),
  );
}

/** No group record, name or habitat at the wallet. */
function assertNothingWritten(w: Wallet, gid: string) {
  assertEquals(w.hby.db.getHab(gid), null);
  assertEquals(w.hby.db.getName("", "g"), null);
  assertEquals(w.hby.habs.has(gid), false);
}

Deno.test("rejoinGroup rebuilds the group record from accepted state", async () => {
  await run(function*() {
    const ag = yield* agent();
    const member = heldMember();
    const gid = inceptGroup(ag, [member]);
    const w = yield* wallet(ag, member);
    const prompted: string[] = [], changes = new MemoryChangeSink();
    const prompt = (name: string) => ({ prompt: (pre: string) => void prompted.push(`${name}:${pre}`) });
    const deps: RejoinDeps = {
      hby: w.hby,
      oobiery: w.runtime.oobiery,
      clock: systemClock,
      mailboxPoller: prompt("poller"),
      kelPublisher: prompt("publisher"),
      rootReplicator: prompt("replicator"),
      changes,
    };
    const oobi = groupOobi(ag, gid);

    const result = yield* rejoin(w, { oobi, group: gid }, deps);

    assertEquals(result, {
      outcome: "joined",
      group: gid,
      alias: "g",
      smids: [ag.a.pre, member.pre],
      rmids: [ag.a.pre],
    });
    const record = w.hby.db.getHab(gid)!;
    assertEquals([record.mid, record.name, record.smids, record.rmids], [
      member.pre,
      "g",
      [ag.a.pre, member.pre],
      [ag.a.pre],
    ]);
    assertEquals(w.hby.habByName("g")?.pre, gid);
    assert(w.hby.habs.get(gid)!.accepted);
    assertEquals(prompted, [`poller:${gid}`, `publisher:${gid}`, `replicator:${gid}`]);
    assertEquals(changes.changes, [{ kind: "oobi", id: oobi }, { kind: "group", id: gid }]);
  });
});

Deno.test("rejoinGroup refuses an identifier that is not a member and writes nothing", async () => {
  await run(function*() {
    const ag = yield* agent();
    const gid = inceptGroup(ag, [heldMember()]);
    const w = yield* wallet(ag, heldMember());

    const result = yield* rejoin(w, { oobi: groupOobi(ag, gid), group: gid });

    assertEquals(result, { outcome: "not-member", group: gid, member: w.member.pre });
    assert(w.hby.db.getKever(gid), "the group's key state was learned");
    assertNothingWritten(w, gid);
  });
});

Deno.test("rejoinGroup uses the members of a rotated group, not the inception's", async () => {
  await run(function*() {
    const ag = yield* agent();
    const before = heldMember(), after = heldMember();
    const gid = inceptGroup(ag, [before]);
    learn(ag.hby, after);
    ag.a.rotate();
    ag.hby.rotateGroupHab("g", [ag.a.pre!, after.pre], [ag.a.pre!], groupArgs);
    assertEquals(ag.hby.db.getKever(gid)!.sn, 1);
    const oobi = groupOobi(ag, gid);

    const joined = yield* wallet(ag, after);
    assertEquals(yield* rejoin(joined, { oobi, group: gid }), {
      outcome: "joined",
      group: gid,
      alias: "g",
      smids: [ag.a.pre, after.pre],
      rmids: [ag.a.pre],
    });
    assertEquals(joined.hby.db.getHab(gid)?.smids, [ag.a.pre, after.pre]);

    const removed = yield* wallet(ag, before);
    assertEquals(yield* rejoin(removed, { oobi, group: gid }), {
      outcome: "not-member",
      group: gid,
      member: before.pre,
    });
    assertNothingWritten(removed, gid);
  });
});

Deno.test("rejoinGroup times out without accepted state and writes nothing", async () => {
  await run(function*() {
    const ag = yield* agent();
    const member = heldMember();
    const gid = inceptGroup(ag, [member]);

    // The OOBI resolves, but it is the co-member's: the group's key state never arrives.
    const w = yield* wallet(ag, member);
    const other = `${ag.origin}/oobi/${ag.a.pre}/controller`;
    assertEquals(yield* rejoin(w, { oobi: other, group: gid, timeoutMs: 300 }), {
      outcome: "timed-out",
      group: gid,
      timeoutMs: 300,
      waiting: "group-key-state",
    });
    assertNothingWritten(w, gid);

    // The group's key state arrives, but the co-member's KEL is unknown, so its key cannot be attributed.
    const stranger = yield* wallet(ag, member, false);
    assertEquals(yield* rejoin(stranger, { oobi: groupOobi(ag, gid), group: gid, timeoutMs: 300 }), {
      outcome: "timed-out",
      group: gid,
      timeoutMs: 300,
      waiting: "member-key-state",
    });
    assert(stranger.hby.db.getKever(gid));
    assertNothingWritten(stranger, gid);
  });
});

Deno.test("rejoinGroup is idempotent for the recorded member", async () => {
  await run(function*() {
    const ag = yield* agent();
    const member = heldMember();
    const gid = inceptGroup(ag, [member]);
    const w = yield* wallet(ag, member);
    const oobi = groupOobi(ag, gid);
    const first = yield* rejoin(w, { oobi, group: gid });
    assertEquals(first.outcome, "joined");
    const requests = ag.http.requests.length, record = w.hby.db.getHab(gid);

    // A repeat resolves nothing and writes nothing.
    assertEquals(yield* rejoin(w, { oobi, group: gid }), first);
    assertEquals(ag.http.requests.length, requests);
    assertEquals(w.hby.db.getHab(gid), record);

    // Misuse throws before any I/O: another member of this Habery, and the group as its own member.
    const other = heldMember();
    const otherHab = w.hby.makeSignedHab("other", undefined, { serder: other.serder, sigers: other.sigers });
    const base = { oobi, group: gid, alias: "g", timeoutMs: 1_000 };
    yield* assertRefused(rejoinGroup(w.runtime, { ...base, member: otherHab }), "use replaceGroupMember");
    yield* assertRefused(rejoinGroup(w.runtime, { ...base, member: w.hby.habs.get(gid)! }), "is a group identifier");
    assertEquals(ag.http.requests.length, requests);
    assertEquals(w.hby.db.getHab(gid), record);
  });
});

/** Assert that `op` throws a ValidationError whose message includes `text`. */
function* assertRefused(op: Operation<unknown>, text: string): Operation<void> {
  let error: unknown;
  try {
    yield* op;
  } catch (caught) {
    error = caught;
  }
  assert(error instanceof ValidationError, `expected a ValidationError, got ${error}`);
  assert(error.message.includes(text), error.message);
}
