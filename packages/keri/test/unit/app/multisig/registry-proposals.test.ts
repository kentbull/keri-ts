/** Approving and proposing registry events (vcp and rip/bup) through the proposal API. */
import { concatBytes, Diger, parseBytes, Prefixer, SerderKERI, Vrsn_1_0, Vrsn_2_0 } from "cesr-ts";
import { call, type Operation, run } from "effection";
import { assertEquals, assertExists, assertRejects } from "jsr:@std/assert";
import { regcept as acdcV2Regcept } from "../../../../src/acdc/messaging.ts";
import { inceptCredentialRegistry } from "../../../../src/app/credentials/credential-workflows.ts";
import type { Hab, Habery } from "../../../../src/app/identity/habbing.ts";
import { createHabery } from "../../../../src/app/identity/lmdb-habery.ts";
import type { GroupEventRef } from "../../../../src/app/multisig/counseling.ts";
import { approveGroupProposal } from "../../../../src/app/multisig/proposals.ts";
import { proposeRegistryEvent } from "../../../../src/app/multisig/proposing.ts";
import { type AgentRuntime, createAgentRuntime } from "../../../../src/app/runtime/agent-runtime.ts";
import { systemClock } from "../../../../src/app/runtime/runtime-clock.ts";
import { FetchHttpClient } from "../../../../src/app/transport/http-client.ts";
import { TransIdxSigGroup } from "../../../../src/core/dispatch.ts";
import { ValidationError } from "../../../../src/core/errors.ts";
import { exchange } from "../../../../src/core/exchange/protocol-exchanging.ts";
import { interact as interactEvent } from "../../../../src/core/protocol-eventing.ts";
import { messageAttachmentGroups, messagize } from "../../../../src/core/protocol-serialization.ts";
import { learn } from "./proposal-fixture.ts";

interface Pair {
  left: Habery;
  right: Habery;
  alice: Hab;
  bob: Hab;
  group: Hab;
  localGroup: ReturnType<Habery["makeGroupHab"]>;
  receiver: AgentRuntime;
  sender: AgentRuntime;
}

/** Two joined and accepted members of one group, each with a runtime. */
function* pair(threshold: string, body: (p: Pair) => Operation<void>): Operation<void> {
  const left = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
  const right = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
  try {
    const alice = left.makeHab("alice");
    const bob = right.makeHab("bob");
    yield* call(() => learn(left, bob));
    yield* call(() => learn(right, alice));
    const mids = [alice.pre, bob.pre];
    const args = { isith: threshold, nsith: threshold, toad: 0 };
    const localGroup = left.makeGroupHab("group", alice, mids, mids, undefined, args);
    const remote = right.makeGroupHab("group", bob, mids, mids, undefined, args);
    const receiver = yield* createAgentRuntime(left, new FetchHttpClient(), systemClock);
    const sender = yield* createAgentRuntime(right, new FetchHttpClient(), systemClock);
    try {
      for (const runtime of [receiver, sender]) {
        yield* runtime.reactor.processBytes(
          messagize(localGroup.serder, { sigers: [...localGroup.sigers, ...remote.sigers] }),
          { local: true },
        );
      }
      yield* body({ left, right, alice, bob, group: localGroup.hab, localGroup, receiver, sender });
    } finally {
      yield* sender.close();
      yield* receiver.close();
    }
  } finally {
    yield* right.close(true);
    yield* left.close(true);
  }
}

function depsFor(hby: Habery, runtime: AgentRuntime, started: GroupEventRef[]) {
  runtime.postman.send = evt => ({ ...evt, kin: "msg" });
  runtime.postman.wait = function*(evt) {
    return { kin: "sent", evt, deliveries: ["test"] };
  };
  return {
    hby,
    exc: runtime.exc,
    reactor: runtime.reactor,
    protocol: runtime.protocol,
    postman: runtime.postman,
    notifier: null,
    registryStore: runtime.acdc?.store ?? null,
    vdr: runtime.vdr,
    counselor: { start: (event: GroupEventRef) => (started.push(event), true) },
  };
}

Deno.test("approveGroupProposal approves a legacy registry proposal and needs its name first", async () => {
  await run(function*() {
    yield* pair("1", function*(p) {
      const wires: Uint8Array[] = [];
      p.receiver.postman.send = evt => (wires.push(evt.msg), { ...evt, kin: "msg" });
      p.receiver.postman.wait = function*(evt) {
        return { kin: "sent", evt, deliveries: ["peer"] };
      };
      yield* inceptCredentialRegistry(p.receiver.vdr!, p.receiver.reactor, p.receiver.postman, p.group, {
        registryName: "proposed",
      });
      const wire = wires[0];
      const wrapper = new SerderKERI({ raw: wire });
      yield* p.sender.reactor.processBytes(wire, { local: true });
      const started: GroupEventRef[] = [];
      const deps = depsFor(p.right, p.sender, started);
      yield* call(() =>
        assertRejects(
          () => run(() => approveGroupProposal(deps, wrapper.said!)),
          ValidationError,
          "registry name",
        )
      );
      assertEquals(started, []);
      const result = yield* approveGroupProposal(deps, wrapper.said!, { registryName: "approved-name" });
      assertEquals(result.route, "/multisig/vcp");
      assertEquals(result.group, p.group.pre);
      assertExists(p.sender.vdr!.reger.regs.get("approved-name"));
      assertEquals(started.length, 1);
      assertEquals(result.event, started[0]);
    });
  });
});

/** A peer's v2 rip proposal for the group, wrapped as the receiver would see it. */
function ripProposal(p: Pair) {
  const rip = acdcV2Regcept(p.group.pre);
  const anchor = interactEvent(
    p.group.pre,
    p.group.kever!.said,
    1,
    [{ i: rip.said!, s: "0", d: rip.said! }],
    { version: Vrsn_2_0 },
  );
  const source = messageAttachmentGroups({
    sourceSeals: [{
      i: new Prefixer({ qb64: p.group.pre }),
      s: anchor.sner!,
      d: new Diger({ qb64: anchor.said! }),
    }],
  }, Vrsn_2_0);
  const telFrame = parseBytes(messagize(rip, concatBytes(...source.map(group => group.raw)), { gvrsn: Vrsn_2_0 }))[0];
  const kelFrame = parseBytes(
    messagize(anchor, { sigers: p.right.habs.get(p.group.pre)!.sign(anchor.raw, true), gvrsn: Vrsn_1_0 }),
  )[0];
  const wrapper = exchange("/multisig/rip", { gid: p.group.pre, tel: rip.said!, anc: anchor.said! }, {
    sender: p.bob.pre,
    version: Vrsn_2_0,
  })[0];
  const establishment = p.bob.db.getEvtSerder(p.bob.pre, p.bob.kever!.lastEst.d)!;
  const tsgs = [
    new TransIdxSigGroup(
      new Prefixer({ qb64: p.bob.pre }),
      establishment.sner!,
      new Diger({ qb64: establishment.said! }),
      p.bob.sign(wrapper.raw, true),
    ),
  ];
  return { rip, anchor, wrapper, candidate: { serder: wrapper, nests: [telFrame, kelFrame], tsgs } };
}

Deno.test("approveGroupProposal approves a rip proposal and counsels its anchor", async () => {
  await run(function*() {
    yield* pair("2", function*(p) {
      const { rip, anchor, wrapper, candidate } = ripProposal(p);
      assertEquals((yield* p.receiver.exc.processEvent(candidate)).kind, "accept");
      const started: GroupEventRef[] = [];
      const result = yield* approveGroupProposal(depsFor(p.left, p.receiver, started), wrapper.said!);
      assertEquals(result.route, "/multisig/rip");
      assertEquals(result.embedded, rip.said);
      assertEquals(result.event, { pre: p.group.pre, sn: 1, said: anchor.said });
      assertEquals(started, [result.event]);
      assertEquals(p.receiver.exc.complete(result.said), true);
    });
  });
});

Deno.test("proposeRegistryEvent authors the anchor, counsels it and publishes the proposal", async () => {
  await run(function*() {
    yield* pair("1", function*(p) {
      const started: GroupEventRef[] = [];
      const deps = depsFor(p.left, p.receiver, started);
      const rip = acdcV2Regcept(p.group.pre);
      const result = yield* proposeRegistryEvent(deps, p.group, rip);
      assertEquals(result.route, "/multisig/rip");
      assertEquals(result.embedded, rip.said);
      assertEquals(result.event.pre, p.group.pre);
      assertEquals(result.event.sn, 1);
      assertEquals(started, [result.event]);
      assertEquals(result.messages.length, 1);
      assertEquals(result.accepted, true);
    });
  });
});
