import { concatBytes } from "cesr-ts";
import { systemClock } from "../../../../src/app/runtime/runtime-clock.ts";
import { FetchHttpClient } from "../../../../src/app/transport/http-client.ts";
/** Real forwarding admission, durable child evidence, and ownership at failure/replay boundaries. */
import {
  b,
  type CesrFrame,
  collectPayload,
  Dater,
  Diger,
  framePayload,
  nestedPayload,
  parse,
  parseBytes,
  Prefixer,
  type SerderKERI,
  Texter,
  Vrsn_1_0,
  Vrsn_2_0,
} from "cesr-ts";
import { call, run } from "effection";
import { assertEquals, assertExists, assertRejects } from "jsr:@std/assert";
import depthVector from "../../../../../cesr/test/fixtures/nested-depth.json" with { type: "json" };
import { ForwardHandler } from "../../../../src/app/delivery/forwarding.ts";
import { type ExchangeInput, Exchanger } from "../../../../src/app/exchanges/exchanging.ts";
import { createHabery, type Hab, type Habery } from "../../../../src/app/identity/habbing.ts";
import { MailboxDirector } from "../../../../src/app/mailbox/mailbox-director.ts";
import { openMailboxerForHabery } from "../../../../src/app/mailbox/mailboxing.ts";
import { dispatchEnvelope, envelopeFromFrame } from "../../../../src/app/protocol/parsering.ts";
import { createAgentRuntime } from "../../../../src/app/runtime/agent-runtime.ts";
import type { AgentCue } from "../../../../src/core/cues.ts";
import { Deck } from "../../../../src/core/deck.ts";
import { TransIdxSigGroup } from "../../../../src/core/dispatch.ts";
import { exchange } from "../../../../src/core/exchange/protocol-exchanging.ts";
import { messageAttachmentGroups, serializeMessage } from "../../../../src/core/protocol-serialization.ts";
import { loadNests, prepareNests, publishNests } from "../../../../src/db/exchange/exchange-nests.ts";

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
      const exchanger = new Exchanger(hby, { handlers: [new ForwardHandler(director)] });
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
Deno.test("nested forwarding rechecks provider authority before publishing collected child bytes", async () => {
  await scenario(async (_hby, sender, recipient, provider, director) => {
    const nest = await child(sender, "authority changed");
    const input = forward(sender, recipient, provider, nest);
    const handler = new ForwardHandler(director);
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
    const reopened = new Exchanger(hby, { handlers: [new ForwardHandler(director)] });
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
        () => run(() => exchanger.processEvent({ ...input, nests: [replacement] })),
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
