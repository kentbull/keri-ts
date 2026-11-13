/** An agent keeps a third party's raw mail for the identifiers that authorized it as `agent`, and nothing else. */
import { collectPayload, concatBytes, Diger, framePayload, parseBytes, Prefixer, Vrsn_2_0 } from "cesr-ts";
import { call, type Operation, run } from "effection";
import { assertEquals } from "jsr:@std/assert";
import type { Hab, Habery } from "../../../../src/app/identity/habbing.ts";
import { createHabery } from "../../../../src/app/identity/lmdb-habery.ts";
import { keepRawArrival } from "../../../../src/app/mailbox/agent-inbox.ts";
import { mailboxTopicKey } from "../../../../src/app/mailbox/mailboxing.ts";
import type { DispatchDecision } from "../../../../src/app/protocol/parsering.ts";
import {
  type AgentRuntime,
  createAgentRuntime,
  settleRuntimeIngress,
} from "../../../../src/app/runtime/agent-runtime.ts";
import { systemClock } from "../../../../src/app/runtime/runtime-clock.ts";
import { FetchHttpClient } from "../../../../src/app/transport/http-client.ts";
import { TransIdxSigGroup } from "../../../../src/core/dispatch.ts";
import { exchange } from "../../../../src/core/exchange/protocol-exchanging.ts";
import { serializeMessage } from "../../../../src/core/protocol-serialization.ts";
import { Roles } from "../../../../src/core/roles.ts";

/**
 * An agent Habery hosting `agent` and the edge's group co-member `colocated`, and a separate edge Habery holding the
 * edge's `member` and an unrelated `third` party. The member and the `team` group (colocated + member, one of two
 * signs) both authorized the agent as `agent`.
 */
interface InboxFixture {
  readonly runtime: AgentRuntime;
  /** The edge's Habery, for identifiers a scenario adds. */
  readonly edge: Habery;
  readonly agent: Hab;
  readonly colocated: Hab;
  readonly group: Hab;
  readonly member: Hab;
  readonly third: Hab;
}

/** One processed raw arrival: the agent's decision and how many mailbox entries it kept. */
interface Arrival {
  readonly decision: DispatchDecision | undefined;
  readonly kept: number;
}

/** Steps of one inbox scenario, run while both Haberies and the agent runtime are open. */
type InboxTest = (fixture: InboxFixture) => Operation<void>;

/** Compose the agent and the edge, and accept every KEL and authorization the scenario starts from. */
async function inboxScenario(test: InboxTest): Promise<void> {
  await run(function*() {
    const agentHby = yield* createHabery({ name: `inbox-agent-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    const edgeHby = yield* createHabery({ name: `inbox-edge-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    try {
      const agent = agentHby.makeHab("agent", undefined, { transferable: false });
      const colocated = agentHby.makeHab("colocated");
      const member = edgeHby.makeHab("member");
      const third = edgeHby.makeHab("third");
      const runtime = yield* createAgentRuntime(agentHby, new FetchHttpClient(), systemClock, {
        enableMailboxStore: true,
      });
      try {
        yield* settleRuntimeIngress(runtime, [...member.db.replay(member.pre)!, ...third.db.replay(third.pre)!]);
        const { hab: group } = agentHby.makeGroupHab(
          "team",
          colocated,
          [colocated.pre, member.pre],
          undefined,
          undefined,
          {
            isith: "1",
            nsith: "1",
            toad: 0,
          },
        );
        yield* settleRuntimeIngress(runtime, [
          member.makeEndRole(agent.pre, Roles.agent, true),
          group.makeEndRole(agent.pre, Roles.agent, true),
        ]);
        assertEquals(agentHby.db.ends.get([member.pre, Roles.agent, agent.pre])?.allowed, true);
        assertEquals(agentHby.db.ends.get([group.pre, Roles.agent, agent.pre])?.allowed, true);
        yield* test({ runtime, edge: edgeHby, agent, colocated, group, member, third });
      } finally {
        yield* runtime.close();
      }
    } finally {
      yield* edgeHby.close(true);
      yield* agentHby.close(true);
    }
  });
}

/**
 * Hand the agent one raw request body as its HTTP ingress does: dispatch each frame, then offer it to the inbox.
 *
 * @param fixture Open inbox scenario.
 * @param wire Raw request body; each frame is its own arrival.
 * @returns Each frame's decision and kept count, in wire order.
 */
function* arrive(fixture: InboxFixture, wire: Uint8Array): Operation<Arrival[]> {
  const { runtime, agent } = fixture;
  const arrivals: Arrival[] = [];
  for (const frame of yield* call(() => parseBytes(wire))) {
    const { decision } = yield* runtime.protocol.dispatch(frame, { mailboxAid: agent.pre, escrows: true });
    arrivals.push({
      decision,
      kept: yield* keepRawArrival(runtime.mailboxDirector, { frame, hostAid: agent.pre, decision }),
    });
  }
  return arrivals;
}

/** Stored entries under one principal's topic. */
function stored(fixture: InboxFixture, pre: string, topic: string): Uint8Array[] {
  return fixture.runtime.mailboxer!.getTopicMsgs(mailboxTopicKey(pre, topic));
}

/** The exact bytes the inbox keeps for one raw message: its frame's qualified wire. */
function* kept(wire: Uint8Array): Operation<Uint8Array> {
  const [frame] = yield* call(() => parseBytes(wire));
  return yield* call(() => collectPayload(framePayload(frame)));
}

Deno.test("agent keeps a third party's raw exn for a principal that named it agent", async () => {
  await inboxScenario(function*(fixture) {
    const { colocated, member, third } = fixture;
    // A KERIpy sender names the recipient in `rp` (v1); a v2 exn names it in `ri`.
    const v1 = third.endorse(
      exchange("/relay/check", { value: "v1" }, { sender: third.pre, recipient: member.pre })[0],
    );
    const v2 = third.endorse(
      exchange("/relay/check", { value: "v2" }, { sender: third.pre, recipient: member.pre, pvrsn: Vrsn_2_0 })[0],
      { gvrsn: Vrsn_2_0, genusify: true },
    );
    for (const wire of [v1, v2]) {
      const [arrival] = yield* arrive(fixture, wire);
      assertEquals([arrival.decision?.kind, arrival.kept], ["accept", 1]);
    }
    assertEquals(stored(fixture, member.pre, "/relay"), [yield* kept(v1), yield* kept(v2)]);
    // A recipient that never named this host its agent gets nothing, even one of its own habitats.
    const local = third.endorse(
      exchange("/relay/check", { value: "local" }, { sender: third.pre, recipient: colocated.pre })[0],
    );
    assertEquals((yield* arrive(fixture, local)).map((arrival) => arrival.kept), [0]);
    assertEquals(stored(fixture, colocated.pre, "/relay"), []);
    // Raw mail is kept only under the agent role: a mailbox client is reached with `/fwd`.
    const client = fixture.edge.makeHab("mailbox-client");
    yield* settleRuntimeIngress(fixture.runtime, [
      ...client.db.replay(client.pre)!,
      client.makeEndRole(fixture.agent.pre, Roles.mailbox, true),
    ]);
    const toClient = third.endorse(
      exchange("/relay/check", { value: "client" }, { sender: third.pre, recipient: client.pre })[0],
    );
    assertEquals((yield* arrive(fixture, toClient)).map((arrival) => arrival.kept), [0]);
    assertEquals(stored(fixture, client.pre, "/relay"), []);
  });
});

Deno.test("raw message with no recipient is kept once under the edge member", async () => {
  await inboxScenario(function*(fixture) {
    const { agent, colocated, group, member, third } = fixture;
    third.rotate();
    // The whole KEL in one body: the inception the agent already holds is a duplicate, the rotation is new.
    const arrivals = yield* arrive(fixture, concatBytes(...third.db.replay(third.pre)!));
    assertEquals(arrivals.map((arrival) => [arrival.decision?.kind, arrival.kept]), [["duplicate", 0], ["accept", 1]]);
    const rotation = [...third.db.replay(third.pre)!][1];
    assertEquals(stored(fixture, member.pre, "/replay"), [yield* kept(rotation)]);
    // The local group is processed by its co-member through dispatch; neither it nor a local habitat gets a copy.
    for (const pre of [group.pre, colocated.pre, agent.pre]) assertEquals(stored(fixture, pre, "/replay"), []);
  });
});

Deno.test("the edge's own raw traffic is not kept", async () => {
  await inboxScenario(function*(fixture) {
    const { agent, group, member } = fixture;
    member.rotate();
    const own = [
      [...member.db.replay(member.pre)!][1],
      // Addressed to the group, which keeps mail for pickup: still the member's own message.
      member.endorse(
        exchange("/relay/check", { value: "to the group" }, { sender: member.pre, recipient: group.pre })[0],
      ),
      member.endorse(exchange("/relay/check", { value: "to nobody" }, { sender: member.pre })[0]),
      member.makeEndRole(agent.pre, Roles.agent, true),
    ];
    for (const wire of own) {
      const [arrival] = yield* arrive(fixture, wire);
      assertEquals(arrival.decision?.kind, "accept");
      assertEquals(arrival.kept, 0);
    }
    for (const pre of [member.pre, group.pre]) {
      for (const topic of ["/relay", "/replay", "/reply"]) assertEquals(stored(fixture, pre, topic), []);
    }
  });
});

Deno.test("rejected raw message is not kept", async () => {
  await inboxScenario(function*(fixture) {
    const { member, third } = fixture;
    const serder =
      exchange("/relay/check", { value: "misreferenced" }, { sender: third.pre, recipient: member.pre })[0];
    // Signed by the third party, but its signature group names an establishment event the third party never made.
    const misreferenced = serializeMessage(serder, {
      tsgs: [
        new TransIdxSigGroup(
          new Prefixer({ qb64: third.pre }),
          third.kever!.sner,
          new Diger({ qb64: member.kever!.said }),
          third.sign(serder.raw, true),
        ),
      ],
    });
    const [arrival] = yield* arrive(fixture, misreferenced);
    assertEquals(arrival.decision?.kind, "reject");
    assertEquals(arrival.kept, 0);
    assertEquals(stored(fixture, member.pre, "/relay"), []);
  });
});
