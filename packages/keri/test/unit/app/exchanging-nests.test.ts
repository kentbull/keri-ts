/** Real forwarding admission, durable child evidence, and ownership at failure/replay boundaries. */
import {
  b,
  type CesrFrame,
  collectPayload,
  concatBytes,
  Dater,
  Diger,
  discardFrame,
  type EssrPayload,
  essrPayload,
  MemoryPayloadSink,
  nestedPayload,
  parse,
  parseBytes,
  Prefixer,
  ResourceLimitError,
  SerderKERI,
  Vrsn_1_0,
  Vrsn_2_0,
} from "cesr-ts";
import { call, run, suspend } from "effection";
import { assertEquals, assertExists, assertRejects, assertStrictEquals, assertThrows } from "jsr:@std/assert";
import depthVector from "../../../../cesr/test/fixtures/nested-depth.json" with { type: "json" };
import { type ExchangeInput, Exchanger } from "../../../src/app/exchanging.ts";
import { ForwardHandler } from "../../../src/app/forwarding.ts";
import { createHabery, type Hab, type Habery } from "../../../src/app/habbing.ts";
import { MailboxDirector } from "../../../src/app/mailbox-director.ts";
import { openMailboxerForHabery } from "../../../src/app/mailboxing.ts";
import { dispatchEnvelope, envelopeFromFrame } from "../../../src/app/parsering.ts";
import { KeriDispatchEnvelope, TransIdxSigGroup } from "../../../src/core/dispatch.ts";
import { exchange } from "../../../src/core/protocol-exchanging.ts";
import { serializeMessage } from "../../../src/core/protocol-serialization.ts";
import { chargeNests, discardNests, loadNests, publishNests, stageNests } from "../../../src/db/exchange-nests.ts";
import { MAX_NESTED_WIRE_BYTES } from "../../../src/db/exchange-nests.ts";
import {
  removeKramSnapshot,
  snapshotKram,
  storeKramSnapshot,
  withKramHydration,
} from "../../../src/db/kram-snapshots.ts";
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
    // A second exchanger sharing the Baser publishes the same parent with its own independent stage key.
    const concurrent = new Exchanger(hby, { handlers: [new ForwardHandler(_director)] });
    const completed = { ...nest, essr: original };
    assertEquals((await run(() => concurrent.processEvent({ ...input, nests: [completed] }))).kind, "accept");
    const retained = hby.db.enst.get([input.serder.said!]);
    await task.halt();
    assertEquals(closed, true);
    assertEquals(continued, false);
    assertEquals(hby.db.enst.get([input.serder.said!]), retained);
    assertExists(hby.db.exns.get([input.serder.said!]));
    assertEquals(hby.db.epse.get([input.serder.said!]), null);
    assertEquals(Array.from(hby.db.enstStaging.sdb.getKeys()).length, 0);
    await original.discard();
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

Deno.test("private KRAM snapshots reopen scalar factors and independent children without accepting wire", async () => {
  await scenario(async (hby, sender, recipient, provider) => {
    const nest = await child(sender, "partial-child");
    const input = forward(sender, recipient, provider, nest);
    const [parent] = await parseBytes(
      serializeMessage(input.serder, { tsgs: input.tsgs, gvrsn: Vrsn_2_0, genusify: true }),
    );
    parent.nests = [nest];
    const originalWire = await attachEssr(parent), childWire = await attachEssr(nest);
    const incoming = envelopeFromFrame(parent), key = [sender.pre, parent.body.said!];
    const snapshot = await run(() => snapshotKram(incoming));
    assertExists(snapshot);
    hby.db.env!.transactionSync(() => {
      hby.db.pmkm.pin(key, input.serder);
      hby.db.pmks.put(key, input.tsgs![0].sigers);
      storeKramSnapshot(hby.db, key, snapshot);
    });
    const retry = new KeriDispatchEnvelope({ serder: input.serder, attachmentGroups: [], local: false });
    assertEquals(await run(() => snapshotKram(retry)), undefined);
    storeKramSnapshot(hby.db, key, undefined);
    assertEquals(hby.db.kpnd.get(key), snapshot);
    await discardFrame(parent);
    await run(() => hby.db.reopen());
    let owned!: EssrPayload;
    await run(() =>
      withKramHydration(hby.db, key, retry, function*(restored) {
        assertEquals(restored.sigers.map((sig) => sig.qb64), input.tsgs![0].sigers.map((sig) => sig.qb64));
        assertEquals(restored.tsgs, [], "snapshot parent signatures are not reconstructed into scalar factors");
        assertEquals(restored.nests[0].body.raw, nest.body.raw);
        assertEquals(restored.nests[0].attachments, nest.attachments);
        assertEquals(yield* call(() => collectPayload(restored.nests[0].essr!.wire, 1024)), childWire);
        owned = restored.essr!;
        assertEquals(yield* call(() => collectPayload(owned.wire, 1024)), originalWire);
        assertEquals(yield* call(() => collectPayload(owned.raw, 1024)), b("abcabcxyz"));
        assertEquals(hby.db.exns.get([parent.body.said!]), null);
        assertEquals(hby.db.exns.get([nest.body.said!]), null);
        assertEquals(hby.db.enst.get([parent.body.said!]), []);
      })
    );
    await assertRejects(() => collectPayload(owned.wire, 1024));
    for (const failConsumer of [false, true]) {
      let disposals = 0;
      const failure = await assertRejects(() =>
        run(() =>
          withKramHydration(hby.db, key, retry, function*(restored) {
            const discard = restored.essr!.discard.bind(restored.essr);
            restored.essr!.discard = async () => {
              disposals++;
              await discard();
              throw new Error("owner disposal fault");
            };
            if (failConsumer) throw new Error("consumer fault");
          })
        ), AggregateError);
      assertEquals(disposals, 1);
      if (failConsumer) assertEquals((failure.cause as Error).message, "consumer fault");
      assertEquals(Array.from(Deno.readDirSync(`${hby.db.path}/payloads/staging`)).length, 0);
    }
    const fresh = await child(sender, "fresh");
    await attachEssr(fresh);
    const freshInput = new KeriDispatchEnvelope({ ...retry, attachmentGroups: [], nests: [fresh], essr: fresh.essr });
    await run(() =>
      withKramHydration(hby.db, key, freshInput, function*(restored) {
        assertStrictEquals(restored.nests, freshInput.nests);
        assertStrictEquals(restored.essr, freshInput.essr);
      })
    );
    assertEquals(await collectPayload(fresh.essr!.wire, 1024), childWire);
    await discardFrame(fresh);
    for (const bad of [concatBytes(snapshot, snapshot), snapshot.slice(0, -4)]) {
      storeKramSnapshot(hby.db, key, bad);
      await assertRejects(() => run(() => withKramHydration(hby.db, key, retry, function*() {})));
      assertEquals(Array.from(Deno.readDirSync(`${hby.db.path}/payloads/staging`)).length, 0);
    }
    storeKramSnapshot(hby.db, key, snapshot);
    await assertRejects(
      () =>
        run(() =>
          withKramHydration(
            hby.db,
            key,
            new KeriDispatchEnvelope({
              ...retry,
              attachmentGroups: [],
              serder: exchange("/different", {}, { sender: sender.pre, pvrsn: Vrsn_2_0 })[0],
            }),
            function*() {},
          )
        ),
      Error,
      "body mismatch",
    );
    assertEquals(Array.from(Deno.readDirSync(`${hby.db.path}/payloads/staging`)).length, 0);
    assertThrows(() => storeKramSnapshot(hby.db, key, new Uint8Array(MAX_NESTED_WIRE_BYTES + 1)), ResourceLimitError);
    assertEquals(hby.db.kpnd.get(key), snapshot);
    await assertRejects(() =>
      run(() =>
        snapshotKram(
          new KeriDispatchEnvelope({
            ...incoming,
            attachmentGroups: Array(4097).fill(incoming.attachmentGroups[0]),
          }),
        )
      ), ResourceLimitError);
    await assertRejects(() =>
      run(() =>
        snapshotKram(
          new KeriDispatchEnvelope({
            ...incoming,
            attachmentGroups: [],
            essr: { ...incoming.essr!, count: 16385 },
          }),
        )
      ), ResourceLimitError);
    const invalid = { ...incoming.essr!, count: NaN };
    for (const nested of [false, true]) {
      await assertRejects(() =>
        run(() =>
          snapshotKram(
            new KeriDispatchEnvelope({
              ...incoming,
              attachmentGroups: [],
              essr: nested ? undefined : invalid,
              nests: nested ? [{ ...nest, essr: invalid }] : [],
            }),
          )
        ), RangeError);
    }
    removeKramSnapshot(hby.db, key);
    assertEquals(hby.db.kpnd.get(key), null);
    assertExists(hby.db.pmkm.get(key));
  });
});

Deno.test("KRAM snapshot cancellation joins serialization and every scoped owner before returning", async () => {
  await scenario(async (hby, sender, recipient, provider) => {
    const nest = await child(sender, "cancel-private");
    const wire = await attachEssr(nest), owner = nest.essr!;
    const input = forward(sender, recipient, provider, nest);
    const incoming = new KeriDispatchEnvelope({
      serder: input.serder,
      nests: input.nests,
      attachmentGroups: [],
      local: false,
    });
    const key = [sender.pre, input.serder.said!];
    let entered!: () => void, abort!: () => void, release!: () => void;
    const reading = new Promise<void>((resolve) => entered = resolve);
    const aborted = new Promise<void>((resolve) => abort = resolve);
    const cleanup = new Promise<void>((resolve) => release = resolve);
    let closed = false, published = false;
    nest.essr = {
      ...owner,
      wire: {
        size: owner.wire.size,
        /** Gate a real serializer read and its cleanup across cancellation. */
        async *open(signal) {
          entered();
          try {
            await new Promise<void>((resolve) =>
              signal!.addEventListener("abort", () => {
                abort();
                resolve();
              }, { once: true })
            );
            signal!.throwIfAborted();
            yield b("");
          } finally {
            await cleanup;
            closed = true;
          }
        },
      },
    };
    const task = run(function*() {
      const snapshot = yield* snapshotKram(incoming);
      storeKramSnapshot(hby.db, key, snapshot);
      published = true;
    });
    await reading;
    let halted = false;
    const halting = task.halt().then(() => halted = true);
    await aborted;
    assertEquals([halted, closed, published], [false, false, false]);
    release();
    await halting;
    assertEquals([closed, published], [true, false]);
    assertEquals(hby.db.kpnd.get(key), null);
    assertEquals(await collectPayload(owner.wire, 1024), wire, "serialization borrows incoming owners");
    nest.essr = owner;
    storeKramSnapshot(hby.db, key, await run(() => snapshotKram(incoming)));
    let hydrated!: () => void, discarding!: () => void, dispose!: () => void;
    const ready = new Promise<void>((resolve) => hydrated = resolve);
    const disposing = new Promise<void>((resolve) => discarding = resolve);
    const disposed = new Promise<void>((resolve) => dispose = resolve);
    const retry = new KeriDispatchEnvelope({ serder: input.serder, attachmentGroups: [], local: false });
    const consumer = run(() =>
      withKramHydration(hby.db, key, retry, function*(restored) {
        const reopened = restored.nests[0].essr!, discard = reopened.discard.bind(reopened);
        reopened.discard = async () => {
          discarding();
          await disposed;
          await discard();
        };
        hydrated();
        yield* suspend();
      })
    );
    await ready;
    let joined = false;
    const stopping = consumer.halt().then(() => joined = true);
    await disposing;
    assertEquals(joined, false);
    assertEquals(Array.from(Deno.readDirSync(`${hby.db.path}/payloads/staging`)).length, 1);
    dispose();
    await stopping;
    assertEquals(Array.from(Deno.readDirSync(`${hby.db.path}/payloads/staging`)).length, 0);
    assertExists(hby.db.kpnd.get(key), "scope exit does not consume durable pending wire");
    await discardFrame(nest);
  });
});

Deno.test("cancelling private KRAM hydration joins parser writes and deletes unfinished owned files", async () => {
  await scenario(async (hby, sender, recipient, provider) => {
    const nest = await child(sender, "cancel-parse");
    await attachEssr(nest);
    const input = forward(sender, recipient, provider, nest), key = [sender.pre, input.serder.said!];
    const incoming = new KeriDispatchEnvelope({
      serder: input.serder,
      nests: input.nests,
      attachmentGroups: [],
      local: false,
    });
    storeKramSnapshot(hby.db, key, await run(() => snapshotKram(incoming)));
    const files = (await hby.db.openPayloads()).files, stage = files.stage.bind(files);
    let writing!: () => void, aborted!: () => void, release!: () => void;
    const entered = new Promise<void>((resolve) => writing = resolve);
    const stopped = new Promise<void>((resolve) => aborted = resolve);
    const cleanup = new Promise<void>((resolve) => release = resolve);
    let closed = false, continued = false;
    /** Block an actual private file sink write while the parser owns its unfinished stage. */
    files.stage = async (limit, signal) => {
      const sink = await stage(limit, signal);
      sink.write = async () => {
        writing();
        try {
          await new Promise<void>((resolve) =>
            signal!.addEventListener("abort", () => {
              aborted();
              resolve();
            }, { once: true })
          );
          signal!.throwIfAborted();
        } finally {
          await cleanup;
          closed = true;
        }
      };
      return sink;
    };
    const retry = new KeriDispatchEnvelope({ serder: input.serder, attachmentGroups: [], local: false });
    const task = run(function*() {
      yield* withKramHydration(hby.db, key, retry, function*() {});
      continued = true;
    });
    try {
      await entered;
      let halted = false;
      const halting = task.halt().then(() => halted = true);
      await stopped;
      assertEquals([halted, closed, continued], [false, false, false]);
      release();
      await halting;
      assertEquals([closed, continued], [true, false]);
      assertEquals(Array.from(Deno.readDirSync(`${hby.db.path}/payloads/staging`)).length, 0);
      assertExists(hby.db.kpnd.get(key));
      assertEquals(await collectPayload(nest.essr!.raw, 1024), b("abcabcxyz"));
    } finally {
      release();
      await task.halt();
      files.stage = stage;
      await discardFrame(nest);
    }
  });
});
