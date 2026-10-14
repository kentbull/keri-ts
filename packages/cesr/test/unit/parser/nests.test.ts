import { assert, assertEquals, assertRejects } from "jsr:@std/assert";
import { b, decodeB64, t } from "../../../src/core/bytes.ts";
import { ColdStartError, ResourceLimitError, ShortageError } from "../../../src/core/errors.ts";
import { discardFrame } from "../../../src/core/frame.ts";
import { collectPayload, MemoryPayloadSink, type PayloadSink } from "../../../src/core/payload.ts";
import { ResourcePolicy } from "../../../src/core/resource-policy.ts";
import type { CesrFrame } from "../../../src/core/types.ts";
import { parseBytes } from "../../../src/parser/complete.ts";
import { parse, type ParseOptions } from "../../../src/parser/progressive.ts";
import { Counter } from "../../../src/primitives/counter.ts";
import { Siger } from "../../../src/primitives/siger.ts";
import { Texter } from "../../../src/primitives/texter.ts";
import { Verfer } from "../../../src/primitives/verfer.ts";
import { groupV2 } from "../../fixtures/counter-token-fixtures.ts";
import vectors from "../../fixtures/nested-vectors.json" with { type: "json" };

/** Split the caller's finite fixture into owned input chunks. */
async function* chunks(...parts: Uint8Array[]): AsyncGenerator<Uint8Array> {
  yield* parts;
}

/** Match the independent Python tree without relying on TS-derived expected values. */
function summary(frame: CesrFrame): unknown {
  return {
    sad: frame.body.ked,
    sigers: frame.attachments.flatMap((group) =>
      group.items.map((item) => {
        assert(Array.isArray(item));
        const siger = item[0];
        assert(siger instanceof Siger);
        assert(new Verfer({ qb64: vectors.signer }).verify(siger.raw, frame.body.raw));
        return siger.qb64;
      })
    ),
    nests: (frame.nests ?? []).map(summary),
  };
}

Deno.test("Python signed nested trees retain each body and signature in both domains", async () => {
  for (const row of vectors.rows) {
    for (const bytes of [b(row.qb64), Uint8Array.from(row.qb2.match(/../g)!, (part) => parseInt(part, 16))]) {
      const frames = await parseBytes(bytes);
      assertEquals(frames.length, 1, row.name);
      assertEquals(summary(frames[0]), row.tree, row.name);
      assertEquals(frames[0].gvrsn?.major, row.name === "genus1-tree" ? 1 : 2);
      if (row.name === "child-genus-selector") {
        assertEquals(frames[0].nests?.map((child) => child.gvrsn?.major), [1, 2]);
      }
      const streamed: CesrFrame[] = [];
      for await (const frame of parse(chunks(...Array.from(bytes, (byte) => Uint8Array.of(byte))))) {
        streamed.push(frame);
      }
      assertEquals(streamed.length, 1);
      assertEquals(summary(streamed[0]), row.tree);
    }
  }
});

Deno.test("signed parent and two children are invariant at every byte split", async () => {
  for (
    const row of vectors.rows.filter((row) =>
      ["CESR-v2", "deep", "child-genus-selector", "genus1-tree"].includes(row.name)
    )
  ) {
    for (const encode of [b, decodeB64]) {
      const bytes = encode(row.qb64);
      for (let split = 0; split <= bytes.length; split++) {
        const frames: CesrFrame[] = [];
        for await (const frame of parse(chunks(bytes.slice(0, split), new Uint8Array(), bytes.slice(split)))) {
          frames.push(frame);
        }
        assertEquals(frames.length, 1);
        assertEquals(summary(frames[0]), row.tree);
      }
    }
  }
});

Deno.test("attachment GenericGroups and wrapper-only siblings remain invalid", async () => {
  const child = vectors.rows[0].qb64;
  for (const encode of [b, decodeB64]) {
    for (const wire of [vectors.invalidGeneric.qb64, groupV2("-B", child + child), groupV2("-B", "")]) {
      await assertRejects(() => parseBytes(encode(wire)), ColdStartError);
    }
  }
});

Deno.test("parent completion waits for later children and independent siblings stay progressive", async () => {
  const row = vectors.rows[0];
  for (const encode of [b, decodeB64]) {
    const bytes = encode(groupV2("-A", row.qb64 + row.qb64));
    const prefix = encode(groupV2("-A", row.qb64 + row.qb64).slice(0, -8));
    const gate = Promise.withResolvers<void>();
    const parser = parse((async function*() {
      yield prefix;
      await gate.promise;
      yield bytes.slice(prefix.length);
    })());
    assertEquals(summary((await parser.next()).value!), row.tree);
    let complete = false;
    const pending = parser.next().then((value) => {
      complete = true;
      return value;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals(complete, false);
    gate.resolve();
    assertEquals(summary((await pending).value!), row.tree);
    assertEquals((await parser.next()).done, true);
    const broken = parse(chunks(encode(groupV2("-A", row.qb64 + row.qb64).slice(0, -4))));
    assertEquals(summary((await broken.next()).value!), row.tree);
    await assertRejects(() => broken.next(), ShortageError);
  }
});

/** Replace the outer wrapper while preserving a fixture's body and signatures. */
function content(wire: string): string {
  const counter = new Counter({ qb64: wire, version: { major: 2, minor: 0 } });
  return wire.slice(counter.fullSize);
}

/** Add ESSR to one independently encoded native parent without changing body signatures. */
function payloadTree(): string {
  const raw = content(vectors.rows[0].qb64);
  const childStart = raw.indexOf("-B");
  const parent = raw.slice(0, childStart);
  const essr = groupV2("-Z", new Texter({ raw: b("abc"), code: "4B" }).qb64);
  const childWire = raw.slice(childStart);
  const first = new Counter({ qb64: childWire, version: { major: 2, minor: 0 } });
  const child = childWire.slice(0, first.fullSize + first.count * 4);
  return groupV2("-B", parent + essr + groupV2("-B", content(child) + essr) + groupV2("-B", content(child) + essr));
}

/** Observe actual stage/owner transitions, including deliberate finalization failures. */
function tracking(failFinish = 0, failDiscard = 0) {
  const records: { writes: number; finished: number; aborted: number; discarded: number }[] = [];
  /** Create a separate finite sink for each message while recording its lifetime. */
  const factory = (limit: number, signal?: AbortSignal): PayloadSink => {
    const sink = new MemoryPayloadSink(limit, signal);
    const record = { writes: 0, finished: 0, aborted: 0, discarded: 0 };
    records.push(record);
    const index = records.length;
    return {
      /** Count admitted writes before delegating the real storage operation. */
      write(bytes) {
        record.writes += bytes.length;
        return sink.write(bytes);
      },
      /** Fail at a chosen owner transition to check sibling cleanup. */
      async finish() {
        if (index === failFinish) throw new Error("finish failure");
        record.finished++;
        const owner = await sink.finish();
        return {
          size: owner.size,
          /** Reopen the retained wire without transferring ownership. */
          open: (signal) => owner.open(signal),
          /** Count owner release and optionally fail after the real discard. */
          async discard() {
            record.discarded++;
            await owner.discard();
            if (index === failDiscard) throw new Error("discard failure");
          },
        };
      },
      /** Stages that never finished remain independently abortable. */
      abort() {
        record.aborted++;
        return sink.abort();
      },
    };
  };
  return { records, factory };
}

Deno.test("tree limits aggregate descendants before ordinary or ESSR retention", async () => {
  const wire = payloadTree();
  for (
    const options of [
      { maxTreeNodes: 2 },
      { maxAttachmentGroups: 2 },
      { maxFrameBytes: 500 },
      { maxEssrBytes: 8 },
      { maxEssrItems: 2 },
      { maxDepth: 2 },
    ] satisfies ParseOptions[]
  ) {
    const sinks = tracking();
    await assertRejects(() => parseBytes(b(wire), { ...options, payloadSink: sinks.factory }), ResourceLimitError);
    if ("maxEssrBytes" in options || "maxEssrItems" in options) {
      assertEquals(sinks.records[2].writes, 0, "Reject the third payload before any sink retention");
    }
    for (const record of sinks.records) {
      assertEquals(record.finished, 0);
      assertEquals(record.aborted, 1);
    }
  }
  const sinks = tracking();
  const [frame] = await parseBytes(b(wire), {
    maxTreeNodes: 3,
    maxAttachmentGroups: 3,
    maxEssrBytes: 9,
    maxEssrItems: 3,
    payloadSink: sinks.factory,
  });
  assertEquals(frame.nests?.length, 2);
  for (const node of [frame, ...frame.nests!]) assertEquals(t(await collectPayload(node.essr!.raw, 3)), "abc");
  await discardFrame(frame);
  await discardFrame(frame); // Repeated scope cleanup cannot release descendants twice.
  assertEquals(sinks.records.map((record) => [record.finished, record.aborted, record.discarded]), [[1, 0, 1], [
    1,
    0,
    1,
  ], [1, 0, 1]]);
});

Deno.test("malformed later descendants, finish failure and cancellation release every undelivered owner", async () => {
  const wire = payloadTree();
  const bad = content(wire).slice(0, -4) + "!!!!";
  const sinks = tracking();
  await assertRejects(() => parseBytes(b(groupV2("-B", bad)), { payloadSink: sinks.factory }));
  assertEquals(sinks.records.map((record) => [record.finished, record.aborted]), [[0, 1], [0, 1], [0, 1]]);
  const failed = tracking(3);
  await assertRejects(() => parseBytes(b(wire), { payloadSink: failed.factory }), Error, "finish failure");
  assertEquals(failed.records.map((record) => [record.finished, record.aborted, record.discarded]), [[1, 0, 1], [
    1,
    0,
    1,
  ], [0, 1, 0]]);
  const failedBoth = tracking(3, 1);
  const failure = await assertRejects(
    () => parseBytes(b(wire), { payloadSink: failedBoth.factory }),
    AggregateError,
  );
  assertEquals(failure.errors.map((error) => error.message), ["finish failure", "discard failure"]);
  const cancelled = tracking();
  const controller = new AbortController();
  let close = 0;
  let read = 0;
  const source: AsyncIterable<Uint8Array> = {
    /** Stall after a partial tree so abort must close the source and all stages. */
    [Symbol.asyncIterator]() {
      return {
        /** Deliver one partial tree, then wait indefinitely for cancellation. */
        next() {
          return ++read === 1
            ? Promise.resolve({ done: false, value: b(wire.slice(0, -4)) })
            : new Promise<IteratorResult<Uint8Array>>(() => {});
        },
        /** Observe joined iterator shutdown when the parser is aborted. */
        return() {
          close++;
          return Promise.resolve({ done: true, value: undefined });
        },
      };
    },
  };
  const parser = parse(source, { signal: controller.signal, payloadSink: cancelled.factory });
  const pending = parser.next();
  while (read < 2) await new Promise((resolve) => setTimeout(resolve, 0));
  controller.abort();
  await assertRejects(() => pending, DOMException);
  assertEquals(close, 1);
  assertEquals(cancelled.records.map((record) => record.aborted), [1, 1, 1]);
});

Deno.test("collection and recursive discard clean descendants even when another owner fails", async () => {
  const sinks = tracking(0, 1);
  await assertRejects(() => parseBytes(b(payloadTree() + "-B"), { payloadSink: sinks.factory }), AggregateError);
  assertEquals(sinks.records.map((record) => record.discarded), [1, 1, 1]);
});

Deno.test("earlier delivered trees survive a malformed later independent tree", async () => {
  const wire = payloadTree();
  const sinks = tracking();
  const parser = parse(chunks(b(groupV2("-A", wire + wire).slice(0, -4))), { payloadSink: sinks.factory });
  const first = (await parser.next()).value!;
  await assertRejects(() => parser.next(), ShortageError);
  assertEquals(sinks.records.slice(0, 3).map((record) => [record.aborted, record.discarded]), [[0, 0], [0, 0], [0, 0]]);
  assertEquals(sinks.records.slice(3).map((record) => record.aborted), [1, 1, 1]);
  await discardFrame(first);
  assertEquals(sinks.records.slice(0, 3).map((record) => record.discarded), [1, 1, 1]);
});

Deno.test("cancellation while finishing a descendant discards earlier finished owners", async () => {
  const resources = new ResourcePolicy({ bytes: 4096 + 3 * 48 });
  const controller = new AbortController();
  const sinks = tracking();
  let finishes = 0;
  await assertRejects(() =>
    parseBytes(b(payloadTree()), {
      resources,
      maxFrameBytes: 4096,
      maxEssrBytes: 9,
      maxEssrItems: 3,
      signal: controller.signal,
      payloadSink(limit, signal) {
        const sink = sinks.factory(limit, signal);
        return {
          write: (bytes) => sink.write(bytes),
          abort: (reason) => sink.abort(reason),
          async finish() {
            const owner = await sink.finish();
            if (++finishes === 3) controller.abort();
            return owner;
          },
        };
      },
    }), DOMException);
  assertEquals(sinks.records.map((record) => [record.aborted, record.discarded]), [[0, 1], [0, 1], [0, 1]]);
  assertEquals(resources.used.bytes, 0);
});

Deno.test("closed attachments cannot absorb later evidence or a second unwrapped body", async () => {
  const raw = content(vectors.rows[0].qb64);
  const parent = raw.slice(0, raw.indexOf("-B"));
  const signature = parent.slice(-92);
  const body = parent.slice(0, -92);
  for (const encode of [b, decodeB64]) {
    for (const tail of [signature, body + signature]) {
      await assertRejects(
        () => parseBytes(encode(groupV2("-B", body + groupV2("-C", signature) + tail))),
        ColdStartError,
      );
    }
  }
});

Deno.test("ordinary tree bytes count each retained region once and reset between independent siblings", async () => {
  const row = vectors.rows[0];
  for (const encode of [b, decodeB64]) {
    // Three body-with-attachment headers only delimit input; each retained body/signature is charged once.
    const resident = encode(row.qb64).length - encode("-BAA").length * 3;
    assertEquals((await parseBytes(encode(row.qb64), { maxFrameBytes: resident })).length, 1);
    await assertRejects(() => parseBytes(encode(row.qb64), { maxFrameBytes: resident - 1 }), ResourceLimitError);
    assertEquals(
      (await parseBytes(encode(groupV2("-A", row.qb64 + row.qb64)), {
        maxFrameBytes: resident,
        maxTreeNodes: 3,
        maxAttachmentGroups: 3,
      })).length,
      2,
    );
  }
});

Deno.test("shared tree credit follows parent ownership across delivery, failure and disposal", async () => {
  const row = vectors.rows[0];
  const resources = new ResourcePolicy({ bytes: 4096 });
  const options = { resources, maxFrameBytes: 4096 };
  const parser = parse(chunks(b(groupV2("-A", row.qb64 + row.qb64))), options);
  const first = (await parser.next()).value!;
  assertEquals(summary(first), row.tree);
  assertEquals(resources.used.bytes, 4096, "children share the root allowance");
  await assertRejects(() => parseBytes(b(row.qb64), options), ResourceLimitError, "busy");
  // Borrowed children cannot release the enclosing parent's reservation.
  await discardFrame(first.nests![0]);
  assertEquals(resources.used.bytes, 4096);
  await discardFrame(first);
  await discardFrame(first);
  assertEquals(resources.used.bytes, 4096, "a suspended generator still retains its delivered root");
  const second = (await parser.next()).value!;
  assertEquals(summary(second), row.tree);
  assertEquals((await parser.next()).done, true);
  assertEquals(resources.used.bytes, 4096, "parser exit does not dispose a delivered root");
  await discardFrame(second);
  await assertRejects(() => parseBytes(b(row.qb64.slice(0, -4)), options), ShortageError);
  assertEquals(resources.used.bytes, 0);
  await assertRejects(() => parseBytes(b(row.qb64 + row.qb64), options), ResourceLimitError);
  assertEquals(resources.used.bytes, 0, "failed collection releases earlier frames");

  const cleanup = Promise.withResolvers<void>();
  let started = false;
  const staged = new ResourcePolicy({ bytes: 4096 + 3 * 48 });
  const [owned] = await parseBytes(b(payloadTree()), {
    ...options,
    resources: staged,
    maxEssrBytes: 9,
    maxEssrItems: 3,
  });
  const discard = owned.nests![0].essr!.discard;
  owned.nests![0].essr!.discard = async () => {
    started = true;
    await cleanup.promise;
    await discard();
  };
  const disposing = discardFrame(owned);
  assertEquals(started, true);
  assertEquals(staged.used.bytes, 4096 + 3 * 48, "tree and stage credit outlive descendant cleanup");
  cleanup.resolve();
  await disposing;
  assertEquals(staged.used.bytes, 0);
});
