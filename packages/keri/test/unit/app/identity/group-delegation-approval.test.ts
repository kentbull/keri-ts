/** A group delegator approves a delegated event through the group proposal API. */
import type { SerderKERI } from "cesr-ts";
import { call, run } from "effection";
import { assert, assertEquals, assertRejects } from "jsr:@std/assert";
import {
  delegationApprovalStatus,
  type DelegationRequest,
  proposeGroupDelegationApproval,
  requestDelegatedEvent,
  waitForDelegationAnchor,
  waitForPendingDelegation,
} from "../../../../src/app/identity/delegation-approval.ts";
import type { Hab } from "../../../../src/app/identity/habbing.ts";
import { createHabery } from "../../../../src/app/identity/lmdb-habery.ts";
import { createAgentRuntime } from "../../../../src/app/runtime/agent-runtime.ts";
import { systemClock } from "../../../../src/app/runtime/runtime-clock.ts";
import { FetchHttpClient } from "../../../../src/app/transport/http-client.ts";
import type { QueryRequest } from "../../../../src/core/cues.ts";
import { ValidationError } from "../../../../src/core/errors.ts";
import { delcept } from "../../../../src/core/protocol-eventing.ts";
import { messagize } from "../../../../src/core/protocol-serialization.ts";
import { dgKey } from "../../../../src/db/core/keys.ts";
import { approvePending } from "../multisig/approve-pending.ts";
import { type Scenario, scenario } from "../multisig/proposal-fixture.ts";

/** Hold a delegated inception in the scenario's `delegables.` escrow, as the delegate's request would leave it. */
function seedDelegable(s: Scenario, template: Hab): { dip: SerderKERI; request: DelegationRequest } {
  const dip = delcept([template.kever!.verfers[0]!.qb64], s.group, {
    ndigs: [template.kever!.ndigers[0]!.qb64],
  });
  s.left.db.putEvtSerder(dip.pre!, dip.said!, dip.raw);
  s.left.db.sigs.put(dgKey(dip.pre!, dip.said!), template.sign(dip.raw, true));
  s.left.db.delegables.add([dip.pre!], dip.said!);
  return { dip, request: { delegate: dip.pre!, sn: 0, said: dip.said!, ilk: "dip", delegator: s.group } };
}

Deno.test("proposeGroupDelegationApproval proposes the sealing interaction once and requests the delegate after it", async () => {
  await run(function*() {
    const templates = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    try {
      yield* scenario(function*(s) {
        const template = templates.makeHab("template", undefined, {});
        const { dip, request } = seedDelegable(s, template);
        const deps = {
          hby: s.left,
          protocol: s.runtime.protocol,
          postman: s.runtime.postman,
          counselor: s.runtime.counselor,
        };
        assertEquals(delegationApprovalStatus(s.left, request).state, "awaiting-approval");

        const sent = yield* proposeGroupDelegationApproval(deps, request, { fallbackAfterMs: 0 });
        assert(sent);
        assertEquals(sent.route, "/multisig/ixn");
        assertEquals(sent.messages.length, 1, "the other member is told");
        const anchor = s.left.db.getEvtSerder(s.group, sent.event.said)!;
        assertEquals(anchor.seals, [{ i: dip.pre, s: "0", d: dip.said }]);
        assertEquals(s.runtime.counselor.status(sent.event).state, "pending");

        // The other member signs the same interaction; the group KEL then holds the anchor.
        const peer = s.right.interactGroupHab("group", s.mids, { data: [{ i: dip.pre, s: "0", d: dip.said }] });
        assertEquals(peer.serder.raw, anchor.raw);
        yield* s.runtime.reactor.processBytes(messagize(anchor, { sigers: [...peer.sigers] }), { local: true });
        yield* s.runtime.protocol.processEscrowsOnce();
        assertEquals(s.left.db.kels.getLast(s.group, sent.event.sn), sent.event.said);
        assertEquals(delegationApprovalStatus(s.left, request).state, "anchored");
        assertEquals(
          yield* proposeGroupDelegationApproval(deps, request),
          null,
          "an anchored request is not proposed again",
        );

        const queries: QueryRequest[] = [];
        requestDelegatedEvent(
          {
            hby: s.left,
            querying: { enqueue: (query: QueryRequest) => void queries.push(query) },
          },
          request,
          s.alice.pre,
        );
        // The delegate has no witness to ask: pinning the seal promotes its escrowed event.
        assertEquals(queries, []);
        assertEquals(delegationApprovalStatus(s.left, request).state, "approved");
      }, "2");
    } finally {
      yield* templates.close(true);
    }
  });
});

Deno.test("proposeGroupDelegationApproval refuses a delegator that is not a local group", async () => {
  await run(function*() {
    yield* scenario(function*(s) {
      const deps = {
        hby: s.left,
        protocol: s.runtime.protocol,
        postman: s.runtime.postman,
        counselor: s.runtime.counselor,
      };
      yield* call(() =>
        assertRejects(
          () =>
            run(() =>
              proposeGroupDelegationApproval(deps, {
                delegate: "Eunknown",
                sn: 0,
                said: "Eunknown",
                ilk: "dip",
                delegator: s.alice.pre,
              })
            ),
          ValidationError,
          "No delegated dip",
        )
      );
    });
  });
});

Deno.test("a group delegator confirms through the CLI's library calls while a second member approves the proposal", async () => {
  await run(function*() {
    const templates = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    try {
      yield* scenario(function*(s) {
        const template = templates.makeHab("template", undefined, {});
        const filter = { delegator: s.group };

        // Before the request arrives the wait observes only the delegator's escrow and expires with a typed outcome.
        const early = yield* waitForPendingDelegation(s.left, filter, { timeoutMs: 20 });
        assertEquals(early.outcome, "timed-out");
        assertEquals(early.status, []);

        const { dip, request } = seedDelegable(s, template);
        const arrived = yield* waitForPendingDelegation(s.left, filter, { timeoutMs: 1_000 });
        assertEquals(arrived.outcome, "settled");
        assertEquals(arrived.status.map(pending => pending.said), [dip.said]);

        // The first member proposes; the proposal wrapper is what the other member receives.
        const wrappers: Uint8Array[] = [];
        s.runtime.postman.send = evt => (wrappers.push(evt.msg), { ...evt, kin: "msg" });
        const sent = yield* proposeGroupDelegationApproval(
          {
            hby: s.left,
            protocol: s.runtime.protocol,
            postman: s.runtime.postman,
            counselor: s.runtime.counselor,
          },
          request,
          { fallbackAfterMs: 0 },
        );
        assert(sent);
        assertEquals(wrappers.length, 1);
        const pendingAnchor = yield* waitForDelegationAnchor(s.left, request, { timeoutMs: 20 });
        assertEquals(pendingAnchor.outcome, "timed-out");
        assertEquals(pendingAnchor.status.state, "awaiting-approval");

        // The second member runs its own runtime, receives the wrapper and approves it by SAID.
        const peer = yield* createAgentRuntime(s.right, new FetchHttpClient(), systemClock, {});
        try {
          peer.postman.send = evt => ({ ...evt, kin: "msg" });
          peer.postman.wait = function*(evt) {
            return { kin: "sent", evt, deliveries: ["test"] };
          };
          yield* peer.reactor.processBytes(wrappers[0]!, { local: true });
          const wrapperSaid = new TextDecoder().decode(wrappers[0]!).match(/"d":"([^"]+)"/)![1]!;
          const approved = yield* approvePending(s.right, peer, { said: wrapperSaid });
          assert(approved);
          assertEquals(approved.accepted, true);

          // The approval reaches the first member, whose group KEL then holds the anchor.
          for (const wire of s.right.db.clonePreIter(s.group, 0)) {
            yield* s.runtime.reactor.processBytes(wire, { local: true });
          }
          yield* s.runtime.protocol.processEscrowsOnce();
        } finally {
          yield* peer.close();
        }
        assertEquals(s.left.db.kels.getLast(s.group, sent.event.sn), sent.event.said);

        const anchored = yield* waitForDelegationAnchor(s.left, request, { timeoutMs: 1_000 });
        assertEquals(anchored.outcome, "settled");
        requestDelegatedEvent({ hby: s.left, querying: { enqueue: () => {} } }, request, s.alice.pre);
        assertEquals(delegationApprovalStatus(s.left, request).state, "approved");
      }, "2");
    } finally {
      yield* templates.close(true);
    }
  });
});
