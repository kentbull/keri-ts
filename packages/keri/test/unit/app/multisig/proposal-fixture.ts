/** Shared two-member scenario for group proposal tests. */
import { parseBytes, type ThresholdSith } from "cesr-ts";
import { call, type Operation, run } from "effection";
import type { Hab, Habery } from "../../../../src/app/identity/habbing.ts";
import { createHabery } from "../../../../src/app/identity/lmdb-habery.ts";
import { multisigInteractExn } from "../../../../src/app/multisig/grouping.ts";
import { signGroupMessage } from "../../../../src/app/multisig/multisig-messaging.ts";
import { Notifier, openNoterForHabery } from "../../../../src/app/notifications/notifying.ts";
import { dispatchEnvelope, envelopeFromFrame } from "../../../../src/app/protocol/parsering.ts";
import { type AgentRuntime, createAgentRuntime } from "../../../../src/app/runtime/agent-runtime.ts";
import { systemClock } from "../../../../src/app/runtime/runtime-clock.ts";
import { FetchHttpClient } from "../../../../src/app/transport/http-client.ts";
import { messagize } from "../../../../src/core/protocol-serialization.ts";

/** Admit complete public KEL evidence without sharing private member stores. */
export async function learn(target: Habery, member: Hab): Promise<void> {
  for (const wire of member.db.clonePreIter(member.pre, 0)) {
    for (const frame of await parseBytes(wire)) {
      await run(() => dispatchEnvelope(envelopeFromFrame(frame, true), target.rvy, target.kevery));
    }
  }
}

export const GROUP = { isith: "1", nsith: "1", toad: 0 } as const;

/** Two members, each with a store; `left` is the local member and has joined and accepted "group". */
export function* scenario(
  body: (s: Scenario) => Operation<void>,
  threshold: ThresholdSith = "1",
): Operation<void> {
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
    const local = left.makeGroupHab("group", alice, mids, mids, undefined, {
      isith: threshold,
      nsith: threshold,
      toad: 0,
    });
    const remote = right.makeGroupHab("group", bob, mids, mids, undefined, {
      isith: threshold,
      nsith: threshold,
      toad: 0,
    });
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

export interface Scenario {
  left: Habery;
  right: Habery;
  alice: Hab;
  bob: Hab;
  mids: string[];
  group: string;
  notifier: Notifier;
  runtime: AgentRuntime;
}

export function readDeps({ left, runtime, notifier }: Scenario) {
  return { hby: left, exc: runtime.exc, notifier, registryStore: runtime.acdc?.store ?? null };
}

/** Deliver bob's wrapper to the local runtime as a peer would. */
export function* receive(s: Scenario, wrapper: Uint8Array): Operation<void> {
  yield* s.runtime.reactor.processBytes(wrapper, { local: true });
}

/** A peer ixn proposal for "group"; returns its wrapper SAID and event. */
export function* peerInteraction(s: Scenario, data: unknown[]) {
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
