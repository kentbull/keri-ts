import { assert, assertEquals, assertThrows } from "jsr:@std/assert";
import { b, decodeB64, t } from "../../../src/core/bytes.ts";
import { ColdStartError, ShortageError } from "../../../src/core/errors.ts";
import type { CesrFrame } from "../../../src/core/types.ts";
import { parseBytes } from "../../../src/parser/complete.ts";
import { parse } from "../../../src/parser/parser.ts";
import { Counter } from "../../../src/primitives/counter.ts";
import { Siger } from "../../../src/primitives/siger.ts";
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
Deno.test("attachment GenericGroups and wrapper-only siblings remain invalid", () => {
  const child = vectors.rows[0].qb64;
  for (const encode of [b, decodeB64]) {
    for (const wire of [vectors.invalidGeneric.qb64, groupV2("-B", child + child), groupV2("-B", "")]) {
      assertThrows(() => parseBytes(encode(wire)), ColdStartError);
    }
  }
});
Deno.test("nested trees wait for their complete enclosing group in both domains", async () => {
  const row = vectors.rows[0];
  for (const encode of [b, decodeB64]) {
    const bytes = encode(groupV2("-A", row.qb64 + row.qb64));
    const gate = Promise.withResolvers<void>();
    const waiting = Promise.withResolvers<void>();
    const parser = parse((async function*() {
      yield bytes.slice(0, -3);
      waiting.resolve();
      await gate.promise;
      yield bytes.slice(-3);
    })());
    let delivered = false;
    const first = parser.next().then((value) => {
      delivered = true;
      return value;
    });
    try {
      await waiting.promise;
      assertEquals(delivered, false);
    } finally {
      gate.resolve();
    }
    assertEquals(summary((await first).value!), row.tree);
    assertEquals(summary((await parser.next()).value!), row.tree);
    assertEquals((await parser.next()).done, true);
    assertThrows(() => parseBytes(bytes.slice(0, -3)), ShortageError);
  }
});

/** Replace the outer wrapper while preserving a fixture's body and signatures. */
function content(wire: string): string {
  const counter = new Counter({ qb64: wire, version: { major: 2, minor: 0 } });
  return wire.slice(counter.fullSize);
}
Deno.test("closed attachments cannot absorb later evidence or a second unwrapped body", () => {
  const raw = content(vectors.rows[0].qb64);
  const parent = raw.slice(0, raw.indexOf("-B"));
  const signature = parent.slice(-92);
  const body = parent.slice(0, -92);
  for (const encode of [b, decodeB64]) {
    for (const tail of [signature, body + signature]) {
      assertThrows(
        () => parseBytes(encode(groupV2("-B", body + groupV2("-C", signature) + tail))),
        ColdStartError,
      );
    }
  }
});
