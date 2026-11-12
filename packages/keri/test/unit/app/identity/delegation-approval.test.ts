import { type Operation, run, sleep, spawn } from "effection";
import { assert, assertEquals } from "jsr:@std/assert";
import {
  approveDelegation,
  type DelegationApprovalDeps,
  delegationApprovalStatus,
  type DelegationRequest,
  dismissDelegation,
  listPendingDelegations,
  settleDelegationApproval,
  waitForDelegationApproval,
} from "../../../../src/app/identity/delegation-approval.ts";
import { createHabery } from "../../../../src/app/identity/lmdb-habery.ts";
import { createProtocolProcessor } from "../../../../src/app/protocol/protocol-processing.ts";
import { systemClock } from "../../../../src/app/runtime/runtime-clock.ts";
import { MemoryChangeSink } from "../../../../src/app/runtime/workflow-contract.ts";
import type { QueryRequest } from "../../../../src/core/cues.ts";
import { delcept } from "../../../../src/core/protocol-eventing.ts";
import { dgKey } from "../../../../src/db/core/keys.ts";

/** A delegator store plus a template store that authors delegated inceptions. */
function* delegationFixture() {
  const hby = yield* createHabery({ name: `delegator-${crypto.randomUUID()}`, temp: true, skipConfig: true });
  const templates = yield* createHabery({ name: `templates-${crypto.randomUUID()}`, temp: true, skipConfig: true });
  const delegator = hby.makeHab("delegator", undefined, {});
  const queries: QueryRequest[] = [];
  const deps: DelegationApprovalDeps = {
    hby,
    protocol: createProtocolProcessor(hby),
    http: {
      request: () => {
        throw new Error("no network expected");
      },
    } as never,
    clock: systemClock,
    querying: { enqueue: (request: QueryRequest) => void queries.push(request) },
  };
  let count = 0;
  /** Escrow one delegated inception as a delegate's request would arrive. */
  function request(delegatorPre = delegator.pre): DelegationRequest {
    const template = templates.makeHab(`template-${count++}`, undefined, {});
    const dip = delcept([template.kever!.verfers[0]!.qb64], delegatorPre, {
      ndigs: [template.kever!.ndigers[0]!.qb64],
    });
    hby.db.putEvtSerder(dip.pre!, dip.said!, dip.raw);
    hby.db.sigs.put(dgKey(dip.pre!, dip.said!), template.sign(dip.raw, true));
    hby.db.delegables.add([dip.pre!], dip.said!);
    return { delegate: dip.pre!, sn: 0, said: dip.said!, ilk: "dip", delegator: delegatorPre };
  }
  return { hby, templates, delegator, deps, queries, request };
}

type Fixture = ReturnType<typeof delegationFixture> extends Generator<unknown, infer R> ? R : never;

function withFixture(test: (f: Fixture) => Operation<void>) {
  return () =>
    run(function*() {
      const f = (yield* delegationFixture()) as Fixture;
      try {
        yield* test(f);
      } finally {
        yield* f.templates.close(true);
        yield* f.hby.close(true);
      }
    });
}

Deno.test(
  "listPendingDelegations returns every pending request, not a first page",
  withFixture(function*({ hby, request, delegator }) {
    const other = hby.makeHab("other", undefined, {});
    const requests = Array.from({ length: 130 }, () => request());
    const foreign = request(other.pre);
    const pending = listPendingDelegations(hby, { delegator: delegator.pre });
    assertEquals(pending.length, 130);
    assertEquals(new Set(pending.map((p) => p.said)), new Set(requests.map((r) => r.said)));
    assert(pending.every((p) => p.ilk === "dip" && p.delegator === delegator.pre && !p.anchored));
    assertEquals(listPendingDelegations(hby, { delegator: other.pre }).map((p) => p.said), [foreign.said]);
    assertEquals(listPendingDelegations(hby).length, 131);
  }),
);

Deno.test(
  "approveDelegation anchors once, accepts the delegate and reports approved",
  withFixture(function*({ hby, delegator, deps, request, queries }) {
    const req = request();
    const changes = new MemoryChangeSink();
    const status = yield* approveDelegation({ ...deps, changes }, req, { event: "ixn" });
    assertEquals(status.state, "approved");
    assertEquals(delegator.kever!.sn, 1);
    assertEquals(hby.db.kels.getLast(req.delegate, 0), req.said);
    assert(hby.db.aess.get(dgKey(req.delegate, req.said)));
    assertEquals(listPendingDelegations(hby).length, 0);
    assertEquals(queries.length, 0);
    assertEquals(changes.changes.at(-1), { kind: "delegation", id: `${req.delegate}:0` });
  }),
);

Deno.test(
  "approveDelegation by rotation anchors in a rotation event",
  withFixture(function*({ delegator, deps, request }) {
    const req = request();
    yield* approveDelegation(deps, req, { event: "rot" });
    const said = delegator.kever!.said;
    assertEquals(delegator.kever!.sn, 1);
    assertEquals(deps.hby.db.getEvtSerder(delegator.pre, said)!.ilk, "rot");
  }),
);

Deno.test(
  "approving twice does not anchor twice",
  withFixture(function*({ delegator, deps, request }) {
    const req = request();
    yield* approveDelegation(deps, req, { event: "ixn" });
    const again = yield* approveDelegation(deps, req, { event: "ixn" });
    assertEquals(again.state, "approved");
    assertEquals(delegator.kever!.sn, 1);
  }),
);

Deno.test(
  "approval resumes after a crash between anchoring and the follow-up steps",
  withFixture(function*({ hby, delegator, deps, request }) {
    const req = request();
    // The crash point: the anchoring event is committed, nothing after it ran.
    delegator.interact({ data: [{ i: req.delegate, s: "0", d: req.said }] });
    assertEquals(delegationApprovalStatus(hby, req).state, "anchored");
    assertEquals(listPendingDelegations(hby)[0]!.anchored, true);
    assertEquals(hby.db.kels.getLast(req.delegate, 0), undefined);

    const status = yield* approveDelegation(deps, req, { event: "rot" });
    assertEquals(status.state, "approved");
    assertEquals(delegator.kever!.sn, 1);
    assertEquals(hby.db.getEvtSerder(delegator.pre, delegator.kever!.said)!.ilk, "ixn");
  }),
);

Deno.test(
  "an unreceipted anchor still counts as anchored",
  withFixture(function*({ hby, request }) {
    const witness = hby.makeHab("witness", undefined, { transferable: false, icount: 1, isith: "1", toad: 0 });
    const witnessed = hby.makeHab("witnessed", undefined, { wits: [witness.pre], toad: 0 });
    const req = request(witnessed.pre);
    witnessed.interact({ data: [{ i: req.delegate, s: "0", d: req.said }] });
    assertEquals(
      hby.db.fetchLastSealingEventByEventSeal(witnessed.pre, { i: req.delegate, s: "0", d: req.said }),
      null,
    );
    const status = delegationApprovalStatus(hby, req);
    assertEquals(status.state, "anchored");
    assertEquals(status.state === "anchored" && status.receipted, false);
  }),
);

Deno.test(
  "status moves from unknown to awaiting-approval to approved",
  withFixture(function*({ hby, deps, request }) {
    const req = request();
    const missing = { ...req, said: "EMissing" };
    assertEquals(delegationApprovalStatus(hby, missing), { state: "unknown", reason: "no-local-event" });
    assertEquals(delegationApprovalStatus(hby, req), { state: "awaiting-approval" });
    yield* approveDelegation(deps, req, { event: "ixn" });
    assertEquals(delegationApprovalStatus(hby, req).state, "approved");
  }),
);

Deno.test(
  "approveDelegation rejects a request that is not held or not local",
  withFixture(function*({ deps, request }) {
    const req = request();
    for (
      const [bad, message] of [
        [{ ...req, said: "EMissing" }, "No delegated dip EMissing"],
        [{ ...req, delegator: "ENotLocal" }, "not a local single-signature delegator"],
      ] as const
    ) {
      let failure = "";
      try {
        yield* approveDelegation(deps, bad, { event: "ixn" });
      } catch (error) {
        failure = String(error);
      }
      assert(failure.includes(message), failure);
    }
  }),
);

Deno.test(
  "a wait that expires returns timed-out with the status, then settles once approved",
  withFixture(function*({ hby, deps, request }) {
    const req = request();
    const expired = yield* waitForDelegationApproval(hby, req, { timeoutMs: 20 });
    assertEquals(expired, { outcome: "timed-out", status: { state: "awaiting-approval" }, timeoutMs: 20 });

    // A host that already runs its runtime approves; the wait only observes. Any
    // collaborator beyond the declared interface fails the test.
    const strict = new Proxy({ db: hby.db }, {
      get(target, prop, receiver) {
        if (prop !== "db" && prop !== "settle" && prop !== "changes") {
          throw new Error(`unexpected access: ${String(prop)}`);
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    yield* spawn(function*() {
      yield* sleep(10);
      yield* approveDelegation(deps, req, { event: "ixn" });
    });
    const settled = yield* waitForDelegationApproval(strict, req, { timeoutMs: 5_000 });
    assertEquals(settled.outcome, "settled");
    assertEquals(settled.status.state, "approved");
  }),
);

Deno.test(
  "settleDelegationApproval does nothing before the anchor exists",
  withFixture(function*({ hby, deps, request }) {
    const req = request();
    settleDelegationApproval(deps, req);
    assertEquals(hby.db.aess.get(dgKey(req.delegate, req.said)), undefined);
    assertEquals(delegationApprovalStatus(hby, req).state, "awaiting-approval");
  }),
);

Deno.test("dismissDelegation removes only the matching controller notices", () => {
  const request = { delegate: "EDel", sn: 0, said: "ESaid", ilk: "dip", delegator: "EDor" } as const;
  const notes = [
    { pad: { i: "a", a: { r: "/delegate/request", delpre: "EDor", ked: { d: "ESaid" } } } },
    { pad: { i: "b", a: { r: "/delegate/request", delpre: "EDor", ked: { d: "EOther" } } } },
    { pad: { i: "c", a: { r: "/other", delpre: "EDor", ked: { d: "ESaid" } } } },
  ];
  const removed: string[] = [];
  const notifier = {
    list: (start: number, limit: number) => notes.slice(start, start + limit),
    remove: (rid: string) => (removed.push(rid), true),
  };
  assertEquals(dismissDelegation({ notifier: notifier as never }, request), 1);
  assertEquals(removed, ["a"]);
});
