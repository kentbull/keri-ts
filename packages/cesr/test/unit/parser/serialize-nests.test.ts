import { assert, assertEquals, assertRejects } from "jsr:@std/assert";
import { b, concatBytes, decodeB64, t } from "../../../src/core/bytes.ts";
import { discardFrame } from "../../../src/core/frame.ts";
import { collectPayload, MemoryPayloadSink } from "../../../src/core/payload.ts";
import type { CesrFrame } from "../../../src/core/types.ts";
import { parseBytes } from "../../../src/parser/complete.ts";
import { essrPayload } from "../../../src/parser/essr.ts";
import { attachmentPayload, framePayload } from "../../../src/parser/serialize.ts";
import { Counter } from "../../../src/primitives/counter.ts";
import { Siger } from "../../../src/primitives/siger.ts";
import { Verfer } from "../../../src/primitives/verfer.ts";
import vectors from "../../fixtures/nested-vectors.json" with { type: "json" };

/** Compare independently generated Python bodies/signatures while verifying their actual ownership. */
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

/** Expose the admitted tree's preorder for genus and payload ownership checks. */
function nodes(frame: CesrFrame): CesrFrame[] {
  return [frame, ...(frame.nests ?? []).flatMap(nodes)];
}

Deno.test("nested serialization preserves signed trees, scoped genera and order across wire domains", async () => {
  for (const row of vectors.rows) {
    for (const encode of [b, decodeB64]) {
      const [frame] = await parseBytes(encode(row.qb64));
      for (const domain of ["txt", "bny"] as const) {
        const output = framePayload(frame, { domain });
        const bytes = await collectPayload(output, 16384);
        assertEquals(bytes.length, output.size);
        const [roundtrip] = await parseBytes(bytes);
        assertEquals(summary(roundtrip), row.tree, row.name);
        assertEquals(nodes(roundtrip).map((node) => node.gvrsn), nodes(frame).map((node) => node.gvrsn));
        // Detached attachments retain the same parent boundary and descendants.
        const selector = Counter.makeGVC(frame.gvrsn!);
        const body = frame.body.kind === "CESR" && domain === "bny" ? decodeB64(t(frame.body.raw)) : frame.body.raw;
        const detached = concatBytes(
          domain === "txt" ? selector : decodeB64(t(selector)),
          body,
          await collectPayload(attachmentPayload(frame, { domain }), 16384),
        );
        assertEquals(summary((await parseBytes(detached))[0]), row.tree, row.name);
      }
    }
  }
});

Deno.test("an explicit serialization genus normalizes every compatible descendant", async () => {
  const row = vectors.rows.find((row) => row.name === "JSON-v1")!;
  const [frame] = await parseBytes(b(row.qb64));
  for (const major of [1, 2] as const) {
    for (const domain of ["txt", "bny"] as const) {
      const [roundtrip] = await parseBytes(
        await collectPayload(framePayload(frame, { gvrsn: { major, minor: 0 }, domain }), 16384),
      );
      assertEquals(summary(roundtrip), row.tree);
      assertEquals(nodes(roundtrip).map((node) => node.gvrsn?.major), [major, major, major]);
    }
  }
});

Deno.test("nested children without evidence retain an explicit empty attachment counter", async () => {
  const [frame] = await parseBytes(b(vectors.rows[0].qb64));
  frame.nests![0].attachments = [];
  const [roundtrip] = await parseBytes(await collectPayload(framePayload(frame), 16384));
  assertEquals(roundtrip.nests![0].body.raw, frame.nests![0].body.raw);
  assertEquals(roundtrip.nests![0].attachments.length, 1);
  assertEquals(roundtrip.nests![0].attachments[0].items.length, 0);
  assertEquals(summary(roundtrip.nests![1]), summary(frame.nests![1]));
});

Deno.test("nested ESSR serialization is lazy and reopenable without transferring or discarding owners", async () => {
  const [frame] = await parseBytes(b(vectors.rows.find((row) => row.name === "deep")!.qb64));
  let opens = 0;
  let discarded = 0;
  for (const node of nodes(frame)) {
    const sink = new MemoryPayloadSink(16);
    await sink.write(b("4BABYWJj4BABeHl6"));
    const owner = await sink.finish();
    node.essr = essrPayload(
      {
        size: owner.size,
        /** Observe lazy readers while retaining the actual reopenable storage owner. */
        open(signal) {
          opens++;
          return owner.open(signal);
        },
        /** Only discardFrame, never serialization, releases this owner. */
        async discard() {
          discarded++;
          await owner.discard();
        },
      },
      2,
      6,
      node.gvrsn!,
    );
  }
  for (const domain of ["txt", "bny"] as const) {
    const before = opens;
    const payload = framePayload(frame, { domain });
    assertEquals(opens, before);
    let previous: Uint8Array | undefined;
    for (let read = 0; read < 2; read++) {
      const wire = await collectPayload(payload, 16384);
      if (previous) assertEquals(wire, previous);
      previous = wire;
      const [roundtrip] = await parseBytes(wire);
      try {
        assertEquals(summary(roundtrip), summary(frame));
        for (const node of nodes(roundtrip)) {
          assertEquals(node.essr?.count, 2);
          assertEquals(t(await collectPayload(node.essr!.raw, 6)), "abcxyz");
        }
      } finally {
        await discardFrame(roundtrip);
      }
    }
  }
  assertEquals(opens, nodes(frame).length * 4);
  assertEquals(discarded, 0);
  await discardFrame(frame);
  assertEquals(discarded, nodes(frame).length);
});

Deno.test("cancellation closes a pending nested ESSR reader and leaves tree owners with the caller", async () => {
  const [frame] = await parseBytes(b(vectors.rows[0].qb64));
  const entered = Promise.withResolvers<void>();
  let closed = 0;
  let discarded = 0;
  frame.nests![0].essr = essrPayload(
    {
      size: 8,
      /** Block a real child read until the shared output signal aborts it. */
      async *open(signal) {
        try {
          entered.resolve();
          await new Promise<void>((_, reject) =>
            signal!.addEventListener("abort", () => reject(signal!.reason), { once: true })
          );
          yield b("4BABYWJj");
        } finally {
          closed++;
        }
      },
      /** Record that cancelling a non-owning view must not dispose its owner. */
      discard() {
        discarded++;
        return Promise.resolve();
      },
    },
    1,
    3,
    frame.nests![0].gvrsn!,
  );
  const controller = new AbortController();
  const payload = framePayload(frame, { domain: "bny" });
  const pending = (async () => {
    for await (const _chunk of payload.open(controller.signal)) { /* Drain to child I/O. */ }
  })();
  await entered.promise;
  controller.abort(new Error("cancel child output"));
  await assertRejects(() => pending, Error, "cancel child output");
  assertEquals(closed, 1);
  assertEquals(discarded, 0);
  await discardFrame(frame);
  assertEquals(discarded, 1);
});
