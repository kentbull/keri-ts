import { assert, assertEquals } from "jsr:@std/assert";
import { decodeHex } from "jsr:@std/encoding/hex";
import { b, concatBytes, decodeB64, t } from "../../../src/core/bytes.ts";
import { collectPayload } from "../../../src/core/payload.ts";
import type { CesrFrame } from "../../../src/core/types.ts";
import { parseBytes } from "../../../src/parser/complete.ts";
import { attachmentPayload, framePayload } from "../../../src/parser/serialize.ts";
import { Counter } from "../../../src/primitives/counter.ts";
import { Siger } from "../../../src/primitives/siger.ts";
import { Texter } from "../../../src/primitives/texter.ts";
import { Verfer } from "../../../src/primitives/verfer.ts";
import depthVector from "../../fixtures/nested-depth.json" with { type: "json" };
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
Deno.test("nested serialization preserves admitted deep trees without adding wrapper levels", async () => {
  const body = decodeHex(depthVector.body);
  for (const input of [b(depthVector.qb64), decodeHex(depthVector.qb2)]) {
    const [frame] = await parseBytes(input);
    assertEquals(nodes(frame).length, depthVector.depth);
    for (const domain of ["txt", "bny"] as const) {
      // A child already has its BWA boundary; adding another wrapper would double the nesting depth.
      const [roundtrip] = await parseBytes(await collectPayload(framePayload(frame, { domain })));
      assertEquals(nodes(roundtrip).length, depthVector.depth);
      for (const node of nodes(roundtrip)) {
        assertEquals(node.body.raw, body);
        const tuple = node.attachments[0].items[0];
        assert(Array.isArray(tuple));
        assert(tuple[0] instanceof Siger);
        assertEquals(tuple[0].qb64, depthVector.signature);
      }
      // Existing signature checks prove each retained signature covers its own body.
      summary(roundtrip);
    }
  }
});

Deno.test("nested serialization preserves signed trees, scoped genera and order across wire domains", async () => {
  for (const row of vectors.rows) {
    for (const encode of [b, decodeB64]) {
      const [frame] = await parseBytes(encode(row.qb64));
      for (const domain of ["txt", "bny"] as const) {
        const output = framePayload(frame, { domain });
        const bytes = await collectPayload(output);
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
          await collectPayload(attachmentPayload(frame, { domain })),
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
        await collectPayload(framePayload(frame, { gvrsn: { major, minor: 0 }, domain })),
      );
      assertEquals(summary(roundtrip), row.tree);
      assertEquals(nodes(roundtrip).map((node) => node.gvrsn?.major), [major, major, major]);
    }
  }
});

Deno.test("nested children without evidence retain an explicit empty attachment counter", async () => {
  const [frame] = await parseBytes(b(vectors.rows[0].qb64));
  frame.nests![0].attachments = [];
  const [roundtrip] = await parseBytes(await collectPayload(framePayload(frame)));
  assertEquals(roundtrip.nests![0].body.raw, frame.nests![0].body.raw);
  assertEquals(roundtrip.nests![0].attachments.length, 1);
  assertEquals(roundtrip.nests![0].attachments[0].items.length, 0);
  assertEquals(summary(roundtrip.nests![1]), summary(frame.nests![1]));
});
Deno.test("nested ESSR serialization preserves ordered duplicates across repeated reads and both domains", async () => {
  const [frame] = parseBytes(b(vectors.rows.find((row) => row.name === "deep")!.qb64));
  for (const node of nodes(frame)) {
    node.essrs = ["abc", "abc", "xyz"].map((raw) => new Texter({ raw: b(raw), code: "4B" }));
  }
  for (const domain of ["txt", "bny"] as const) {
    const payload = framePayload(frame, { domain });
    const first = await collectPayload(payload);
    assertEquals(await collectPayload(payload), first);
    const [roundtrip] = parseBytes(first);
    assertEquals(summary(roundtrip), summary(frame));
    for (const node of nodes(roundtrip)) {
      assertEquals(node.essrs?.length, 3);
      assertEquals(t(concatBytes(...node.essrs!.map((part) => part.raw))), "abcabcxyz");
    }
  }
});
