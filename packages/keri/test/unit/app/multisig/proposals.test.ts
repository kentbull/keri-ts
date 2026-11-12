/** Group proposal reads: listing, lookup by SAID and local dismissal over real stored wrappers. */
import { concatBytes, parseBytes, Vrsn_2_0 } from "cesr-ts";
import { call, type Operation, run } from "effection";
import { assertEquals, assertExists } from "jsr:@std/assert";
import { groupEndorseReply } from "../../../../src/app/identity/endpoint-roleing.ts";
import type { Hab, Habery } from "../../../../src/app/identity/habbing.ts";
import { createHabery } from "../../../../src/app/identity/lmdb-habery.ts";
import {
  multisigInceptExn,
  multisigInteractExn,
  multisigRotateExn,
  multisigRpyExn,
} from "../../../../src/app/multisig/grouping.ts";
import { signGroupMessage } from "../../../../src/app/multisig/multisig-messaging.ts";
import { approvePendingMultisigProposal, publishProposal } from "../../../../src/app/multisig/multisig-workflows.ts";
import {
  dismissGroupProposal,
  findGroupProposal,
  type GroupProposalKind,
  listGroupProposals,
} from "../../../../src/app/multisig/proposals.ts";
import { Notifier, openNoterForHabery } from "../../../../src/app/notifications/notifying.ts";
import { dispatchEnvelope, envelopeFromFrame } from "../../../../src/app/protocol/parsering.ts";
import { type AgentRuntime, createAgentRuntime } from "../../../../src/app/runtime/agent-runtime.ts";
import { systemClock } from "../../../../src/app/runtime/runtime-clock.ts";
import { FetchHttpClient } from "../../../../src/app/transport/http-client.ts";
import { exchange } from "../../../../src/core/exchange/protocol-exchanging.ts";
import { reply as replyEvent } from "../../../../src/core/protocol-eventing.ts";
import { messagize } from "../../../../src/core/protocol-serialization.ts";
import {
  incept as inceptRegistry,
  issue as issueCredential,
  revoke as revokeCredentialEvent,
} from "../../../../src/core/protocol-vdr-eventing.ts";

/** Admit complete public KEL evidence without sharing private member stores. */
async function learn(target: Habery, member: Hab): Promise<void> {
  for (const wire of member.db.clonePreIter(member.pre, 0)) {
    for (const frame of await parseBytes(wire)) {
      await run(() => dispatchEnvelope(envelopeFromFrame(frame, true), target.rvy, target.kevery));
    }
  }
}

const GROUP = { isith: "1", nsith: "1", toad: 0 } as const;

/** Two members, each with a store; `left` is the local member and has joined and accepted "group". */
function* scenario(body: (s: Scenario) => Operation<void>): Operation<void> {
  const left = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
  const right = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
  const noter = yield* openNoterForHabery(left);
  let runtime: AgentRuntime | undefined;
  try {
    const alice = left.makeHab("alice");
    const bob = right.makeHab("bob");
    yield* call(() => learn(left, bob));
    yield* call(() => learn(right, alice));
    const notifier = new Notifier(left.signator!, { noter });
    const mids = [alice.pre, bob.pre];
    const local = left.makeGroupHab("group", alice, mids, mids, undefined, GROUP);
    const remote = right.makeGroupHab("group", bob, mids, mids, undefined, GROUP);
    runtime = yield* createAgentRuntime(left, new FetchHttpClient(), systemClock, { notifier });
    runtime.postman.send = evt => ({ ...evt, kin: "msg" });
    runtime.postman.wait = function*(evt) {
      return { kin: "sent", evt, deliveries: ["test"] };
    };
    const icp = messagize(local.serder, { sigers: [...local.sigers, ...remote.sigers] });
    for (const target of [runtime, right]) {
      if (target === runtime) yield* runtime.reactor.processBytes(icp, { local: true });
      else yield* dispatchEnvelope(envelopeFromFrame(parseBytes(icp)[0], true), right.rvy, right.kevery);
    }
    yield* body({ left, right, alice, bob, mids, group: local.hab.pre, notifier, runtime });
  } finally {
    if (runtime) yield* runtime.close();
    yield* noter.close(true);
    yield* right.close(true);
    yield* left.close(true);
  }
}

interface Scenario {
  left: Habery;
  right: Habery;
  alice: Hab;
  bob: Hab;
  mids: string[];
  group: string;
  notifier: Notifier;
  runtime: AgentRuntime;
}

function readDeps({ left, runtime, notifier }: Scenario) {
  return { hby: left, exc: runtime.exc, notifier, registryStore: runtime.acdc?.store ?? null };
}

/** Deliver bob's wrapper to the local runtime as a peer would. */
function* receive(s: Scenario, wrapper: Uint8Array): Operation<void> {
  yield* s.runtime.reactor.processBytes(wrapper, { local: true });
}

/** A peer ixn proposal for "group"; returns its wrapper SAID and event. */
function* peerInteraction(s: Scenario, data: unknown[]) {
  const ixn = s.right.interactGroupHab("group", s.mids, { data });
  const prepared = yield* multisigInteractExn(
    s.group,
    s.bob,
    s.mids,
    messagize(ixn.serder, { sigers: ixn.sigers }),
  );
  const signed = signGroupMessage(s.bob, s.alice.pre, prepared);
  yield* receive(s, signed.message);
  return { signed, ixn };
}

Deno.test("listGroupProposals reads every proposal kind the multisig routes carry", async () => {
  await run(function*() {
    yield* scenario(function*(s) {
      const { right, bob, alice, mids, group } = s;
      const found = new Map<GroupProposalKind, { embedded: string; event?: unknown; said: string }>();

      // icp for a group this member has not joined
      const other = right.makeGroupHab("other", bob, mids, mids, undefined, GROUP);
      const incept = signGroupMessage(bob, alice.pre, yield* multisigInceptExn(bob, mids, mids, other.message));
      yield* receive(s, incept.message);
      found.set("icp", {
        embedded: other.serder.said!,
        said: incept.exnSaid,
        event: { pre: other.hab.pre, sn: 0, said: other.serder.said },
      });

      // vcp, iss and rev around three anchors of the joined group
      const registry = inceptRegistry(group, { cnfg: ["NB"] });
      const issuance = issueCredential(registry.said!, registry.pre!);
      const revocation = revokeCredentialEvent(registry.said!, registry.pre!, issuance.said!);
      const sent = (route: string, attrs: Record<string, string>, label: string, tel: Uint8Array, tel_said: string) => {
        const seal = { i: registry.pre!, s: "0", d: tel_said };
        const anchor = right.interactGroupHab("group", mids, { data: [seal] });
        const [wrapper, paths] = exchange(route, { gid: group, ...attrs }, {
          sender: bob.pre,
          embeds: { [label]: tel, anc: messagize(anchor.serder, { sigers: anchor.sigers }) },
        });
        return { wire: concatBytes(bob.endorse(wrapper, { pipelined: false }), paths), anchor, said: wrapper.said! };
      };
      for (
        const [kind, route, attrs, tel] of [
          ["vcp", "/multisig/vcp", { usage: "test" }, registry],
          ["iss", "/multisig/iss", {}, issuance],
          ["rev", "/multisig/rev", { said: registry.said! }, revocation],
        ] as const
      ) {
        const made = sent(route, attrs, kind, tel.raw, tel.said!);
        yield* receive(s, made.wire);
        found.set(kind, {
          embedded: tel.said!,
          said: made.said,
          event: { pre: group, sn: made.anchor.serder.sn, said: made.anchor.serder.said },
        });
      }

      // ixn
      const { signed, ixn } = yield* peerInteraction(s, []);
      found.set("ixn", {
        embedded: ixn.serder.said!,
        said: signed.exnSaid,
        event: { pre: group, sn: ixn.serder.sn, said: ixn.serder.said },
      });

      // rpy
      yield* call(() => learn(right, s.left.habs.get(group)!));
      const rpy = replyEvent("/end/role/add", { cid: group, role: "mailbox", eid: bob.pre }, {
        pre: group,
        pvrsn: Vrsn_2_0,
      });
      const peerRpy = groupEndorseReply(right, right.habs.get(group)!.pre, rpy, Vrsn_2_0);
      const reply = signGroupMessage(bob, alice.pre, yield* multisigRpyExn(group, bob, peerRpy));
      yield* receive(s, reply.message);
      found.set("rpy", { embedded: rpy.said!, said: reply.exnSaid });

      // rot, after both members rotate their own keys
      alice.rotate();
      bob.rotate();
      yield* call(() => learn(s.left, bob));
      yield* call(() => learn(right, alice));
      const rot = right.rotateGroupHab("group", mids, mids, GROUP);
      const rotation = signGroupMessage(
        bob,
        alice.pre,
        yield* multisigRotateExn(group, bob, mids, mids, messagize(rot.serder, { sigers: rot.sigers })),
      );
      yield* receive(s, rotation.message);
      found.set("rot", {
        embedded: rot.serder.said!,
        said: rotation.exnSaid,
        event: { pre: group, sn: rot.serder.sn, said: rot.serder.said },
      });

      const listed = listGroupProposals(readDeps(s));
      assertEquals(listed.map(p => p.kind).sort(), [...found.keys()].sort());
      for (const proposal of listed) {
        const expected = found.get(proposal.kind)!;
        assertEquals(proposal.said, expected.said, proposal.kind);
        assertEquals(proposal.embedded, expected.embedded, proposal.kind);
        assertEquals(proposal.event, expected.event, proposal.kind);
        assertEquals(proposal.proposer, bob.pre);
        assertEquals(proposal.group, proposal.kind === "icp" ? other.hab.pre : group);
        assertEquals(proposal.local, "unapproved");
        assertEquals(proposal.needs, { groupAlias: proposal.kind === "icp", registryName: proposal.kind === "vcp" });
        assertEquals(findGroupProposal(readDeps(s), proposal.said), proposal);
      }
      assertEquals(listed.find(p => p.kind === "rot")?.rmids, mids);
      assertEquals(listGroupProposals(readDeps(s), { group: "group" }).length, listed.length - 1);
      assertEquals(listGroupProposals({ ...readDeps(s), notifier: null }), []);
    });
  });
});

Deno.test("listGroupProposals pages past the 100-notice cap", async () => {
  await run(function*() {
    yield* scenario(function*(s) {
      for (let i = 0; i < 100; i++) s.notifier.add({ r: "/notice/other", d: `padding-${i}` });
      const { signed } = yield* peerInteraction(s, []);
      assertEquals(s.notifier.count(), 101);
      assertEquals(s.notifier.list(0, 100).some(n => n.pad.a["d"] === signed.exnSaid), false);
      assertEquals(listGroupProposals(readDeps(s)).map(p => p.said), [signed.exnSaid]);
    });
  });
});

Deno.test("a proposal flips to approved once the local member's contribution is stored", async () => {
  await run(function*() {
    yield* scenario(function*(s) {
      const { signed, ixn } = yield* peerInteraction(s, []);
      assertEquals(listGroupProposals(readDeps(s))[0].local, "unapproved");
      // Publication records the local wrapper before delivery and leaves the notice alone.
      yield* publishProposal(
        s.left,
        s.runtime.protocol,
        s.runtime.postman,
        s.alice,
        s.mids,
        { route: "/multisig/ixn", attrs: { gid: s.group, smids: s.mids } },
        messagize(ixn.serder, { sigers: ixn.sigers }),
      );
      const [proposal] = listGroupProposals(readDeps(s));
      assertEquals(proposal.said, signed.exnSaid);
      assertEquals(proposal.local, "approved");
      assertEquals(proposal.needs, { groupAlias: false, registryName: false });
    });
  });
});

Deno.test("a dismissed proposal leaves the list but is still found, and approved, by SAID", async () => {
  await run(function*() {
    yield* scenario(function*(s) {
      const { signed } = yield* peerInteraction(s, []);
      const deps = readDeps(s);
      assertEquals(dismissGroupProposal({ hby: s.left, notifier: s.notifier }, signed.exnSaid), 1);
      assertEquals(s.notifier.count(), 0);
      assertEquals(listGroupProposals(deps), []);
      assertEquals(findGroupProposal(deps, signed.exnSaid)?.local, "unapproved");
      assertEquals(dismissGroupProposal({ hby: s.left, notifier: s.notifier }, signed.exnSaid), 0);
      const approved = yield* approvePendingMultisigProposal(s.left, s.runtime, {
        said: signed.exnSaid,
        callbacks: {
          approveProposal: () => true,
          chooseGroupAlias: () => "unused",
          chooseRegistryName: () => "unused",
        },
      });
      assertExists(approved);
      assertEquals(approved.said, signed.exnSaid);
      assertEquals(findGroupProposal(deps, signed.exnSaid)?.local, "approved");
    });
  });
});
