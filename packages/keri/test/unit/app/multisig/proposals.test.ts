/** Group proposal reads: listing, lookup by SAID and local dismissal over real stored wrappers. */
import { concatBytes, Diger, makeBlindState, parseBytes, Prefixer, Vrsn_1_0, Vrsn_2_0 } from "cesr-ts";
import { call, run } from "effection";
import { assertEquals, assertExists } from "jsr:@std/assert";
import {
  acdcmap as acdcV2Map,
  blindate as acdcV2Blindate,
  regcept as acdcV2Regcept,
} from "../../../../src/acdc/messaging.ts";
import { groupEndorseReply } from "../../../../src/app/identity/endpoint-roleing.ts";
import { createHabery } from "../../../../src/app/identity/lmdb-habery.ts";
import {
  multisigInceptExn,
  multisigInteractExn,
  multisigRotateExn,
  multisigRpyExn,
} from "../../../../src/app/multisig/grouping.ts";
import { signGroupMessage } from "../../../../src/app/multisig/multisig-messaging.ts";
import {
  approveAcdcV2Registry,
  publishProposal,
} from "../../../../src/app/multisig/multisig-workflows.ts";
import {
  dismissGroupProposal,
  findGroupProposal,
  type GroupProposalKind,
  listGroupProposals,
} from "../../../../src/app/multisig/proposals.ts";
import { Notifier, openNoterForHabery } from "../../../../src/app/notifications/notifying.ts";
import { createAgentRuntime } from "../../../../src/app/runtime/agent-runtime.ts";
import { systemClock } from "../../../../src/app/runtime/runtime-clock.ts";
import { FetchHttpClient } from "../../../../src/app/transport/http-client.ts";
import { TransIdxSigGroup } from "../../../../src/core/dispatch.ts";
import { exchange } from "../../../../src/core/exchange/protocol-exchanging.ts";
import { interact as interactEvent, reply as replyEvent } from "../../../../src/core/protocol-eventing.ts";
import { messageAttachmentGroups, messagize } from "../../../../src/core/protocol-serialization.ts";
import {
  incept as inceptRegistry,
  issue as issueCredential,
  revoke as revokeCredentialEvent,
} from "../../../../src/core/protocol-vdr-eventing.ts";
import { approvePending } from "./approve-pending.ts";
import { GROUP, learn, peerInteraction, readDeps, receive, scenario } from "./proposal-fixture.ts";

Deno.test("listGroupProposals reads every proposal kind the multisig routes carry", async () => {
  await run(function*() {
    yield* scenario(function*(s) {
      const { right, bob, alice, mids, group } = s;
      const found = new Map<GroupProposalKind, { embedded: string; event?: unknown; said: string }>();

      // icp for a group this member has not joined
      const other = right.makeGroupHab("other", bob, mids, mids, undefined, { isith: "1", nsith: "1", toad: 0 });
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
      const rot = right.rotateGroupHab("group", mids, mids, { isith: "2", nsith: "2", toad: 0 });
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
        assertEquals(proposal.local, "unapproved", proposal.kind);
        assertEquals(proposal.needs, { groupAlias: proposal.kind === "icp", registryName: proposal.kind === "vcp" });
        assertEquals(findGroupProposal(readDeps(s), proposal.said), proposal);
      }
      assertEquals(listed.find(p => p.kind === "rot")?.rmids, mids);
      assertEquals(listGroupProposals(readDeps(s), { group: "group" }).length, listed.length - 1);
      assertEquals(listGroupProposals({ ...readDeps(s), notifier: null }), []);
    }, "2");
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
    }, "2");
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
    }, "2");
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
      const approved = yield* approvePending(s.left, s.runtime, { said: signed.exnSaid });
      assertExists(approved);
      assertEquals(approved.said, signed.exnSaid);
      assertEquals(findGroupProposal(deps, signed.exnSaid)?.local, "approved");
    }, "2");
  });
});

Deno.test("v2 registry proposals list as rip and bup with their anchors", async () => {
  await run(function*() {
    const left = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const right = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const noter = yield* openNoterForHabery(left);
    try {
      const alice = left.makeHab("alice");
      const bob = right.makeHab("bob");
      yield* call(() => learn(left, bob));
      yield* call(() => learn(right, alice));
      const members = [alice.pre, bob.pre];
      const local = left.makeGroupHab("acdc-v2-group", alice, members, members, undefined, { isith: "2", nsith: "2" });
      const remote = right.makeGroupHab("acdc-v2-group", bob, members, members, undefined, {
        isith: "2",
        nsith: "2",
      });
      const notifier = new Notifier(left.signator!, { noter });
      const receiver = yield* createAgentRuntime(left, new FetchHttpClient(), systemClock, { notifier });
      const sender = yield* createAgentRuntime(right, new FetchHttpClient(), systemClock);
      try {
        for (const runtime of [receiver, sender]) {
          yield* runtime.reactor.processBytes(
            messagize(local.serder, { sigers: [...local.sigers, ...remote.sigers] }),
            { local: true },
          );
        }
        const rip = acdcV2Regcept(local.hab.pre);
        const anchor = interactEvent(
          local.hab.pre,
          local.hab.kever!.said,
          1,
          [{ i: rip.said!, s: "0", d: rip.said! }],
          { version: Vrsn_2_0 },
        );
        const source = messageAttachmentGroups({
          sourceSeals: [{
            i: new Prefixer({ qb64: local.hab.pre }),
            s: anchor.sner!,
            d: new Diger({ qb64: anchor.said! }),
          }],
        }, Vrsn_2_0);
        const telFrame = parseBytes(messagize(rip, concatBytes(...source.map(group => group.raw)), {
          gvrsn: Vrsn_2_0,
        }))[0];
        const kelFrame =
          parseBytes(messagize(anchor, { sigers: remote.hab.sign(anchor.raw, true), gvrsn: Vrsn_1_0 }))[0];
        const wrapper = exchange("/multisig/rip", { gid: local.hab.pre, tel: rip.said!, anc: anchor.said! }, {
          sender: bob.pre,
          version: Vrsn_2_0,
        })[0];
        const establishment = bob.db.getEvtSerder(bob.pre, bob.kever!.lastEst.d)!;
        const tsgs = [
          new TransIdxSigGroup(
            new Prefixer({ qb64: bob.pre }),
            establishment.sner!,
            new Diger({ qb64: establishment.said! }),
            bob.sign(wrapper.raw, true),
          ),
        ];
        assertEquals(
          (yield* receiver.exc.processEvent({ serder: wrapper, nests: [telFrame, kelFrame], tsgs })).kind,
          "accept",
        );
        const deps = {
          hby: left,
          exc: receiver.exc,
          notifier,
          registryStore: receiver.acdc!.store,
        };
        const [listed] = listGroupProposals(deps);
        assertEquals(
          { kind: listed.kind, embedded: listed.embedded, local: listed.local, proposer: listed.proposer },
          { kind: "rip", embedded: rip.said, local: "unapproved", proposer: bob.pre },
        );
        assertEquals(listed.event, { pre: local.hab.pre, sn: 1, said: anchor.said });
        assertEquals(listed.needs, { groupAlias: false, registryName: false });

        // The local approval stores this member's contribution; the peer then proposes a blinded update.
        const [approval, approvalFoot] = yield* approveAcdcV2Registry(left, receiver.protocol, local.hab, rip, {
          anchor,
        });
        yield* sender.reactor.processBytes(concatBytes(approval.raw, approvalFoot));
        const [peer, peerFoot] = yield* approveAcdcV2Registry(right, sender.protocol, remote.hab, rip, { anchor });
        yield* receiver.reactor.processBytes(concatBytes(peer.raw, peerFoot));
        assertEquals(findGroupProposal(deps, wrapper.said!)?.local, "approved");
        const credential = acdcV2Map(local.hab.pre, {
          regid: rip.said!,
          attribute: { d: "", i: alice.pre, role: "group holder" },
        });
        const opening = makeBlindState({ acdc: credential.said!, state: "issued", sn: 1n });
        const update = acdcV2Blindate(rip.said!, rip.said!, opening.d.nonce, { sn: 1 });
        const [bup, bupFoot] = yield* approveAcdcV2Registry(right, sender.protocol, remote.hab, update, { opening });
        yield* receiver.reactor.processBytes(concatBytes(bup.raw, bupFoot));
        const bups = listGroupProposals(deps).filter(p => p.kind === "bup");
        assertEquals(bups.length, 1);
        assertEquals(bups[0].said, bup.said);
        assertEquals(bups[0].embedded, update.said);
        assertEquals(bups[0].local, "unapproved");
      } finally {
        yield* sender.close();
        yield* receiver.close();
      }
    } finally {
      yield* noter.close(true);
      yield* right.close(true);
      yield* left.close(true);
    }
  });
});

Deno.test("a member that only receives takes a v2 registry anchor the proposer's signature completes, with the registry inception", async () => {
  await run(function*() {
    const left = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const right = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const noter = yield* openNoterForHabery(left);
    try {
      const alice = left.makeHab("alice");
      const bob = right.makeHab("bob");
      yield* call(() => learn(left, bob));
      yield* call(() => learn(right, alice));
      const members = [alice.pre, bob.pre];
      const local = left.makeGroupHab("acdc-v2-group", alice, members, members, undefined, { isith: "1", nsith: "1" });
      const remote = right.makeGroupHab("acdc-v2-group", bob, members, members, undefined, {
        isith: "1",
        nsith: "1",
      });
      const notifier = new Notifier(left.signator!, { noter });
      const receiver = yield* createAgentRuntime(left, new FetchHttpClient(), systemClock, { notifier });
      const sender = yield* createAgentRuntime(right, new FetchHttpClient(), systemClock);
      try {
        for (const runtime of [receiver, sender]) {
          yield* runtime.reactor.processBytes(
            messagize(local.serder, { sigers: [...local.sigers, ...remote.sigers] }),
            { local: true },
          );
        }
        const rip = acdcV2Regcept(local.hab.pre);
        const anchor = interactEvent(
          local.hab.pre,
          local.hab.kever!.said,
          1,
          [{ i: rip.said!, s: "0", d: rip.said! }],
          { version: Vrsn_2_0 },
        );
        const source = messageAttachmentGroups({
          sourceSeals: [{
            i: new Prefixer({ qb64: local.hab.pre }),
            s: anchor.sner!,
            d: new Diger({ qb64: anchor.said! }),
          }],
        }, Vrsn_2_0);
        const telFrame = parseBytes(messagize(rip, concatBytes(...source.map(group => group.raw)), {
          gvrsn: Vrsn_2_0,
        }))[0];
        const kelFrame =
          parseBytes(messagize(anchor, { sigers: remote.hab.sign(anchor.raw, true), gvrsn: Vrsn_1_0 }))[0];
        const wrapper = exchange("/multisig/rip", { gid: local.hab.pre, tel: rip.said!, anc: anchor.said! }, {
          sender: bob.pre,
          version: Vrsn_2_0,
        })[0];
        const establishment = bob.db.getEvtSerder(bob.pre, bob.kever!.lastEst.d)!;
        const tsgs = [
          new TransIdxSigGroup(
            new Prefixer({ qb64: bob.pre }),
            establishment.sner!,
            new Diger({ qb64: establishment.said! }),
            bob.sign(wrapper.raw, true),
          ),
        ];
        assertEquals(
          (yield* receiver.exc.processEvent({ serder: wrapper, nests: [telFrame, kelFrame], tsgs })).kind,
          "accept",
        );
        assertEquals(left.db.kels.getLast(local.hab.pre, 1), anchor.said, "the anchor is accepted on receipt");
        yield* receiver.protocol.processEscrowsOnce();
        assertEquals(receiver.acdc!.store.seqEvent(rip.said!, 0)?.said, rip.said, "so is the registry inception");
        assertEquals(
          listGroupProposals({ hby: left, exc: receiver.exc, notifier, registryStore: receiver.acdc!.store })
            .map((proposal) => [proposal.kind, proposal.local]),
          [],
          "nothing is left to approve, and it raised no notice",
        );
      } finally {
        yield* sender.close();
        yield* receiver.close();
      }
    } finally {
      yield* noter.close(true);
      yield* right.close(true);
      yield* left.close(true);
    }
  });
});

Deno.test("a wrapper for a member the receiver does not hold, or from a non-member, is neither stored nor listed", async () => {
  await run(function*() {
    yield* scenario(function*(s) {
      const carol = s.right.makeHab("carol");
      yield* call(() => learn(s.left, carol));
      const made = s.right.interactGroupHab("group", s.mids, { data: [{ n: 1 }] });
      const ixn = messagize(made.serder, { sigers: made.sigers });
      // Addressed to carol, whom the receiver does not hold.
      const misaddressed = signGroupMessage(
        s.bob,
        carol.pre,
        yield* multisigInteractExn(s.group, s.bob, s.mids, ixn, { recipient: carol.pre }),
      );
      yield* receive(s, misaddressed.message);
      // Sent by carol, who is not in the group.
      const outsider = signGroupMessage(
        carol,
        s.alice.pre,
        yield* multisigInteractExn(s.group, carol, s.mids, ixn, { recipient: s.alice.pre }),
      );
      yield* receive(s, outsider.message);
      assertEquals(s.notifier.count(), 0, "no notice is raised");
      assertEquals(s.left.db.exns.get([misaddressed.exnSaid]), null, "neither wrapper is stored");
      assertEquals(s.left.db.exns.get([outsider.exnSaid]), null);
      assertEquals(listGroupProposals(readDeps(s)), []);
      // The same event from a member to the receiver is listed.
      const { signed } = yield* peerInteraction(s, [{ n: 2 }]);
      assertEquals(listGroupProposals(readDeps(s)).map((proposal) => proposal.said), [signed.exnSaid]);
    }, "2");
  });
});
