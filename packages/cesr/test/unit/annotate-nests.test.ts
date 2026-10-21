import { assert, assertEquals, assertThrows } from "jsr:@std/assert";
import { annotate, annotateFrames } from "../../src/annotate/annotator.ts";
import { denot } from "../../src/annotate/denot.ts";
import { renderAnnotatedFrames } from "../../src/annotate/render.ts";
import { b, concatBytes, t } from "../../src/core/bytes.ts";
import { DeserializeError } from "../../src/core/errors.ts";
import { collectPayload } from "../../src/core/payload.ts";
import type { CesrFrame } from "../../src/core/types.ts";
import { parseBytes } from "../../src/parser/complete.ts";
import { framePayload } from "../../src/parser/serialize.ts";
import { Siger } from "../../src/primitives/crypto/siger.ts";
import { Verfer } from "../../src/primitives/crypto/verfer.ts";
import { Texter } from "../../src/primitives/values/texter.ts";
import { groupV2 } from "../fixtures/counter-token-fixtures.ts";
import vectors from "../fixtures/nested-vectors.json" with { type: "json" };

/** Check the independent Python tree and verify that each signature still covers its own body. */
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

/** Enumerate owned nodes for genus and payload checks without changing their parentage. */
function nodes(frame: CesrFrame): CesrFrame[] {
  return [frame, ...(frame.nests ?? []).flatMap(nodes)];
}

Deno.test("annotation preserves Python nested wire, signatures and scoped genera in both domains", async () => {
  for (const row of vectors.rows) {
    for (const bytes of [b(row.qb64), Uint8Array.from(row.qb2.match(/../g)!, (part) => parseInt(part, 16))]) {
      for (const commentMode of ["inline", "above"] as const) {
        const annotated = await annotateFrames(bytes, { commentMode, indent: 3 });
        assertEquals(annotated.length, 1, row.name);
        assertEquals(annotated[0].index, 1);
        assertEquals(summary(annotated[0].frame), row.tree, row.name);
        const restored = denot(annotated[0].lines.join("\n"));
        // The independent qb64 fixture catches lost, duplicated or reordered bodies, evidence and wrappers.
        assertEquals(t(restored), row.qb64, row.name);
        const [roundtrip] = await parseBytes(restored);
        assertEquals(summary(roundtrip), row.tree);
        assertEquals(nodes(roundtrip).map((node) => node.gvrsn), nodes(annotated[0].frame).map((node) => node.gvrsn));
      }
    }
  }
});

Deno.test("annotation roots follow GenericGroup siblings while descendants retain wrapper indentation", async () => {
  const row = vectors.rows[0];
  const wire = groupV2("-A", groupV2("-A", row.qb64) + row.qb64);
  const annotated = await annotateFrames(wire, { indent: 3 });
  assertEquals(annotated.map((entry) => entry.index), [1, 2]);
  assertEquals(annotated.map((entry) => summary(entry.frame)), [row.tree, row.tree]);
  assertEquals(t(denot(annotated.flatMap((entry) => entry.lines).join("\n"))), wire);
  // The first parent is inside two GenericGroups; its children add one body wrapper level.
  assertEquals(annotated[0].lines.filter((line) => line.includes("FixBodyGroup")).map((line) => line.search(/\S/)), [
    9,
    12,
    12,
  ]);
  assertEquals(annotated[1].lines.filter((line) => line.includes("FixBodyGroup")).map((line) => line.search(/\S/)), [
    6,
    9,
    9,
  ]);
});

Deno.test("annotation requires each hydrated node exactly once within its owning scope", async () => {
  const wire = b(vectors.rows[0].qb64);
  const options = { commentMode: "inline", indent: 2, pretty: false } as const;
  const [frame] = await parseBytes(wire);
  const children = frame.nests!;
  frame.nests = children.slice(0, 1);
  assertThrows(() => renderAnnotatedFrames([frame], options, wire), DeserializeError, "ownership");
  frame.nests = [...children, children[0]];
  assertThrows(() => renderAnnotatedFrames([frame], options, wire), DeserializeError, "every owned child");
  frame.nests = [children[0], children[0]];
  assertThrows(() => renderAnnotatedFrames([frame], options, wire), DeserializeError, "ownership");
  frame.nests = children;
  assertThrows(() => renderAnnotatedFrames([frame, frame], options, wire), DeserializeError, "every parsed root");
});
Deno.test("nested annotation preserves ordinary ESSR values and the exact wire", async () => {
  const [source] = parseBytes(b(vectors.rows[0].qb64));
  for (const node of nodes(source)) node.essrs = [new Texter({ raw: b("abc"), code: "4B" })];
  const wire = await collectPayload(framePayload(source));
  const [entry] = annotateFrames(wire);
  const [restored] = parseBytes(denot(annotate(wire)));
  for (const frame of [entry.frame, restored]) {
    for (const node of nodes(frame)) assertEquals(t(concatBytes(...node.essrs!.map((part) => part.raw))), "abc");
  }
  assertEquals(denot(annotate(wire)), wire);
  assertThrows(() => annotateFrames(wire, { indent: Infinity }), RangeError);
  assertThrows(() => annotateFrames(new Uint8Array([...wire, ...wire.slice(0, -4)])));
});
