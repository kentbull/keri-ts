/** A group delegator approves a delegated event through the group proposal API. */
import { call, run } from "effection";
import { assert, assertEquals, assertRejects } from "jsr:@std/assert";
import {
  delegationApprovalStatus,
  type DelegationRequest,
  proposeGroupDelegationApproval,
  requestDelegatedEvent,
} from "../../../../src/app/identity/delegation-approval.ts";
import { createHabery } from "../../../../src/app/identity/lmdb-habery.ts";
import type { QueryRequest } from "../../../../src/core/cues.ts";
import { ValidationError } from "../../../../src/core/errors.ts";
import { delcept } from "../../../../src/core/protocol-eventing.ts";
import { messagize } from "../../../../src/core/protocol-serialization.ts";
import { dgKey } from "../../../../src/db/core/keys.ts";
import { scenario } from "../multisig/proposal-fixture.ts";

Deno.test("proposeGroupDelegationApproval proposes the sealing interaction once and requests the delegate after it", async () => {
  await run(function*() {
    const templates = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    try {
      yield* scenario(function*(s) {
        const template = templates.makeHab("template", undefined, {});
        const dip = delcept([template.kever!.verfers[0]!.qb64], s.group, {
          ndigs: [template.kever!.ndigers[0]!.qb64],
        });
        s.left.db.putEvtSerder(dip.pre!, dip.said!, dip.raw);
        s.left.db.sigs.put(dgKey(dip.pre!, dip.said!), template.sign(dip.raw, true));
        s.left.db.delegables.add([dip.pre!], dip.said!);
        const request: DelegationRequest = {
          delegate: dip.pre!,
          sn: 0,
          said: dip.said!,
          ilk: "dip",
          delegator: s.group,
        };
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
