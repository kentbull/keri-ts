/**
 * The Counselor inside a composed runtime, over LMDB-backed Haberys (run in Docker).
 *
 * `reopen` tests port the part of KERIpy `tests/app/test_group_persistence.py`
 * that applies here: a group Hab and its local-member linkage survive closing
 * every store, and counseling resumes from the stored rows with nothing in memory.
 */
import { startServer } from "@keri-ts/hosting";
import { Siger } from "cesr-ts";
import { type Operation, run, sleep, spawn } from "effection";
import { assert, assertEquals, assertExists } from "jsr:@std/assert";
import { type Habery } from "../../../../src/app/identity/habbing.ts";
import { createHabery } from "../../../../src/app/identity/lmdb-habery.ts";
import { waitForGroupEvent } from "../../../../src/app/multisig/counseling.ts";
import {
  type AgentRuntime,
  createAgentRuntime,
  runAgentRuntime,
  runtimePendingState,
  settleRuntimeIngress,
} from "../../../../src/app/runtime/agent-runtime.ts";
import { systemClock } from "../../../../src/app/runtime/runtime-clock.ts";
import type { HttpClient, HttpRequestInit } from "../../../../src/app/transport/http-client.ts";
import { NodeHttpClient } from "../../../../src/app/transport/node-http-client.ts";
import { EndpointRoles } from "../../../../src/core/roles.ts";
import { Schemes } from "../../../../src/core/schemes.ts";
import { dgKey } from "../../../../src/db/core/keys.ts";
import { waitForServer, waitForTaskHalt } from "../../../effection-http.ts";

/** Any use of the network is a failure: these tests run entirely on local state. */
class NoNetwork implements HttpClient {
  calls = 0;
  request(): Operation<never> {
    this.calls++;
    throw new Error("unexpected network request");
  }
  open(): Operation<never> {
    this.calls++;
    throw new Error("unexpected network request");
  }
}

function* open(name: string, dir?: string): Operation<Habery> {
  return yield* createHabery({ name, temp: !dir, headDirPath: dir, skipConfig: true, skipSignator: true });
}

/** Replay every accepted event of `from`'s `pre` into `to`. */
function share(from: Habery, pre: string, to: Habery, local = false) {
  for (const [, said] of [...from.db.getKelItemIter(pre)]) {
    const serder = from.db.getEvtSerder(pre, said)!;
    const sigers = from.db.sigs.get(dgKey(pre, said));
    const wigers = from.db.wigs.get(dgKey(pre, said));
    to.kevery.processEvent({ serder, sigers, wigers, frcs: [], sscs: [], ssts: [], local });
  }
}

function accept(hby: Habery, { serder, sigers }: { serder: import("cesr-ts").SerderKERI; sigers: Siger[] }) {
  hby.kevery.processEvent({ serder, sigers, wigers: [], frcs: [], sscs: [], ssts: [], local: true });
  hby.kevery.processEscrows();
}

const refOf = (serder: import("cesr-ts").SerderKERI) => ({ pre: serder.pre!, sn: serder.sn!, said: serder.said! });

/** Run the runtime's workers while `body` observes; halts them before returning. */
function* working<T>(runtime: AgentRuntime, body: () => Operation<T>): Operation<T> {
  const workers = yield* spawn(() => runAgentRuntime(runtime, { pollMailbox: false }));
  try {
    return yield* body();
  } finally {
    yield* workers.halt();
  }
}

Deno.test("a runtime with nothing counseled makes no receipt, anchor or network calls across many turns", async () => {
  await run(function*() {
    const hby = yield* open(crypto.randomUUID());
    const http = new NoNetwork();
    const runtime = yield* createAgentRuntime(hby, http, systemClock);
    hby.makeHab("idle");
    let passes = 0;
    const processOnce = runtime.counselor.processOnce.bind(runtime.counselor);
    runtime.counselor.processOnce = function*() {
      passes++;
      yield* processOnce();
    };
    yield* working(runtime, () => sleep(150));
    assert(passes > 20, `the loop must actually run, ran ${passes} passes`);
    assertEquals(http.calls, 0);
    assertEquals(runtime.postman.hasPending, false);
    assertEquals([runtimePendingState(runtime).groupPending, runtimePendingState(runtime).delegationPending], [
      false,
      false,
    ]);
    assertEquals(runtime.hby.db.cgms.cnt(), 0);
    yield* runtime.close();
    yield* hby.close(true);
  });
});

Deno.test("KERIpy test_group_persistence: a counseled group event resumes in a fresh runtime over reopened stores", async () => {
  const dir = await Deno.makeTempDir();
  await run(function*() {
    const name = crypto.randomUUID();
    const remote = yield* open(crypto.randomUUID());
    const remoteMember = remote.makeHab("remote");
    let first = yield* open(name, dir);
    const member = first.makeHab("member");
    share(first, member.pre!, remote);
    share(remote, remoteMember.pre!, first);
    const smids = [member.pre!, remoteMember.pre!];
    const args = { isith: "2", nsith: "2" };
    const mine = first.makeGroupHab("group", member, smids, undefined, undefined, args);
    const theirs = remote.makeGroupHab("group", remoteMember, smids, undefined, undefined, args);
    const event = refOf(mine.serder);
    const runtime = yield* createAgentRuntime(first, new NoNetwork(), systemClock);
    runtime.counselor.start(event);
    assertEquals(runtime.counselor.status(event).state, "pending");
    assert(runtimePendingState(runtime).groupPending);
    yield* runtime.close();
    yield* first.close(); // every store closed; nothing is carried over

    first = yield* open(name, dir);
    // The group record and its local-member link are durable even though the event is still unaccepted.
    assertEquals([first.db.getHab(event.pre)?.mid, first.db.getHab(event.pre)?.smids], [member.pre, smids]);
    const resumed = yield* createAgentRuntime(first, new NoNetwork(), systemClock);
    assertEquals(resumed.counselor.pending(), [{ ...event, stage: "signatures" }]);
    accept(first, theirs); // the other member's signature arrives after the restart
    const outcome = yield* working(resumed, () => waitForGroupEvent(resumed.counselor, event, { timeoutMs: 5_000 }));
    assertEquals(outcome, { outcome: "settled", status: { state: "complete" } });
    assertEquals(runtimePendingState(resumed).groupPending, false);
    yield* resumed.close();
    yield* first.close(true);
    yield* remote.close(true);
  });
  await Deno.remove(dir, { recursive: true });
});

Deno.test("KERIpy test_group_persistence (delegated): a delegated event resumes in the delegation stage and finishes on the anchor", async () => {
  const dir = await Deno.makeTempDir();
  await run(function*() {
    const name = crypto.randomUUID();
    const [other, delegatorHby] = [yield* open(crypto.randomUUID()), yield* open(crypto.randomUUID())];
    const otherMember = other.makeHab("other");
    const delegator = delegatorHby.makeHab("delegator");
    let mine = yield* open(name, dir);
    const member = mine.makeHab("member");
    // The persistent member signs second, so the other member is the elected one and this one watches.
    const smids = [otherMember.pre!, member.pre!];
    for (const hby of [mine, other]) {
      share(delegatorHby, delegator.pre!, hby);
    }
    share(mine, member.pre!, other);
    share(other, otherMember.pre!, mine);
    const args = { isith: "2", nsith: "2", delpre: delegator.pre! };
    const created = [
      mine.makeGroupHab("group", member, smids, undefined, undefined, args),
      other.makeGroupHab("group", otherMember, smids, undefined, undefined, args),
    ];
    accept(mine, created[1]);
    accept(other, created[0]);
    const event = refOf(created[0].serder);
    assertEquals(mine.db.kels.getLast(event.pre, 0), event.said); // accepted before any anchor

    let runtime = yield* createAgentRuntime(mine, new NoNetwork(), systemClock);
    runtime.counselor.start(event, { fallbackAfterMs: 3_600_000 });
    yield* runtime.counselor.processOnce();
    assertEquals(runtime.counselor.pending(), [{ ...event, stage: "delegation" }]);
    yield* runtime.close();
    yield* mine.close();

    mine = yield* open(name, dir);
    runtime = yield* createAgentRuntime(mine, new NoNetwork(), systemClock);
    assertEquals(runtime.counselor.pending(), [{ ...event, stage: "delegation" }]);
    delegator.interact({ data: [{ i: event.pre, s: "0", d: event.said }] }); // the delegator approves
    share(delegatorHby, delegator.pre!, mine);
    const outcome = yield* working(runtime, () => waitForGroupEvent(runtime.counselor, event, { timeoutMs: 5_000 }));
    assertEquals(outcome, { outcome: "settled", status: { state: "complete" } });
    assertExists(mine.db.aess.get(dgKey(event.pre, event.said)));
    yield* runtime.close();
    yield* mine.close(true);
    yield* other.close(true);
    yield* delegatorHby.close(true);
  });
  await Deno.remove(dir, { recursive: true });
});

/** Real HTTP that records `METHOD /path` per request, to tell submitting from fetching. */
class Recording implements HttpClient {
  readonly requests: string[] = [];
  private readonly inner = new NodeHttpClient();
  get tcp() {
    return this.inner.tcp;
  }
  request(url: string, init?: HttpRequestInit) {
    this.requests.push(`${init?.method ?? "GET"} ${new URL(url).pathname}`);
    return this.inner.request(url, init);
  }
  open(url: string, init?: HttpRequestInit) {
    this.requests.push(`${init?.method ?? "GET"} ${new URL(url).pathname}`);
    return this.inner.open(url, init);
  }
}

/** A real witness served over HTTP; `learn` teaches a member Habery its KEL and location. */
function* witnessHost() {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const url = `http://127.0.0.1:${port}`;
  const provider = yield* open(crypto.randomUUID());
  const witness = provider.makeHab("witness", undefined, { transferable: false, icount: 1, isith: "1", toad: 0 });
  const seeding = yield* createAgentRuntime(provider, new NodeHttpClient(), systemClock, { enableMailboxStore: true });
  yield* settleRuntimeIngress(seeding, [
    witness.makeLocScheme(url, witness.pre, Schemes.http),
    witness.makeEndRole(witness.pre, EndpointRoles.controller, true),
    witness.makeEndRole(witness.pre, EndpointRoles.witness, true),
  ]);
  yield* seeding.close();
  const hostRuntime = yield* createAgentRuntime(provider, new NodeHttpClient(), systemClock, {
    enableMailboxStore: true,
  });
  const server = yield* spawn(function*() {
    yield* startServer(port, undefined, hostRuntime, {
      hostname: "127.0.0.1",
      hostedPrefixes: [witness.pre!],
      serviceHab: witness,
      witnessHab: witness,
    });
  });
  yield* waitForServer(port);
  return {
    witness,
    *learn(hby: Habery) {
      const learning = yield* createAgentRuntime(hby, new NodeHttpClient(), systemClock);
      for (const message of witness.db.clonePreIter(witness.pre, 0)) yield* settleRuntimeIngress(learning, [message]);
      yield* settleRuntimeIngress(learning, [witness.makeLocScheme(url, witness.pre, Schemes.http)]);
      yield* learning.close();
    },
    *stop() {
      yield* waitForTaskHalt(server);
      yield* hostRuntime.close();
      yield* provider.close(true);
    },
  };
}

Deno.test("two member runtimes counsel one witnessed group event: only the elected member submits, both complete", async () => {
  await run(function*() {
    const host = yield* witnessHost(), witness = host.witness;
    const [a, b] = [yield* open(crypto.randomUUID()), yield* open(crypto.randomUUID())];
    const [ma, mb] = [a.makeHab("a"), b.makeHab("b")];
    share(a, ma.pre!, b);
    share(b, mb.pre!, a);
    for (const hby of [a, b]) yield* host.learn(hby);
    const smids = [ma.pre!, mb.pre!];
    const args = { isith: "2", nsith: "2", wits: [witness.pre!], toad: 1 };
    const created = [
      a.makeGroupHab("g", ma, smids, undefined, undefined, args),
      b.makeGroupHab("g", mb, smids, undefined, undefined, args),
    ];
    accept(a, created[1]);
    accept(b, created[0]);
    const event = refOf(created[0].serder);
    try {
      const [httpA, httpB] = [new Recording(), new Recording()];
      const [ra, rb] = [
        yield* createAgentRuntime(a, httpA, systemClock),
        yield* createAgentRuntime(b, httpB, systemClock),
      ];
      ra.counselor.start(event);
      rb.counselor.start(event);
      const [first, second] = yield* working(ra, () =>
        working(rb, function*() {
          return [
            yield* waitForGroupEvent(ra.counselor, event, { timeoutMs: 20_000 }),
            yield* waitForGroupEvent(rb.counselor, event, { timeoutMs: 20_000 }),
          ];
        }));
      assertEquals([first.outcome, second.outcome], ["settled", "settled"]);
      assertEquals([first.status, second.status], [{ state: "complete" }, { state: "complete" }]);
      assertEquals(httpA.requests.filter(r => r.startsWith("POST")).length > 0, true); // elected: submits
      assertEquals(httpB.requests.filter(r => r.startsWith("POST")), []); // not elected: only fetches
      for (const hby of [a, b]) assertEquals(hby.db.wigs.get(dgKey(event.pre, event.said)).length, 1);
      yield* ra.close();
      yield* rb.close();
    } finally {
      yield* host.stop();
    }
    for (const hby of [a, b]) yield* hby.close(true);
  });
});

Deno.test("a witnessed group event started before a restart is receipted by the reopened runtime once accepted", async () => {
  const dir = await Deno.makeTempDir();
  await run(function*() {
    const host = yield* witnessHost(), witness = host.witness;
    const name = crypto.randomUUID();
    const b = yield* open(crypto.randomUUID());
    let a = yield* open(name, dir);
    const [ma, mb] = [a.makeHab("a"), b.makeHab("b")];
    share(a, ma.pre!, b);
    share(b, mb.pre!, a);
    for (const hby of [a, b]) yield* host.learn(hby);
    const smids = [ma.pre!, mb.pre!];
    const args = { isith: "2", nsith: "2", wits: [witness.pre!], toad: 1 };
    const mine = a.makeGroupHab("g", ma, smids, undefined, undefined, args);
    const theirs = b.makeGroupHab("g", mb, smids, undefined, undefined, args);
    const event = refOf(mine.serder);
    try {
      const before = yield* createAgentRuntime(a, new Recording(), systemClock);
      before.counselor.start(event); // the other member has not signed yet
      yield* before.close();
      yield* a.close();

      a = yield* open(name, dir);
      assert(a.habs.has(event.pre), "a group with an unaccepted inception is held across reopen, as in KERIpy");
      assertEquals(a.habs.get(event.pre)!.accepted, false);
      accept(a, theirs); // accepted after the restart: usable with no joinGroupHab
      assert(a.habs.get(event.pre)!.accepted);
      const http = new Recording();
      const after = yield* createAgentRuntime(a, http, systemClock);
      const outcome = yield* working(after, () => waitForGroupEvent(after.counselor, event, { timeoutMs: 20_000 }));
      assertEquals(outcome, { outcome: "settled", status: { state: "complete" } });
      assert(http.requests.some(r => r.startsWith("POST")), "the elected member submitted to the witness");
      assertEquals(a.db.wigs.get(dgKey(event.pre, event.said)).length, 1);
      yield* after.close();
    } finally {
      yield* host.stop();
    }
    yield* a.close(true);
    yield* b.close(true);
  });
  await Deno.remove(dir, { recursive: true });
});
