/** propose* group events, stored rotation members following acceptance and the inapplicable proposal state. */
import { call, run } from "effection";
import { assertEquals } from "jsr:@std/assert";
import { Poster } from "../../../../src/app/delivery/forwarding.ts";
import { createHabery } from "../../../../src/app/identity/lmdb-habery.ts";
import type { GroupEventRef } from "../../../../src/app/multisig/counseling.ts";
import { multisigInceptExn } from "../../../../src/app/multisig/grouping.ts";
import { signGroupMessage, storedGroupMessage } from "../../../../src/app/multisig/multisig-messaging.ts";
import { findGroupProposal } from "../../../../src/app/multisig/proposals.ts";
import {
  proposeGroupInception,
  proposeGroupInteraction,
  proposeGroupRotation,
} from "../../../../src/app/multisig/proposing.ts";
import { messagize } from "../../../../src/core/protocol-serialization.ts";
import { dgKey } from "../../../../src/db/core/keys.ts";
import { learn, readDeps, receive, type Scenario, scenario } from "./proposal-fixture.ts";

function proposeDeps(s: Scenario) {
  const started: GroupEventRef[] = [];
  const sent: Array<{ dest: string; route: string }> = [];
  // The fixture's members have no end roles; the stubbed transport reaches them, so the reachability check agrees.
  s.runtime.postman.canReach = () => true;
  s.runtime.postman.send = evt => {
    const text = new TextDecoder().decode(evt.msg);
    sent.push({ dest: evt.dest, route: text.match(/"r":"([^"]+)"/)?.[1] ?? "" });
    return { ...evt, kin: "msg" };
  };
  const deps = {
    hby: s.left,
    protocol: s.runtime.protocol,
    postman: s.runtime.postman,
    counselor: { start: (event: GroupEventRef) => (started.push(event), true) },
  };
  return { deps, started, sent };
}

Deno.test("proposeGroupInception creates, counsels and publishes a new group", async () => {
  await run(function*() {
    yield* scenario(function*(s) {
      const { deps, started, sent } = proposeDeps(s);
      const result = yield* proposeGroupInception(deps, s.alice, "second", {
        smids: s.mids,
        isith: "1",
        nsith: "1",
        toad: 0,
      });
      const hab = s.left.habs.get(result.group)!;
      assertEquals(hab.name, "second");
      assertEquals([result.event.pre, result.event.sn], [result.group, 0]);
      assertEquals(started, [result.event]);
      assertEquals(sent, [{ dest: s.bob.pre, route: "/multisig/icp" }]);
      assertEquals(result.messages.length, 1);
      assertEquals(result.rmids, s.mids);
    }, "2");
  });
});

Deno.test("proposeGroupInception refuses a member no route reaches and leaves no group behind", async () => {
  await run(function*() {
    yield* scenario(function*(s) {
      const { deps, started } = proposeDeps(s);
      s.runtime.postman.canReach = Poster.prototype.canReach.bind(s.runtime.postman);
      let refused = "";
      try {
        yield* proposeGroupInception(deps, s.alice, "unreachable", { smids: s.mids, isith: "1", nsith: "1", toad: 0 });
      } catch (error) {
        refused = (error as Error).message;
      }
      assertEquals(refused.includes("cannot be reached"), true);
      assertEquals(started, []);
      assertEquals(s.left.habByName("unreachable") ?? null, null);
    }, "2");
  });
});

Deno.test("proposeGroupInteraction counsels and publishes an interaction", async () => {
  await run(function*() {
    yield* scenario(function*(s) {
      const { deps, started, sent } = proposeDeps(s);
      const result = yield* proposeGroupInteraction(deps, s.left.habs.get(s.group)!, [{ n: 1 }]);
      assertEquals(result.event.sn, 1);
      assertEquals(started, [result.event]);
      assertEquals(sent, [{ dest: s.bob.pre, route: "/multisig/ixn" }]);
    }, "2");
  });
});

Deno.test("a proposed rotation's newcomer enters the stored members only once the rotation is accepted", async () => {
  await run(function*() {
    yield* scenario(function*(s) {
      const third = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
      try {
        const carol = third.makeHab("carol");
        yield* call(() => learn(s.left, carol));
        yield* call(() => learn(s.right, carol));
        s.alice.rotate();
        s.bob.rotate();
        yield* call(() => learn(s.left, s.bob));
        yield* call(() => learn(s.right, s.alice));
        const { deps, started, sent } = proposeDeps(s);
        const next = [...s.mids, carol.pre];
        const spec = { smids: s.mids, rmids: next, isith: "2", nsith: "3" } as const;
        const result = yield* proposeGroupRotation(deps, s.left.habs.get(s.group)!, spec);
        assertEquals(started, [result.event]);
        assertEquals(sent.map(m => m.route), ["/multisig/rot", "/multisig/rot"]);
        yield* s.runtime.counselor.processOnce();
        assertEquals(s.left.db.getHab(s.group)?.rmids, s.mids);
        const peer = s.right.rotateGroupHab("group", s.mids, next, { isith: "2", nsith: "3" });
        const own = s.left.db.getEvtSerder(s.group, result.event.said)!;
        yield* receive(s, messagize(own, { sigers: peer.sigers }));
        yield* s.runtime.protocol.processEscrowsOnce();
        assertEquals(s.left.db.getKever(s.group)?.said, result.event.said);
        // The runtime's Counselor pass follows the accepted rotation; nothing settles the proposal.
        yield* s.runtime.counselor.processOnce();
        assertEquals(s.left.db.getHab(s.group)?.rmids, next);
      } finally {
        yield* third.close(true);
      }
    }, "2");
  });
});

Deno.test("an accepted proposal that names no local signing member is inapplicable, not unapproved", async () => {
  await run(function*() {
    yield* scenario(function*(s) {
      const hab = s.left.habs.get(s.group)!;
      const icp = s.left.db.getEvtSerder(s.group, hab.kever!.lastEst.d)!;
      const wrapper = signGroupMessage(
        s.bob,
        s.alice.pre,
        yield* multisigInceptExn(
          s.bob,
          [s.bob.pre],
          s.mids,
          messagize(icp, { sigers: s.left.db.sigs.get(dgKey(icp.pre!, icp.said!)) }),
        ),
      );
      yield* receive(s, wrapper.message);
      const proposal = findGroupProposal(readDeps(s), wrapper.exnSaid);
      assertEquals(proposal?.local, "inapplicable");
      assertEquals(proposal?.needs, { groupAlias: false, registryName: false });
      assertEquals(storedGroupMessage(s.left.db, s.alice.pre, s.left.db.exns.get([wrapper.exnSaid])!), null);
    }, "2");
  });
});
