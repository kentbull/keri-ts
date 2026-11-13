import type { SerderKERI } from "cesr-ts";
import { type Operation, run, sleep, spawn } from "effection";
import { assertEquals, assertRejects } from "jsr:@std/assert";
import type { DelegationWorkflowStatus } from "../../../../src/app/identity/delegating.ts";
import {
  beginDelegation,
  completeEvent,
  type DelegationCollaborator,
  delegationStatus,
  type EventCompletionDeps,
  eventStatus,
  receiptEvent,
  waitForDelegation,
} from "../../../../src/app/identity/event-completion.ts";
import type { Hab } from "../../../../src/app/identity/habbing.ts";
import { acceptedEventReplayMessage, type Habery } from "../../../../src/app/identity/habbing.ts";
import { createHabery } from "../../../../src/app/identity/lmdb-habery.ts";
import { Signaler } from "../../../../src/app/notifications/signaling.ts";
import { createProtocolProcessor } from "../../../../src/app/protocol/protocol-processing.ts";
import { Reactor } from "../../../../src/app/protocol/reactor.ts";
import { systemClock } from "../../../../src/app/runtime/runtime-clock.ts";
import { MemoryChangeSink, signalerChangeSink } from "../../../../src/app/runtime/workflow-contract.ts";
import type { HttpClient } from "../../../../src/app/transport/http-client.ts";
import { NodeHttpClient } from "../../../../src/app/transport/node-http-client.ts";
import { protocolFixture } from "../../../protocol-fixture.ts";

/** Stand-in delegating workflow: durable state is a phase map the fake runtime advances. */
function fakeDelegation(options: { anchorAfterMs?: number } = {}) {
  const phases = new Map<string, DelegationWorkflowStatus["phase"]>();
  const completed = new Set<string>();
  const calls: string[] = [];
  const key = (pre: string, sn: number | string) => `${pre}:${typeof sn === "number" ? sn.toString(16) : sn}`;
  const collaborator: DelegationCollaborator = {
    anchorer: {
      beginLatest(pre, sn, opts) {
        calls.push(`begin ${pre} ${sn} proxy=${opts?.communicationHab?.pre ?? "-"}`);
        phases.set(key(pre, sn!), "waitingDelegatorAnchor");
        return {} as SerderKERI;
      },
      workflowStatus(pre, snh) {
        return {
          phase: phases.get(key(pre, snh)) ?? null,
          proxyDependent: false,
          complete: completed.has(key(pre, snh)),
        };
      },
      complete: (pre, sn) => completed.has(key(pre, sn)),
    },
  };
  // The host's own runtime: advances the workflow while a library wait only observes.
  function* hostAdvances(pre: string) {
    yield* sleep(options.anchorAfterMs ?? 0);
    completed.add(key(pre, 0));
    phases.delete(key(pre, 0));
  }
  return { collaborator, calls, hostAdvances };
}

const delegatedHab = { pre: "EDelegate" } as Hab;
const proxyHab = { pre: "EProxy" } as Hab;

Deno.test("beginDelegation returns at once and the status is read from the workflow", () => {
  const { collaborator, calls } = fakeDelegation();
  assertEquals(delegationStatus(collaborator, delegatedHab.pre, 0).phase, null);
  beginDelegation(collaborator, delegatedHab.pre, 0, proxyHab);
  assertEquals(calls, ["begin EDelegate 0 proxy=EProxy"]);
  assertEquals(delegationStatus(collaborator, delegatedHab.pre, 0), {
    phase: "waitingDelegatorAnchor",
    proxyDependent: false,
    complete: false,
  });
});

Deno.test("waitForDelegation only observes: it completes when the host advances the workflow", async () => {
  const { collaborator, hostAdvances } = fakeDelegation({ anchorAfterMs: 5 });
  // Any collaborator member beyond the declared interface (such as a worker runner) fails the test.
  const strict = new Proxy(collaborator, {
    get(target, prop, receiver) {
      if (prop !== "anchorer" && prop !== "changes") throw new Error(`unexpected collaborator access: ${String(prop)}`);
      return Reflect.get(target, prop, receiver);
    },
  });
  const sink = new MemoryChangeSink();
  const observed = { ...strict, changes: sink } as DelegationCollaborator;
  beginDelegation(observed, delegatedHab.pre, 0);
  const result = await run(function*() {
    yield* spawn(() => hostAdvances(delegatedHab.pre));
    return yield* waitForDelegation(observed, delegatedHab, 0);
  });
  assertEquals(result, {
    outcome: "settled",
    status: { phase: null, proxyDependent: false, complete: true },
  });
  assertEquals(sink.changes, [
    { kind: "delegation", id: "EDelegate:0" },
    { kind: "delegation", id: "EDelegate:0" },
  ]);
});

Deno.test("waitForDelegation returns a timed-out value instead of throwing", async () => {
  const { collaborator } = fakeDelegation();
  beginDelegation(collaborator, delegatedHab.pre, 0);
  const result = await run(() => waitForDelegation(collaborator, delegatedHab, 0, { timeoutMs: 30 }));
  assertEquals(result, {
    outcome: "timed-out",
    status: { phase: "waitingDelegatorAnchor", proxyDependent: false, complete: false },
    timeoutMs: 30,
  });
});

const unknownEvent = { state: "unknown", reason: "no-accepted-event" } as const;

Deno.test("completeEvent opens the delegation scope only for delegated events, after resolving the proxy", async () => {
  const { collaborator, calls, hostAdvances } = fakeDelegation({ anchorAfterMs: 5 });
  let scopes = 0;
  const deps = {
    hby: { habs: new Map(), db: { kels: { getLast: () => undefined } } },
    *withDelegation<T>(_hab: Hab, use: (delegation: DelegationCollaborator) => Operation<T>) {
      scopes++;
      calls.push("scope");
      yield* spawn(() => hostAdvances(delegatedHab.pre));
      return yield* use(collaborator);
    },
  } as unknown as EventCompletionDeps;

  assertEquals(await run(() => completeEvent(deps, delegatedHab, 0)), {
    outcome: "settled",
    status: unknownEvent,
    delegationPhase: null,
  });
  assertEquals(scopes, 0);

  const result = await run(() =>
    completeEvent(deps, delegatedHab, 0, {
      delegation: {
        communicationHab: () => {
          calls.push("resolve");
          return proxyHab;
        },
      },
    })
  );
  assertEquals(result, { outcome: "settled", status: unknownEvent, delegationPhase: null });
  assertEquals(calls, ["resolve", "scope", "begin EDelegate 0 proxy=EProxy"]);

  const stalled = fakeDelegation();
  const stalledDeps = {
    hby: { habs: new Map(), db: { kels: { getLast: () => undefined } } },
    withDelegation: <T>(_hab: Hab, use: (delegation: DelegationCollaborator) => Operation<T>) =>
      use(stalled.collaborator),
  } as unknown as EventCompletionDeps;
  assertEquals(
    await run(() => completeEvent(stalledDeps, delegatedHab, 0, { delegation: { timeoutMs: 20 } })),
    {
      outcome: "timed-out",
      status: { state: "active", phase: "waitingDelegatorAnchor" },
      timeoutMs: 20,
      delegationPhase: "waitingDelegatorAnchor",
    },
  );

  await assertRejects(
    () =>
      run(() =>
        completeEvent(deps, delegatedHab, 0, {
          delegation: {
            communicationHab: () => {
              throw new Error("needs proxy");
            },
          },
        })
      ),
    Error,
    "needs proxy",
  );
  assertEquals(scopes, 1, "a rejected proxy never opens the delegation scope");
});

function receiptDeps(hby: Habery, http: HttpClient = new NodeHttpClient()) {
  return { hby, protocol: createProtocolProcessor(hby), http, clock: systemClock };
}

Deno.test("receiptEvent is a no-op without witnesses", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    try {
      const hab = hby.makeHab("plain", undefined, {});
      const failing: HttpClient = {
        request: () => {
          throw new Error("no request expected");
        },
        open: () => {
          throw new Error("no request expected");
        },
      };
      yield* receiptEvent(receiptDeps(hby, failing), hab.pre, { sn: 0 });
      yield* receiptEvent(receiptDeps(hby, failing), hab.pre, { sn: 0, endpoint: true });
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("receiptEvent selects explicit-endpoint, cached-submit and forced-submit receipting", async () => {
  const requests: string[] = [];
  let reply: Uint8Array = new Uint8Array();
  const server = Deno.serve({ port: 0, hostname: "127.0.0.1", onListen() {} }, async (request) => {
    requests.push(new URL(request.url).pathname);
    await request.arrayBuffer();
    return new Response(new Uint8Array(reply).buffer);
  });
  try {
    await run(function*() {
      const source = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
      const provider = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
      try {
        const witness = provider.makeHab("witness", undefined, { transferable: false });
        const controller = source.makeHab("controller", undefined, { wits: [witness.pre], toad: 1 });
        source.db.locs.pin([witness.pre, "http"], { url: `http://127.0.0.1:${server.addr.port}` });
        reply = witness.receipt(acceptedEventReplayMessage(source, controller.pre, 0).serder);
        const deps = receiptDeps(source);

        yield* receiptEvent(deps, controller.pre, { sn: 0, endpoint: true });
        assertEquals(requests, ["/receipts"], "endpoint mode contacts the witness");

        yield* receiptEvent(deps, controller.pre, { sn: 0 });
        assertEquals(requests, ["/receipts"], "submit mode accepts complete cached receipts");

        yield* receiptEvent(deps, controller.pre, { sn: 0, force: true });
        assertEquals(requests, ["/receipts", "/receipts"], "force resubmits despite complete receipts");

        yield* receiptEvent(deps, controller.pre, { sn: 0, endpoint: true });
        assertEquals(requests.length, 3, "endpoint mode ignores cached receipts");
      } finally {
        yield* source.close(true);
        yield* provider.close(true);
      }
    });
  } finally {
    await server.shutdown();
  }
});

Deno.test("eventStatus judges receipts against the witness set of that event, not the current one", async () => {
  await run(function*() {
    const source = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const provider = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    try {
      const plain = source.makeHab("plain", undefined, {});
      assertEquals(eventStatus(source, plain.pre, 0), { state: "complete" });
      assertEquals(eventStatus(source, plain.pre, 5), { state: "unknown", reason: "no-accepted-event" });

      const before = provider.makeHab("before", undefined, { transferable: false });
      const after = provider.makeHab("after", undefined, { transferable: false });
      const controller = source.makeHab("controller", undefined, { wits: [before.pre], toad: 1 });
      controller.interact();
      const witnessed = controller.kever!.serder;
      controller.rotate({ cuts: [before.pre], toad: 0 });
      controller.interact();
      controller.rotate({ adds: [after.pre], toad: 1 });

      assertEquals(eventStatus(source, controller.pre, 1), {
        state: "active",
        phase: "waitingWitnessReceipts",
        blocked: { missing: "witnessReceipts", have: 0, of: 1 },
      });
      yield* new Reactor(protocolFixture(source)).processBytes(before.receipt(witnessed));
      assertEquals(eventStatus(source, controller.pre, 1), { state: "complete" });
      // sn 3 follows a rotation that cut every witness: its cohort is empty, not the current one.
      assertEquals(eventStatus(source, controller.pre, 3), { state: "complete" });

      const workflow = {
        workflowStatus: () => ({ phase: "waitingDelegatorAnchor" as const, proxyDependent: false, complete: false }),
        complete: () => false,
      };
      assertEquals(eventStatus({ db: source.db, anchorer: workflow }, controller.pre, 1), {
        state: "active",
        phase: "waitingDelegatorAnchor",
      });
    } finally {
      yield* source.close(true);
      yield* provider.close(true);
    }
  });
});

Deno.test("signalerChangeSink publishes through a real Signaler and never throws into a workflow", () => {
  const signaler = new Signaler();
  const sink = signalerChangeSink(signaler);
  sink.push({ kind: "oobi", id: "u1" });
  sink.push({ kind: "oobi", id: "u1" });
  sink.push({ kind: "query", id: "EPre" });
  assertEquals(
    signaler.list().map((signal) => [signal.topic, signal.attrs, signal.ckey]),
    [["/workflow/oobi", { id: "u1" }, "oobi:u1"], ["/workflow/query", { id: "EPre" }, "query:EPre"]],
    "repeats of one workflow collapse to one signal",
  );
  signaler.close();
  sink.push({ kind: "oobi", id: "u2" });
  assertEquals(signaler.count(), 0);
});

Deno.test("completeEvent announces a completed rotation, and only a rotation, to the host's publisher", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    try {
      const hab = hby.makeHab("wallet", undefined, { transferable: true, toad: 0 });
      const cues: unknown[] = [];
      const deps = {
        hby,
        protocol: {},
        http: {},
        clock: systemClock,
        rotated: { push: (cue: unknown) => cues.push(cue) },
        withDelegation() {
          throw new Error("not delegated");
        },
      } as unknown as EventCompletionDeps;
      yield* completeEvent(deps, hab, 0);
      hab.interact();
      yield* completeEvent(deps, hab, hab.kever!.sn);
      assertEquals(cues, [], "an inception and an interaction announce nothing");
      hab.rotate({});
      const sn = hab.kever!.sn;
      yield* completeEvent(deps, hab, sn);
      assertEquals(cues, [{ kin: "rotated", pre: hab.pre, sn, said: hab.kever!.serder.said }]);
    } finally {
      yield* hby.close(true);
    }
  });
});
