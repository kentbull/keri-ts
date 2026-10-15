/** Real forwarding admission, durable child evidence, and ownership at failure/replay boundaries. */
import {
  b,
  bytesEqual,
  type CesrFrame,
  collectPayload,
  Dater,
  Diger,
  discardFrame,
  essrPayload,
  framePayload,
  MemoryPayloadSink,
  nestedPayload,
  parse,
  parseBytes,
  Prefixer,
  ResourceAdmissionError,
  ResourceLimitError,
  ResourcePolicy,
  type SerderKERI,
  Vrsn_1_0,
  Vrsn_2_0,
} from "cesr-ts";
import { call, run } from "effection";
import { assertEquals, assertExists, assertRejects, assertThrows } from "jsr:@std/assert";
import depthVector from "../../../../cesr/test/fixtures/nested-depth.json" with { type: "json" };
import { createAgentRuntime } from "../../../src/app/agent-runtime.ts";
import { type ExchangeInput, Exchanger } from "../../../src/app/exchanging.ts";
import { ForwardHandler } from "../../../src/app/forwarding.ts";
import { createHabery, type Hab, type Habery } from "../../../src/app/habbing.ts";
import { MailboxDirector } from "../../../src/app/mailbox-director.ts";
import { openMailboxerForHabery } from "../../../src/app/mailboxing.ts";
import { dispatchEnvelope, envelopeFromFrame } from "../../../src/app/parsering.ts";
import { CueDeck } from "../../../src/core/cue-admission.ts";
import { DeckFullError } from "../../../src/core/deck.ts";
import { TransIdxSigGroup } from "../../../src/core/dispatch.ts";
import { exchange } from "../../../src/core/protocol-exchanging.ts";
import { messageAttachmentGroups, serializeMessage } from "../../../src/core/protocol-serialization.ts";
import { suffix } from "../../../src/db/core/keys.ts";
import { chargeNests, discardNests, loadNests, publishNests, stageNests } from "../../../src/db/exchange-nests.ts";
import { MAX_NESTED_WIRE_BYTES, NESTED_COPY_RESERVATION_BYTES } from "../../../src/db/exchange-nests.ts";

import { encodeDateTimeToDater } from "../../../src/time/mod.ts";

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

Deno.test("nested forwarding stores and replays a reference-qualified deep tree under default limits", async () => {
  await scenario(async (hby, sender, recipient, provider, _director, exchanger) => {
    const [nest] = await parseBytes(b(depthVector.qb64));
    try {
      const input = forward(sender, recipient, provider, nest);
      assertEquals((await run(() => exchanger.processEvent(input))).kind, "accept");
      // Exercise stored-row hydration and parent serialization, where redundant wrappers formerly doubled depth.
      let delivered = 0;
      for await (const frame of parse(exchanger.replay(input.serder.said!))) {
        try {
          assertEquals(frame.nests?.length, 1);
          await assertTree(frame.nests![0], nest);
          delivered++;
        } finally {
          await discardFrame(frame);
        }
      }
      assertEquals(delivered, 1);
      assertEquals(hby.db.enst.get([input.serder.said!]).length, 1);
    } finally {
      await discardFrame(nest);
    }
  });
});

/** Independent aggregate credits permit bounded imported rows without private metadata. */
function budget() {
  return { bytes: 8 * 1024 ** 2, groups: 4096, nodes: 255, essrBytes: 8 * 1024 ** 2, essrItems: 16384 };
}

/** Attach repeated qualified ciphertext fragments to prove exact wire retention inside enst. */
async function attachEssr(frame: CesrFrame): Promise<Uint8Array> {
  const wire = b("4BABYWJj4BABYWJj4BABeHl6");
  const sink = new MemoryPayloadSink(wire.length);
  await sink.write(wire);
  frame.essr = essrPayload(await sink.finish(), 3, 9, Vrsn_2_0);
  return wire;
}

/** Compare body bytes, child order, own signatures and original qualified ESSR recursively. */
async function assertTree(actual: CesrFrame, expected: CesrFrame): Promise<void> {
  assertEquals(actual.body.raw, expected.body.raw);
  assertEquals(actual.attachments.map((group) => group.raw), expected.attachments.map((group) => group.raw));
  assertEquals(actual.nests?.length ?? 0, expected.nests?.length ?? 0);
  if (expected.essr) {
    assertEquals(await collectPayload(actual.essr!.wire, 1024), await collectPayload(expected.essr.wire, 1024));
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
    await run(() => dispatchEnvelope(normalized, hby.rvy, hby.kevery, exchanger, {}, provider.pre));
    assertEquals(exchanger.complete(input.serder.said!), true);
    const rows = hby.db.enst.get([input.serder.said!]);
    assertEquals(rows.length, 1);
    const mailbox = [...director.topicIter(recipient.pre, "/nested")];
    assertEquals(mailbox.length, 1);
    const [carried] = await parseBytes(mailbox[0].msg);
    await assertTree(carried, nest);
    await discardFrame(carried);
    // Frozen Python replaces supplied evidence and invokes the handler again on a verified duplicate.
    const duplicate = await child(sender, "parent", Vrsn_2_0);
    duplicate.body = nest.body;
    duplicate.attachments = [];
    assertEquals((await run(() => exchanger.processEvent({ ...input, nests: [duplicate] }))).kind, "accept");
    assertEquals(hby.db.enst.get([input.serder.said!]), [
      new TextDecoder().decode(await collectPayload(nestedPayload(duplicate, Vrsn_2_0), 4096)),
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
      await discardFrame(frame);
    }
    // Ending a replay early joins its temporary ESSR owners without deleting durable evidence.
    const reader = reopened.replay(input.serder.said!);
    await reader.next();
    await reader.return(undefined);
    assertEquals(Array.from(Deno.readDirSync(`${hby.db.path}/payloads/staging`)).length, 0);
    assertEquals(hby.db.enst.get([input.serder.said!]), rows);
    await discardFrame(parent);
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
    await discardFrame(nest);
    await run(function*() {
      yield* hby.db.reopen();
    });
    hby.db.evts.pin([sender.pre, establishment.said!], establishment);
    await run(() => exchanger.processEscrows());
    assertExists(hby.db.exns.get([input.serder.said!]));
    assertEquals(hby.db.epse.get([input.serder.said!]), null);
    assertEquals([...director.topicIter(recipient.pre, "/nested")].length, 1);
    const loaded = await loadNests(hby.db, input.serder.said!, budget());
    assertEquals(await collectPayload(loaded[0].essr!.wire, 1024), b("4BABYWJj4BABYWJj4BABeHl6"));
    await discardNests(loaded);
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
    await discardFrame(carried);
  });
});

Deno.test("imported nested rows retain Python insertion order and dedup with aggregate credits", async () => {
  await scenario(async (hby, sender) => {
    const first = await child(sender, "first");
    const second = await child(sender, "second");
    await attachEssr(first);
    await attachEssr(second);
    const owner = exchange("/fwd", {}, { sender: sender.pre, pvrsn: Vrsn_2_0 })[0];
    hby.db.epse.pin([owner.said!], owner);
    await hby.db.openPayloads();
    await stageNests(hby.db, owner.said!, [first, second, first]);
    hby.db.env!.transactionSync(() => publishNests(hby.db, owner.said!, owner.said!));
    assertEquals(hby.db.enst.get([owner.said!]).length, 2);
    assertEquals(hby.db.exchangeMeta.get([owner.said!]), null);
    const loaded = await loadNests(hby.db, owner.said!, budget());
    await assertTree(loaded[0], first);
    await assertTree(loaded[1], second);
    await discardNests(loaded);
    await assertRejects(() => loadNests(hby.db, owner.said!, { ...budget(), nodes: 1 }));
    await assertRejects(() => loadNests(hby.db, owner.said!, { ...budget(), essrItems: 3 }));
    const used = budget();
    chargeNests([first], used);
    await assertRejects(() => loadNests(hby.db, owner.said!, { ...budget(), bytes: budget().bytes - used.bytes }));
    await discardFrame(first);
    await discardFrame(second);
    assertEquals(Array.from(Deno.readDirSync(`${hby.db.path}/payloads/staging`)).length, 0);
  });
});

Deno.test("nested row admission bounds remaining wire before hydration, comparisons and writer publication", async () => {
  await scenario(async (hby, sender) => {
    const first = await child(sender, "bounded-row");
    await attachEssr(first);
    const owner = exchange("/fwd", {}, { sender: sender.pre, pvrsn: Vrsn_2_0 })[0];
    const key = suffix(b(owner.said!), 0), extra = suffix(b(owner.said!), 1);
    const stage = crypto.randomUUID(), compare = crypto.randomUUID();
    hby.db.epse.pin([owner.said!], owner);
    try {
      await stageNests(hby.db, stage, [first, first]);
      hby.db.env!.transactionSync(() => publishNests(hby.db, owner.said!, stage));
      const original = hby.db.getValBounded(hby.db.enst.sdb, key, MAX_NESTED_WIRE_BYTES)!;
      // Each row fits the individual cap, but the second cannot fit the remaining aggregate credit.
      hby.db.enst.sdb.putSync(extra, new Uint8Array(MAX_NESTED_WIRE_BYTES));
      const native = hby.db.enst.sdb as unknown as {
        getBinary(key: Uint8Array, options?: object): Uint8Array | undefined;
      };
      const read = native.getBinary;
      let oversizedCopies = 0;
      native.getBinary = function(key, options) {
        if (bytesEqual(key, extra)) oversizedCopies++;
        return read.call(this, key, options);
      };
      try {
        await assertRejects(() => loadNests(hby.db, owner.said!, budget()), ResourceLimitError);
      } finally {
        native.getBinary = read;
      }
      assertEquals(oversizedCopies, 0, "remaining credit refuses before the public native copy");
      assertEquals(Array.from(Deno.readDirSync(`${hby.db.path}/payloads/staging`)).length, 0);
      hby.db.enst.sdb.removeSync(extra);
      await stageNests(hby.db, stage, [first]);
      hby.db.enstStaging.sdb.putSync(suffix(b(stage), 1), new Uint8Array(MAX_NESTED_WIRE_BYTES));
      assertThrows(
        () => hby.db.env!.transactionSync(() => publishNests(hby.db, owner.said!, stage)),
        ResourceLimitError,
      );
      assertEquals(hby.db.getValBounded(hby.db.enst.sdb, key, MAX_NESTED_WIRE_BYTES), original);
      assertEquals(hby.db.getValBounded(hby.db.enst.sdb, extra, MAX_NESTED_WIRE_BYTES), null);
      assertEquals(hby.db.enstStaging.cnt([stage]), 2, "writer failure preserves private rows for cleanup");
      const wire = first.essr!.wire;
      first.essr = {
        ...first.essr!,
        wire: {
          ...wire,
          /** Simulate a corrupted stage arriving during the borrowed input read. */
          async *open(signal) {
            hby.db.enstStaging.sdb.putSync(suffix(b(compare), 0), new Uint8Array(MAX_NESTED_WIRE_BYTES + 1));
            yield* wire.open(signal);
          },
        },
      };
      await assertRejects(() => stageNests(hby.db, compare, [first]), ResourceLimitError);
      const loaded = await loadNests(hby.db, owner.said!, budget());
      await assertTree(loaded[0], first);
      await discardNests(loaded);
    } finally {
      hby.db.enstStaging.rem([stage]);
      hby.db.enstStaging.rem([compare]);
      await discardFrame(first);
    }
  });
});

Deno.test("cancelling nested publication joins readers and preserves a concurrent exchanger publication", async () => {
  await scenario(async (hby, sender, recipient, provider, _director, exchanger) => {
    const nest = await child(sender, "cancel");
    await attachEssr(nest);
    const original = nest.essr!;
    let entered!: () => void;
    const reading = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let closed = false;
    nest.essr = {
      ...original,
      wire: {
        size: original.wire.size,
        /** Block a genuine serializer read until structured cancellation joins it. */
        async *open(signal) {
          try {
            entered();
            await new Promise<void>((_resolve, reject) =>
              signal!.addEventListener("abort", () => reject(signal!.reason), { once: true })
            );
            yield b("");
          } finally {
            assertEquals(exchanger.resources.used.bytes, NESTED_COPY_RESERVATION_BYTES);
            closed = true;
          }
        },
      },
    };
    const input = forward(sender, recipient, provider, nest);
    let continued = false;
    const task = run(function*() {
      yield* exchanger.processEvent(input);
      continued = true;
    });
    await reading;
    assertEquals(exchanger.resources.used.bytes, NESTED_COPY_RESERVATION_BYTES);
    // A second exchanger sharing the Baser publishes the same parent with its own independent stage key.
    const concurrent = new Exchanger(hby, {
      handlers: [new ForwardHandler(_director)],
      resources: exchanger.resources,
    });
    const completed = { ...nest, essr: original };
    assertEquals((await run(() => concurrent.processEvent({ ...input, nests: [completed] }))).kind, "accept");
    const retained = hby.db.enst.get([input.serder.said!]);
    await task.halt();
    assertEquals(closed, true);
    assertEquals(continued, false);
    assertEquals(exchanger.resources.used.bytes, 0);
    assertEquals(hby.db.enst.get([input.serder.said!]), retained);
    assertExists(hby.db.exns.get([input.serder.said!]));
    assertEquals(hby.db.epse.get([input.serder.said!]), null);
    assertEquals(Array.from(hby.db.enstStaging.sdb.getKeys()).length, 0);
    await original.discard();
  });
});

Deno.test("shared nested admission refuses before serialization and guarded row copying", async () => {
  await scenario(async (hby, sender, recipient, provider, director, exchanger) => {
    const nest = await child(sender, "admission");
    await attachEssr(nest);
    const input = forward(sender, recipient, provider, nest);
    const original = nest.essr!.wire.open;
    let opened = 0, copied = 0;
    nest.essr!.wire.open = function(signal) {
      opened++;
      return original.call(this, signal);
    };
    const read = hby.db.getValBounded;
    hby.db.getValBounded = function(...args) {
      copied++;
      return read.apply(this, args);
    };
    const resources = new ResourcePolicy({ bytes: NESTED_COPY_RESERVATION_BYTES - 1 });
    const refused = new Exchanger(hby, { handlers: [new ForwardHandler(director)], resources });
    try {
      const failure = await assertRejects(() => run(() => refused.processEvent(input)), ResourceAdmissionError);
      assertEquals(failure.reason, "limit");
      assertEquals([opened, copied], [0, 0]);
      assertEquals(resources.used.bytes, 0);
      assertEquals(hby.db.enst.get([input.serder.said!]), []);
      assertEquals(hby.db.exns.get([input.serder.said!]), null);
      assertEquals(Array.from(hby.db.enstStaging.sdb.getKeys()).length, 0);
      assertExists(nest.essr); // Failed admission leaves borrowed input ownership intact.
      const occupied = exchanger.resources.reserve({ bytes: 200 * 1024 ** 2 });
      if (occupied.kind !== "reserve") throw new Error("Test credit unavailable");
      const busy = await assertRejects(() => run(() => exchanger.processEvent(input)), ResourceAdmissionError);
      assertEquals(busy.reason, "busy");
      assertEquals([opened, copied], [0, 0]);
      occupied.reservation.release();
      assertEquals((await run(() => exchanger.processEvent(input))).kind, "accept");
      assertEquals(exchanger.resources.used.bytes, 0);
      copied = 0;
      await assertRejects(() => refused.replay(input.serder.said!).next(), ResourceAdmissionError);
      assertEquals(copied, 0);
      assertEquals(resources.used.bytes, 0);
    } finally {
      hby.db.getValBounded = read;
      await discardFrame(nest);
    }
  });
});

Deno.test("shared nested replay retains copy and frame credit until payload disposal joins", async () => {
  await scenario(async (hby, sender, recipient, provider, director, exchanger) => {
    const nest = await child(sender, "replay-owner");
    await attachEssr(nest);
    const input = forward(sender, recipient, provider, nest);
    assertEquals((await run(() => exchanger.processEvent(input))).kind, "accept");
    const archive = await hby.db.openPayloads();
    const stage = archive.files.stage;
    let failDisposal = false;
    let startDisposal!: () => void, finishDisposal!: () => void;
    const disposing = new Promise<void>((resolve) => {
      startDisposal = resolve;
    });
    const joined = new Promise<void>((resolve) => {
      finishDisposal = resolve;
    });
    archive.files.stage = async function(...args) {
      const sink = await stage.apply(this, args);
      const finish = sink.finish.bind(sink);
      sink.finish = async () => {
        const owner = await finish();
        assertEquals(archive.files.owns(owner), true); // Credit never wraps away adoptable FilePayload identity.
        const discard = owner.discard.bind(owner);
        owner.discard = async () => {
          startDisposal();
          await joined;
          await discard();
          if (failDisposal) throw new Error("cleanup failed");
        };
        return owner;
      };
      return sink;
    };
    const resources = new ResourcePolicy({ bytes: 160 * 1024 ** 2 });
    const reader = new Exchanger(hby, { resources });
    const competing = new Exchanger(hby, { handlers: [new ForwardHandler(director)], resources });
    const replay = reader.replay(input.serder.said!);
    try {
      assertEquals((await replay.next()).done, false);
      const held = resources.used.bytes;
      assertEquals(held > NESTED_COPY_RESERVATION_BYTES, true);
      const busy = await assertRejects(() => run(() => competing.processEvent(input)), ResourceAdmissionError);
      assertEquals(busy.reason, "busy");
      const closing = replay.return(undefined);
      await disposing;
      assertEquals(resources.used.bytes, held);
      finishDisposal();
      await closing;
      assertEquals(resources.used.bytes, 0);
      await replay.return(undefined);
      assertEquals(resources.used.bytes, 0);
      assertEquals(Array.from(Deno.readDirSync(`${hby.db.path}/payloads/staging`)).length, 0);
      failDisposal = true;
      const failing = reader.replay(input.serder.said!);
      assertEquals((await failing.next()).done, false);
      await assertRejects(() => failing.return(undefined), AggregateError, "Nested payload cleanup failed");
      assertEquals(resources.used.bytes, 0);
      assertEquals(Array.from(Deno.readDirSync(`${hby.db.path}/payloads/staging`)).length, 0);
    } finally {
      finishDisposal();
      await replay.return(undefined);
      archive.files.stage = stage;
      await discardFrame(nest);
    }
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
      assertEquals(Array.from(hby.db.enstStaging.sdb.getKeys()).length, 0);
      // Existing signature escrow without children must not adopt failed provisional evidence.
      const another = forward(sender, recipient, provider, await child(sender, "pending"));
      hby.db.epse.pin([another.serder.said!], another.serder);
      await assertRejects(() => run(() => exchanger.processEvent(another)), Error, "publication fault");
      assertExists(hby.db.epse.get([another.serder.said!]));
      assertEquals(hby.db.exns.get([another.serder.said!]), null);
      assertEquals(hby.db.enst.get([another.serder.said!]), []);
      assertEquals(Array.from(hby.db.enstStaging.sdb.getKeys()).length, 0);
    } finally {
      metadata.pin = pin;
    }
  });
});

Deno.test("nested recovery removes abandoned staging and unowned wire, retaining Python rows until escrow expiry", async () => {
  await scenario(async (hby, sender, recipient, provider, _director, exchanger) => {
    const nest = await child(sender, "recover");
    const input = forward(sender, recipient, provider, nest);
    assertEquals((await run(() => exchanger.processEvent({ ...input, tsgs: [] }))).kind, "escrow");
    const retained = hby.db.enst.get([input.serder.said!]);
    // Simulate process interruption at both private staging and historical unowned public-row boundaries.
    await stageNests(hby.db, input.serder.said!, [{ ...nest, attachments: [] }]);
    hby.db.enst.add(["orphan"], retained[0]);
    hby.db.exchangeMeta.rem([input.serder.said!]);
    await run(function*() {
      yield* hby.db.reopen();
    });
    await hby.db.openPayloads();
    assertEquals(Array.from(hby.db.enstStaging.sdb.getKeys()).length, 0);
    assertEquals(hby.db.enst.get(["orphan"]), []);
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
    const runtime = yield* createAgentRuntime(hby, {
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
        collectPayload(
          framePayload({
            body: input.serder,
            attachments: messageAttachmentGroups({ tsgs: [group(0)] }, Vrsn_2_0),
            nests: [nest],
            gvrsn: Vrsn_2_0,
          }),
          8192,
        )
      );
      yield* runtime.reactor.processBytes(first, { mailboxAid: provider.pre });
      assertEquals([hby.db.exns.get(input.serder.said!), hby.db.exns.get(nest.body.said!)], [null, null]);
      assertExists(hby.db.pmkm.get(key));
      yield* hby.db.reopen();
      const [retry] = yield* call(() =>
        collectPayload(
          framePayload({
            body: input.serder,
            attachments: messageAttachmentGroups({ tsgs: [group(1)] }, Vrsn_2_0),
            nests: [nest],
            gvrsn: Vrsn_2_0,
          }),
          8192,
        ).then(parseBytes)
      );
      yield* runtime.reactor.settle(retry, { mailboxAid: provider.pre }, function*(ready) {
        assertEquals(ready!.nests[0].body.raw, nest.body.raw);
        assertEquals(yield* call(() => collectPayload(ready!.nests[0].essr!.wire, 1024)), wire);
        assertEquals(hby.db.pmkm.get(key), null, "acceptance retires partial state before transport callback");
        assertEquals(hby.db.exns.get(nest.body.said!), null);
      });
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
      yield* call(() => discardFrame(nest));
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});

Deno.test("EXN pending cue credit survives joined nested cleanup and rejects changed membership before publication", async () => {
  await scenario(async (hby, sender, recipient, provider) => {
    for (const exit of ["cancel", "changed"] as const) {
      const nest = await child(sender, `pending-${exit}`);
      await attachEssr(nest);
      const original = nest.essr!;
      const resources = new ResourcePolicy(), cues = new CueDeck(resources, 1);
      const handlers = [{
        resource: "/fwd",
        acceptsNests: true,
        verify() {
          return { kind: "escrow" as const, reason: "proof unavailable" };
        },
        handle() {
          throw new Error("Pending exchange cannot dispatch");
        },
      }];
      const exchanger = new Exchanger(hby, { resources, cues, handlers });
      let entered!: () => void, finishRead!: () => void, cleanupEntered!: () => void, release!: () => void;
      const reading = new Promise<void>((resolve) => entered = resolve);
      const proceed = new Promise<void>((resolve) => finishRead = resolve);
      const cleaning = new Promise<void>((resolve) => cleanupEntered = resolve);
      const cleanup = new Promise<void>((resolve) => release = resolve);
      let held = 0;
      nest.essr = {
        ...original,
        wire: {
          size: original.wire.size,
          /** Hold a real serializer reader so cancellation must join its cleanup. */
          async *open(signal) {
            try {
              held = resources.used.bytes;
              assertEquals(held > NESTED_COPY_RESERVATION_BYTES, true);
              entered();
              await Promise.race([
                proceed,
                new Promise<void>((_resolve, reject) => {
                  signal!.addEventListener("abort", () => reject(signal!.reason), { once: true });
                }),
              ]);
              yield* original.wire.open(signal);
            } finally {
              cleanupEntered();
              await cleanup;
              assertEquals(resources.used.bytes >= held, true);
            }
          },
        },
      };
      const input = forward(sender, recipient, provider, nest), said = input.serder.said!;
      const completed = { ...input, nests: [{ ...nest, essr: original }] };
      const task = run(() => exchanger.processEvent(input));
      await reading;
      cues.clear();
      assertThrows(() => cues.push({ kin: "proof", said: "occupied" }), DeckFullError);
      assertEquals(hby.db.epse.get([said]), null);
      assertEquals(hby.db.exchangeMeta.get([said]), null);
      if (exit === "cancel") {
        let joined = false;
        const halting = task.halt().then(() => joined = true);
        await cleaning;
        assertEquals(joined, false);
        assertEquals(resources.used.bytes, held);
        assertThrows(() => cues.push({ kin: "proof", said: "occupied" }), DeckFullError);
        release();
        await halting;
        assertEquals(resources.used.bytes, 0);
        assertEquals(hby.db.epse.get([said]), null);
        assertEquals(hby.db.exchangeMeta.get([said]), null);
        assertEquals(Array.from(hby.db.enstStaging.sdb.getKeys()).length, 0);
        assertEquals((await run(() => exchanger.processEvent(completed))).kind, "escrow");
        const owner = cues.takeOwned()!;
        assertEquals(owner.cue, { kin: "proof", said });
        assertExists(hby.db.epse.get([said]));
        assertEquals(resources.used.bytes > 0, true);
        owner.release();
        assertEquals(resources.used.bytes, 0);
      } else {
        const otherCues = new CueDeck(resources, 1);
        const other = new Exchanger(hby, { resources, cues: otherCues, handlers });
        assertEquals((await run(() => other.processEvent(completed))).kind, "escrow");
        const retained = hby.db.enst.get([said]), date = hby.db.epsd.get([said])!.dts;
        const meta = hby.db.exchangeMeta.get([said]);
        finishRead();
        await cleaning;
        release();
        await assertRejects(() => task, Error, "escrow membership changed");
        assertEquals(hby.db.enst.get([said]), retained);
        assertEquals(hby.db.epsd.get([said])!.dts, date);
        assertEquals(hby.db.exchangeMeta.get([said]), meta);
        assertEquals(Array.from(hby.db.enstStaging.sdb.getKeys()).length, 0);
        assertEquals(cues.length, 0);
        const owner = otherCues.takeOwned()!;
        assertEquals(owner.cue, { kin: "proof", said });
        assertEquals(resources.used.bytes > 0, true);
        owner.release();
        assertEquals(resources.used.bytes, 0);
      }
      await original.discard();
    }
  });
});
