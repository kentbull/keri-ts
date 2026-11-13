import { concatBytes } from "cesr-ts";
import { createHabery } from "../../../../src/app/identity/lmdb-habery.ts";
import { systemClock } from "../../../../src/app/runtime/runtime-clock.ts";
import { FetchHttpClient } from "../../../../src/app/transport/http-client.ts";
/** Real forwarding admission, durable child evidence, and ownership at failure/replay boundaries. */
import {
  b,
  type CesrFrame,
  collectPayload,
  Counter,
  Dater,
  Diger,
  framePayload,
  nestedPayload,
  parse,
  parseBytes,
  Prefixer,
  type SerderKERI,
  t,
  Texter,
  Vrsn_1_0,
  Vrsn_2_0,
} from "cesr-ts";
import { call, type Operation, run } from "effection";
import { assert, assertEquals, assertExists, assertRejects } from "jsr:@std/assert";
import depthVector from "../../../../../cesr/test/fixtures/nested-depth.json" with { type: "json" };
import { type ExchangeInput, Exchanger } from "../../../../src/app/exchanges/exchanging.ts";
import { type Hab, type Habery } from "../../../../src/app/identity/habbing.ts";
import { ForwardHandler } from "../../../../src/app/mailbox/forward-handler.ts";
import { MailboxDirector } from "../../../../src/app/mailbox/mailbox-director.ts";
import { openMailboxerForHabery } from "../../../../src/app/mailbox/mailboxing.ts";
import { dispatchEnvelope, envelopeFromFrame } from "../../../../src/app/protocol/parsering.ts";
import {
  type AgentRuntime,
  createAgentRuntime,
  settleRuntimeIngress,
} from "../../../../src/app/runtime/agent-runtime.ts";
import type { AgentCue } from "../../../../src/core/cues.ts";
import { Deck } from "../../../../src/core/deck.ts";
import { TransIdxSigGroup } from "../../../../src/core/dispatch.ts";
import { exchange } from "../../../../src/core/exchange/protocol-exchanging.ts";
import { messageAttachmentGroups, serializeMessage } from "../../../../src/core/protocol-serialization.ts";
import { Roles } from "../../../../src/core/roles.ts";
import { loadNests, prepareNests, publishNests } from "../../../../src/db/exchange/exchange-nests.ts";
import keripy from "../../../../test/fixtures/keripy-ipex-current-state-vectors.json" with { type: "json" };

import { encodeDateTimeToDater } from "../../../../src/time/mod.ts";

/** Share a real habitat and authorized witness mailbox across each independent scenario. */
async function scenario(
  test: (
    hby: Habery,
    sender: Hab,
    recipient: Hab,
    provider: Hab,
    director: MailboxDirector,
    exchanger: Exchanger,
  ) => Promise<void>,
): Promise<void> {
  await run(function*() {
    const hby = yield* createHabery({ name: `nests-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    const mailboxer = yield* openMailboxerForHabery(hby);
    try {
      const provider = hby.makeHab("provider", undefined, { transferable: false });
      const sender = hby.makeHab("sender");
      const recipient = hby.makeHab("recipient", undefined, { wits: [provider.pre], toad: 1 });
      const director = new MailboxDirector(hby, { mailboxer });
      const exchanger = new Exchanger(hby, { handlers: [new ForwardHandler(director, null)] });
      yield* call(() => test(hby, sender, recipient, provider, director, exchanger));
    } finally {
      yield* mailboxer.close(true);
      yield* hby.close(true);
    }
  });
}

/** Sign only this body's bytes using the sender's actual accepted establishment event. */
function signatures(sender: Hab, serder: SerderKERI): TransIdxSigGroup[] {
  return [
    new TransIdxSigGroup(
      new Prefixer({ qb64: sender.pre }),
      sender.kever!.sner,
      new Diger({ qb64: sender.kever!.said }),
      sender.sign(serder.raw, true),
    ),
  ];
}

/** Build independently signed children with protocol-v1 or v2 bodies and explicit attachment genus. */
async function child(sender: Hab, value: string, version = Vrsn_1_0): Promise<CesrFrame> {
  const serder = exchange("/child", { value }, { sender: sender.pre, pvrsn: version })[0];
  return (await parseBytes(
    serializeMessage(serder, { tsgs: signatures(sender, serder), gvrsn: Vrsn_2_0, genusify: true }),
  ))[0];
}

/** Construct the signed v2 forward relationship while leaving each child proof independent. */
function forward(
  sender: Hab,
  recipient: Hab,
  provider: Hab,
  nest: CesrFrame,
  commitment = nest.body.raw,
): ExchangeInput {
  const serder = exchange("/fwd", { evt: new Diger({ raw: Diger.digest(commitment, "E"), code: "E" }).qb64 }, {
    sender: sender.pre,
    pvrsn: Vrsn_2_0,
    modifiers: { pre: recipient.pre, topic: "/nested" },
  })[0];
  return { serder, tsgs: signatures(sender, serder), nests: [nest], mailboxAid: provider.pre };
}
/**
 * A relaying agent runtime and a remote edge: the agent knows the sender and recipient only from ingested wire.
 * `colocated` is a second habitat of the agent's own Habery, as an edge's group co-member hosted on the agent.
 */
interface RelayFixture {
  readonly runtime: AgentRuntime;
  readonly agent: Hab;
  readonly colocated: Hab;
  readonly edge: Habery;
  readonly sender: Hab;
  readonly recipient: Hab;
}

/** Steps of one relay scenario, run while both Haberies and the agent runtime are open. */
type RelayTest = (fixture: RelayFixture) => Operation<void>;

/**
 * Compose an agent with `relaying: true` and a separate edge Habery. The sender names the agent as its witness
 * when `witnessed`; nothing else about the sender reaches the agent until a test ingests it.
 */
async function relayScenario(witnessed: boolean, test: RelayTest): Promise<void> {
  await run(function*() {
    const agentHby = yield* createHabery({ name: `relay-agent-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    const edgeHby = yield* createHabery({ name: `relay-edge-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    try {
      const agent = agentHby.makeHab("agent", undefined, { transferable: false });
      const colocated = agentHby.makeHab("colocated");
      const sender = edgeHby.makeHab("sender", undefined, witnessed ? { wits: [agent.pre], toad: 1 } : {});
      const recipient = edgeHby.makeHab("recipient");
      const runtime = yield* createAgentRuntime(agentHby, new FetchHttpClient(), systemClock, {
        enableMailboxStore: true,
        relaying: true,
      });
      try {
        // A witness takes its controller's events as local input (its receipt endpoint), never as misfits.
        yield* settleRuntimeIngress(runtime, [...sender.db.replay(sender.pre)!], { local: witnessed });
        yield* test({ runtime, agent, colocated, edge: edgeHby, sender, recipient });
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
 * Have the sender hand the agent one nested `/fwd` for `recipient` and return the forwarded child.
 *
 * @param fixture Open relay scenario.
 * @param value Child payload, distinct per call so each child has its own SAID.
 * @param recipient Final recipient named by the `/fwd`.
 * @param origin Habitat that signs the child; the sender signs the `/fwd` itself either way.
 * @returns The child frame the `/fwd` carried.
 */
function* forwardToAgent(fixture: RelayFixture, value: string, recipient: Hab, origin: Hab): Operation<CesrFrame> {
  const nest = yield* call(() => child(origin, value, Vrsn_2_0));
  const decision = yield* fixture.runtime.exc.processEvent(forward(fixture.sender, recipient, fixture.agent, nest));
  assertEquals(decision.kind, "accept");
  return nest;
}

Deno.test("forward handler relays a served sender's child through Poster", async () => {
  await relayScenario(false, function*(fixture) {
    const { runtime, agent, sender, recipient } = fixture;
    yield* settleRuntimeIngress(runtime, [sender.makeEndRole(agent.pre, Roles.mailbox, true)]);
    const nest = yield* forwardToAgent(fixture, "relay me", recipient, sender);
    const queued = [...runtime.postman.evts];
    assertEquals(queued.length, 1);
    // The agent sends as itself to the final recipient; the `/fwd` topic passes through unchanged.
    assertEquals([queued[0].src, queued[0].dest, queued[0].topic, queued[0].kin], [
      agent.pre,
      recipient.pre,
      "/nested",
      "msg",
    ]);
    // The child keeps the sender's own signature: the agent relays it, it does not re-sign it.
    assertEquals(queued[0].msg, yield* call(() => collectPayload(nestedPayload(nest, Vrsn_2_0))));
    assertEquals(runtime.mailboxer!.getTopicMsgs(`${recipient.pre}/nested`), []);
  });
});

Deno.test("forward handler ignores an unserved sender", async () => {
  await relayScenario(false, function*(fixture) {
    const { runtime, agent, sender, recipient } = fixture;
    // Authorizing the agent for a different role does not make the sender a served sender.
    yield* settleRuntimeIngress(runtime, [sender.makeEndRole(agent.pre, Roles.controller, true)]);
    yield* forwardToAgent(fixture, "not served", recipient, sender);
    assertEquals([...runtime.postman.evts], []);
    assertEquals(runtime.mailboxer!.getTopicMsgs(`${recipient.pre}/nested`), []);
  });
});

Deno.test("witness membership alone does not relay", async () => {
  await relayScenario(true, function*(fixture) {
    const { runtime, agent, sender } = fixture;
    assertEquals(runtime.hby.db.getKever(sender.pre)?.wits, [agent.pre]);
    yield* forwardToAgent(fixture, "witnessed only", fixture.recipient, sender);
    assertEquals([...runtime.postman.evts], []);
    // The same sender relays once it authorizes the agent as its mailbox.
    yield* settleRuntimeIngress(runtime, [sender.makeEndRole(agent.pre, Roles.mailbox, true)]);
    yield* forwardToAgent(fixture, "now served", fixture.recipient, sender);
    assertEquals([...runtime.postman.evts].map((evt) => evt.src), [agent.pre]);
  });
});

Deno.test("forward handler delivers a served sender's child to a recipient local to the agent", async () => {
  await relayScenario(false, function*(fixture) {
    const { runtime, agent, colocated, sender } = fixture;
    yield* settleRuntimeIngress(runtime, [sender.makeEndRole(agent.pre, Roles.mailbox, true)]);
    // The agent also stores for the colocated habitat; ingest still wins, so the child arrives exactly once.
    yield* settleRuntimeIngress(runtime, [colocated.makeEndRole(agent.pre, Roles.mailbox, true)]);
    const nest = yield* forwardToAgent(fixture, "for the co-member", colocated, sender);
    // The agent's own exchange intake accepted the sender-signed child, addressed to the colocated habitat.
    assertEquals(runtime.exc.complete(nest.body.said!), true);
    assertEquals(runtime.hby.db.exchangeMeta.get([nest.body.said!])?.mailboxAid, colocated.pre);
    assertEquals([...runtime.postman.evts], []);
    assertEquals(runtime.mailboxer!.getTopicMsgs(`${colocated.pre}/nested`), []);
  });
});

/**
 * A third party the agent does not serve forwards a child for the edge's group, which authorized the agent under
 * `role`; then the edge member, which the agent serves, forwards one too.
 */
function* groupPickup(fixture: RelayFixture, role: typeof Roles.mailbox | typeof Roles.agent): Operation<void> {
  const { runtime, agent, colocated, sender: member, recipient: third } = fixture;
  // The edge member and its co-member on the agent form the group; one of two signs.
  const { hab: group } = runtime.hby.makeGroupHab(
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
    ...third.db.replay(third.pre)!,
    member.makeEndRole(agent.pre, Roles.mailbox, true),
    group.makeEndRole(agent.pre, role, true),
  ]);
  const nest = yield* call(() => child(third, "from a third party", Vrsn_2_0));
  assertEquals((yield* runtime.exc.processEvent(forward(third, group, agent, nest))).kind, "accept");
  // The co-member processed the child, and the group's remote member can pick up exactly one copy.
  assertEquals(runtime.exc.complete(nest.body.said!), true);
  assertEquals(runtime.hby.db.exchangeMeta.get([nest.body.said!])?.mailboxAid, group.pre);
  const stored = yield* call(() => collectPayload(nestedPayload(nest, Vrsn_2_0)));
  assertEquals(runtime.mailboxer!.getTopicMsgs(`${group.pre}/nested`), [stored]);
  // The member's own child reaches the co-member too, but is not stored back for the member that sent it.
  const own = yield* call(() => child(member, "from the edge member", Vrsn_2_0));
  assertEquals((yield* runtime.exc.processEvent(forward(member, group, agent, own))).kind, "accept");
  assertEquals(runtime.exc.complete(own.body.said!), true);
  assertEquals(runtime.mailboxer!.getTopicMsgs(`${group.pre}/nested`), [stored]);
  assertEquals([...runtime.postman.evts], []);
}

Deno.test("group named in a third party's /fwd is ingested once and stored once", async () => {
  await relayScenario(false, (fixture) => groupPickup(fixture, Roles.mailbox));
});

Deno.test("group named in a third party's /fwd is ingested once and stored once under the agent role", async () => {
  await relayScenario(false, (fixture) => groupPickup(fixture, Roles.agent));
});

Deno.test("a group member's forward is relayed on the group's authorization", async () => {
  await relayScenario(false, function*(fixture) {
    const { runtime, agent, edge, sender, recipient } = fixture;
    // One of two signs, so the sender's signature alone completes the group's messages.
    const other = edge.makeHab("other");
    const { hab: group } = edge.makeGroupHab("team", sender, [sender.pre, other.pre], undefined, undefined, {
      isith: "1",
      nsith: "1",
      toad: 0,
    });
    yield* settleRuntimeIngress(runtime, [...edge.db.replay(group.pre)!]);
    // The member never authorized the agent; until the group does, its group's messages are not relayed.
    yield* forwardToAgent(fixture, "group before authorization", recipient, group);
    assertEquals([...runtime.postman.evts], []);
    yield* settleRuntimeIngress(runtime, [group.makeEndRole(agent.pre, Roles.mailbox, true)]);
    const nest = yield* forwardToAgent(fixture, "group after authorization", recipient, group);
    const queued = [...runtime.postman.evts];
    assertEquals(queued.map((evt) => [evt.src, evt.dest]), [[agent.pre, recipient.pre]]);
    assertEquals(queued[0].msg, yield* call(() => collectPayload(nestedPayload(nest, Vrsn_2_0))));
    // The member's own personal message is still not relayed: the group's authorization covers the group only.
    yield* forwardToAgent(fixture, "member personal", recipient, sender);
    assertEquals([...runtime.postman.evts].length, 1);
  });
});

Deno.test("nested forwarding rechecks provider authority before publishing collected child bytes", async () => {
  await scenario(async (_hby, sender, recipient, provider, director) => {
    const nest = await child(sender, "authority changed");
    const input = forward(sender, recipient, provider, nest);
    const handler = new ForwardHandler(director, null);
    const pending = handler.handle({ ...input, attachments: [] });
    if (!pending) throw new Error("The nested handler must return its collection operation");
    // The returned operation has yet to collect its child; revoke the real witness authority.
    recipient.rotate({ cuts: [provider.pre], toad: 0 });
    await run(() => pending);
    assertEquals(director.mailboxer!.getTopicMsgs(`${recipient.pre}/nested`), []);
  });
});

Deno.test("nested forwarding stores and replays a reference-qualified deep tree under default limits", async () => {
  await scenario(async (hby, sender, recipient, provider, _director, exchanger) => {
    const [nest] = await parseBytes(b(depthVector.qb64));
    {
      const input = forward(sender, recipient, provider, nest);
      assertEquals((await run(() => exchanger.processEvent(input))).kind, "accept");
      // Exercise stored-row hydration and parent serialization, where redundant wrappers formerly doubled depth.
      let delivered = 0;
      for await (const frame of parse(exchanger.replay(input.serder.said!))) {
        {
          assertEquals(frame.nests?.length, 1);
          await assertTree(frame.nests![0], nest);
          delivered++;
        }
      }
      assertEquals(delivered, 1);
      assertEquals(hby.db.enst.get([input.serder.said!]).length, 1);
    }
  });
});
/** Attach repeated qualified ciphertext fragments to prove exact wire retention inside enst. */
function attachEssr(frame: CesrFrame): Uint8Array {
  const wire = b("4BABYWJj4BABYWJj4BABeHl6");
  frame.essrs = ["abc", "abc", "xyz"].map((raw) => new Texter({ raw: b(raw), code: "4B" }));
  return wire;
}
/** Compare body bytes, child order, own signatures and original qualified ESSR recursively. */
async function assertTree(actual: CesrFrame, expected: CesrFrame): Promise<void> {
  assertEquals(actual.body.raw, expected.body.raw);
  assertEquals(actual.attachments.map((group) => group.raw), expected.attachments.map((group) => group.raw));
  assertEquals(actual.nests?.length ?? 0, expected.nests?.length ?? 0);
  if (expected.essrs) {
    assertEquals(
      concatBytes(...actual.essrs!.map((part) => part.qb64b)),
      concatBytes(...expected.essrs.map((part) => part.qb64b)),
    );
  }
  for (let i = 0; i < (expected.nests?.length ?? 0); i++) await assertTree(actual.nests![i], expected.nests![i]);
}
Deno.test("nested forward preserves signed tree, ciphertext and duplicates across durable reopen and replay", async () => {
  await scenario(async (hby, sender, recipient, provider, director, exchanger) => {
    const nest = await child(sender, "parent", Vrsn_2_0);
    nest.nests = [await child(sender, "first"), await child(sender, "second", Vrsn_2_0)];
    await attachEssr(nest.nests[0]);
    const input = forward(sender, recipient, provider, nest);
    // Exercise the public normalization seam with independently parsed parent endorsements.
    const [parent] = await parseBytes(
      serializeMessage(input.serder, { tsgs: input.tsgs, gvrsn: Vrsn_2_0, genusify: true }),
    );
    parent.nests = [nest];
    const normalized = envelopeFromFrame(parent);
    assertEquals(normalized.tsgs.length, 1);
    assertEquals(normalized.nests.length, 1);
    await run(() => dispatchEnvelope(normalized, hby.rvy, hby.kevery, exchanger, undefined, undefined, provider.pre));
    assertEquals(exchanger.complete(input.serder.said!), true);
    const rows = hby.db.enst.get([input.serder.said!]);
    assertEquals(rows.length, 1);
    const mailbox = [...director.topicIter(recipient.pre, "/nested")];
    assertEquals(mailbox.length, 1);
    const [carried] = await parseBytes(mailbox[0].msg);
    await assertTree(carried, nest);
    // Frozen Python replaces supplied evidence and invokes the handler again on a verified duplicate.
    const duplicate = await child(sender, "parent", Vrsn_2_0);
    duplicate.body = nest.body;
    duplicate.attachments = [];
    assertEquals((await run(() => exchanger.processEvent({ ...input, nests: [duplicate] }))).kind, "accept");
    assertEquals(hby.db.enst.get([input.serder.said!]), [
      new TextDecoder().decode(await collectPayload(nestedPayload(duplicate, Vrsn_2_0))),
    ]);
    assertEquals([...director.topicIter(recipient.pre, "/nested")].length, 2);
    // Restore the full supplied proof, then qualify reopen/replay of that successful replacement.
    assertEquals((await run(() => exchanger.processEvent(input))).kind, "accept");
    assertEquals(hby.db.enst.get([input.serder.said!]), rows);
    await run(function*() {
      yield* hby.db.reopen();
    });
    const reopened = new Exchanger(hby, { handlers: [new ForwardHandler(director, null)] });
    for await (const frame of parse(reopened.replay(input.serder.said!))) {
      assertEquals(frame.body.raw, input.serder.raw);
      assertEquals(envelopeFromFrame(frame).tsgs.length, 1);
      await assertTree(frame.nests![0], nest);
    }
    // Ending a replay early joins its temporary ESSR owners without deleting durable evidence.
    const reader = reopened.replay(input.serder.said!);
    await reader.next();
    await reader.return(undefined);
    assertEquals(hby.db.enst.get([input.serder.said!]), rows);
  });
});

Deno.test("nested forward rejects commitment and signer mismatch before public state, preserving accepted rows", async () => {
  await scenario(async (hby, sender, recipient, provider, director, exchanger) => {
    const nest = await child(sender, "payload");
    const bad = forward(sender, recipient, provider, nest, b("wrong"));
    assertEquals((await run(() => exchanger.processEvent(bad))).kind, "reject");
    assertEquals(hby.db.exns.get([bad.serder.said!]), null);
    assertEquals(hby.db.enst.get([bad.serder.said!]), []);
    const input = forward(sender, recipient, provider, nest);
    assertEquals(
      (await run(() => exchanger.processEvent({ ...input, tsgs: signatures(recipient, input.serder) }))).kind,
      "reject",
    );
    assertEquals(hby.db.enst.get([input.serder.said!]), []);
    assertEquals((await run(() => exchanger.processEvent(input))).kind, "accept");
    const rows = hby.db.enst.get([input.serder.said!]);
    const other = await child(sender, "other");
    assertEquals((await run(() => exchanger.processEvent({ ...input, nests: [other] }))).kind, "reject");
    assertEquals(hby.db.enst.get([input.serder.said!]), rows);
    assertEquals([...director.topicIter(recipient.pre, "/nested")].length, 1);
  });
});
Deno.test("nested forward escrows missing sender state then reopens and retries original evidence", async () => {
  await scenario(async (hby, sender, recipient, provider, director, exchanger) => {
    const nest = await child(sender, "escrow");
    await attachEssr(nest);
    const input = forward(sender, recipient, provider, nest);
    const establishment = sender.kever!.serder;
    hby.db.evts.rem([sender.pre, establishment.said!]);
    assertEquals((await run(() => exchanger.processEvent(input))).kind, "escrow");
    assertEquals(hby.db.exns.get([input.serder.said!]), null);
    assertExists(hby.db.epse.get([input.serder.said!]));
    await run(function*() {
      yield* hby.db.reopen();
    });
    hby.db.evts.pin([sender.pre, establishment.said!], establishment);
    await run(() => exchanger.processEscrows());
    assertExists(hby.db.exns.get([input.serder.said!]));
    assertEquals(hby.db.epse.get([input.serder.said!]), null);
    assertEquals([...director.topicIter(recipient.pre, "/nested")].length, 1);
    const loaded = await loadNests(hby.db, input.serder.said!);
    assertEquals(concatBytes(...loaded[0].essrs!.map((part) => part.qb64b)), b("4BABYWJj4BABYWJj4BABeHl6"));
  });
});
Deno.test("forwarder carries invalid child signatures; recipient withholds acceptance", async () => {
  await scenario(async (_hby, sender, recipient, provider, director, exchanger) => {
    const nest = await child(sender, "invalid-proof");
    const wrong = await child(sender, "different-signed-body");
    nest.attachments = wrong.attachments;
    const input = forward(sender, recipient, provider, nest);
    assertEquals((await run(() => exchanger.processEvent(input))).kind, "accept");
    const [carried] = await parseBytes([...director.topicIter(recipient.pre, "/nested")][0].msg);
    const decoded = envelopeFromFrame(carried);
    assertEquals((await run(() => exchanger.processEvent(decoded))).kind, "escrow");
    assertEquals(exchanger.complete(carried.body.said!), false);
  });
});
Deno.test("imported nested rows retain Python insertion order and dedup", async () => {
  await scenario(async (hby, sender) => {
    const first = await child(sender, "first");
    const second = await child(sender, "second");
    await attachEssr(first);
    await attachEssr(second);
    const owner = exchange("/fwd", {}, { sender: sender.pre, pvrsn: Vrsn_2_0 })[0];
    hby.db.epse.pin([owner.said!], owner);
    const wires = await prepareNests([first, second, first]);
    hby.db.env!.transactionSync(() => publishNests(hby.db, owner.said!, wires));
    assertEquals(hby.db.enst.get([owner.said!]).length, 2);
    assertEquals(hby.db.exchangeMeta.get([owner.said!]), null);
    const loaded = await loadNests(hby.db, owner.said!);
    await assertTree(loaded[0], first);
    await assertTree(loaded[1], second);
  });
});

Deno.test("stored placeholder nodes converge on KERIpy's canonical nested node bytes", async () => {
  // KERIpy 2b19fa87 Grant with a signed, a proof-bearing and a proofless node.
  const row = keripy.cases.find((row) => row.name === "fresh issuance refuses unauthenticated other node")!;
  const [grant] = parseBytes(b(row.wire));
  const node = (inner: Uint8Array) =>
    Counter.enclose({ qb64: inner, code: "BodyWithAttachmentGroup", version: Vrsn_2_0 });
  for (const nest of grant.nests!) {
    const [canonical] = await prepareNests([nest]);
    assert(row.wire.includes(t(canonical)), "keri-ts re-serializes KERIpy's exact node bytes");
    const [bodyOnly] = await prepareNests([{ ...nest, attachments: [] }]);
    const body = bodyOnly.subarray(4), groups = canonical.subarray(bodyOnly.length);
    // E5 legacy forms: KERIpy's wire placeholder -C(-KAA ...) and keri-ts's retained bare -KAA.
    for (
      const legacy of [
        concatBytes(body, Counter.enclose({ qb64: concatBytes(b("-KAA"), groups), version: Vrsn_2_0 })),
        concatBytes(body, b("-KAA"), groups),
      ]
    ) {
      const [stored] = parseBytes(concatBytes(Counter.makeGVC(Vrsn_2_0), node(legacy)));
      assertEquals(t((await prepareNests([stored]))[0]), t(canonical));
    }
  }
});

Deno.test("nested replacement rolls back publication failure and preserves earlier escrow/accepted evidence", async () => {
  await scenario(async (hby, sender, recipient, provider, _director, exchanger) => {
    const nest = await child(sender, "original");
    const input = forward(sender, recipient, provider, nest);
    assertEquals((await run(() => exchanger.processEvent(input))).kind, "accept");
    const originalRows = hby.db.enst.get([input.serder.said!]);
    const replacement = { ...nest, attachments: [] };
    const metadata = hby.db.exchangeMeta;
    const pin = metadata.pin;
    /** Fail inside the real LMDB transaction after child-row replacement, proving rollback. */
    metadata.pin = () => {
      throw new Error("publication fault");
    };
    try {
      await assertRejects(
        // The metadata write is skipped when nothing about it changed, so this replacement also moves the mailbox.
        () => run(() => exchanger.processEvent({ ...input, nests: [replacement], mailboxAid: sender.pre })),
        Error,
        "publication fault",
      );
      assertEquals(hby.db.enst.get([input.serder.said!]), originalRows);
      assertExists(hby.db.exns.get([input.serder.said!]));
      // Existing signature escrow without children must not adopt failed provisional evidence.
      const another = forward(sender, recipient, provider, await child(sender, "pending"));
      hby.db.epse.pin([another.serder.said!], another.serder);
      await assertRejects(() => run(() => exchanger.processEvent(another)), Error, "publication fault");
      assertExists(hby.db.epse.get([another.serder.said!]));
      assertEquals(hby.db.exns.get([another.serder.said!]), null);
      assertEquals(hby.db.enst.get([another.serder.said!]), []);
    } finally {
      metadata.pin = pin;
    }
  });
});

Deno.test("nested escrow evidence survives reopen until its owning escrow expires", async () => {
  await scenario(async (hby, sender, recipient, provider, _director, exchanger) => {
    const nest = await child(sender, "recover");
    const input = forward(sender, recipient, provider, nest);
    assertEquals((await run(() => exchanger.processEvent({ ...input, tsgs: [] }))).kind, "escrow");
    const retained = hby.db.enst.get([input.serder.said!]);
    hby.db.exchangeMeta.rem([input.serder.said!]);
    await run(function*() {
      yield* hby.db.reopen();
    });
    assertEquals(hby.db.enst.get([input.serder.said!]), retained);
    hby.db.epsd.pin(
      [input.serder.said!],
      new Dater({ qb64: encodeDateTimeToDater("2020-01-01T00:00:00.000000+00:00") }),
    );
    await run(() => exchanger.processEscrows());
    assertEquals(hby.db.enst.get([input.serder.said!]), []);
    assertEquals(hby.db.epse.get([input.serder.said!]), null);
  });
});
Deno.test("optional runtime KRAM pools proofs across reopen and forwards current children", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const sender = hby.makeHab("sender", undefined, { icount: 3, isith: "2", ncount: 3, nsith: "2" });
    const provider = hby.makeHab("provider", undefined, { transferable: false });
    const recipient = hby.makeHab("recipient", undefined, { wits: [provider.pre], toad: 1 });
    const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock, {
      enableMailboxStore: true,
      kram: { enabled: true, caches: { "~": [1000, 5000, 60000, 300000, 5000, 60000, 300000] } },
    });
    const nest = yield* call(() => child(sender, "independent"));
    const wire = yield* call(() => attachEssr(nest)), input = forward(sender, recipient, provider, nest);
    const original = input.tsgs![0], key = [sender.pre, input.serder.said!];
    const group = (index: number) =>
      new TransIdxSigGroup(original.prefixer, original.seqner, original.diger, [original.sigers[index]]);
    try {
      const first = yield* call(() =>
        collectPayload(framePayload({
          body: input.serder,
          attachments: messageAttachmentGroups({ tsgs: [group(0)] }, Vrsn_2_0),
          nests: [nest],
          gvrsn: Vrsn_2_0,
        }))
      );
      yield* runtime.reactor.processBytes(first, { mailboxAid: provider.pre });
      assertEquals([hby.db.exns.get(input.serder.said!), hby.db.exns.get(nest.body.said!)], [null, null]);
      assertExists(hby.db.pmkm.get(key));
      yield* hby.db.reopen();
      const [retry] = yield* call(() =>
        collectPayload(framePayload({
          body: input.serder,
          attachments: messageAttachmentGroups({ tsgs: [group(1)] }, Vrsn_2_0),
          nests: [nest],
          gvrsn: Vrsn_2_0,
        })).then(parseBytes)
      );
      const { envelope: ready } = yield* runtime.protocol.dispatch(retry, { mailboxAid: provider.pre });
      assertEquals(ready!.nests[0].body.raw, nest.body.raw);
      assertEquals(concatBytes(...ready!.nests[0].essrs!.map((part) => part.qb64b)), wire);
      assertEquals(hby.db.pmkm.get(key), null, "acceptance retires partial state before returning accepted evidence");
      assertEquals(hby.db.exns.get(nest.body.said!), null);
      assertExists(hby.db.exns.get(input.serder.said!));
      assertEquals(hby.db.pmkm.get(key), null);
      const saved = [...runtime.mailboxDirector.topicIter(recipient.pre, "/nested")];
      assertEquals(saved.length, 1);
      yield* runtime.reactor.processBytes(saved[0].msg);
      assertEquals(
        hby.db.exns.get(nest.body.said!)!.raw,
        nest.body.raw,
        "recipient separately authenticates the child's own signatures",
      );
    } finally {
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});
