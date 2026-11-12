/** Current Python wires exercise graph admission through the real Exchanger owner. */
import { b, collectPayload, framePayload, parseBytes, SerderACDC } from "cesr-ts";
import { call, run } from "effection";
import { assert, assertEquals, assertExists } from "jsr:@std/assert";
import { Exchanger } from "../../../../src/app/exchanges/exchanging.ts";
import { createHabery } from "../../../../src/app/identity/lmdb-habery.ts";
import { loadIpexHandlers } from "../../../../src/app/ipex/ipexing.ts";
import { dispatchEnvelope, envelopeFromFrame } from "../../../../src/app/protocol/parsering.ts";
import { Schemer } from "../../../../src/core/scheming.ts";
import vectors from "../../../fixtures/keripy-ipex-graph-vectors.json" with { type: "json" };

/**
 * Rows whose recorded 1f0f68a6 outcome upstream KERIpy PR 1757 deliberately changes:
 * the Edge Section is one top-level group, never a leaf or list. The wires stay
 * labeled by their actual source until vectors are regenerated from the port.
 */
const pr1757Outcomes: Readonly<Record<string, string>> = {
  "direct top-level leaf": "reject",
  "edge block list": "reject",
};

for (const recorded of vectors.cases) {
  const row = { ...recorded, outcome: pr1757Outcomes[recorded.name] ?? recorded.outcome };
  Deno.test(`Python IPEX graph: ${row.name}`, async () => {
    await run(function*() {
      const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
      const exchanger = new Exchanger(hby);
      loadIpexHandlers(hby, exchanger);
      try {
        assertEquals(vectors.reference, "1f0f68a6ad44a8d159cbbb2bab7bb243bc7a0337");
        assertExists(vectors.modules["src/keri/acdc/chaining.py"]);
        for (const wire of vectors.wires.slice(0, row.through)) {
          for (const frame of yield* call(() => parseBytes(b(wire)))) {
            yield* dispatchEnvelope(envelopeFromFrame(frame), hby.rvy, hby.kevery);
          }
        }
        for (const key of row.cache) {
          const schema = new Schemer({ sed: vectors.schemas[key as keyof typeof vectors.schemas] });
          hby.db.schema.pin(schema.said, schema);
        }
        const [frame] = yield* call(() => parseBytes(b(row.wire)));
        const nodes = frame.nests!.map((node) => {
          assert(node.body instanceof SerderACDC);
          return node.body;
        });
        const disclosed = structuredClone(nodes.map((node) => node.sad));
        const decision = yield* exchanger.processEvent(envelopeFromFrame(frame));
        assertEquals(
          nodes.map((node) => node.sad),
          disclosed,
          "admission never rewrites borrowed credentials",
        );
        assertEquals(decision.kind, row.outcome, JSON.stringify(decision));
        assertEquals(Boolean(hby.db.exns.get(row.said)), row.outcome === "accept");
        assertEquals(
          Boolean(hby.db.epse!.get(row.said)) || [...hby.db.emse!.getItemIter([row.said])].length > 0,
          row.outcome === "escrow",
        );
        if (row.outcome === "accept") {
          const chunks: Uint8Array[] = [];
          yield* call(async () => {
            for await (const chunk of exchanger.replay(row.said)) chunks.push(chunk);
          });
          const [retained] = yield* call(() => parseBytes(new Uint8Array(chunks.flatMap((chunk) => [...chunk]))));
          assertEquals(retained.body.raw, frame.body.raw);
          for (const [i, node] of (retained.nests ?? []).entries()) {
            assertEquals(
              yield* call(() => collectPayload(framePayload(node))),
              yield* call(() => collectPayload(framePayload(frame.nests![i]))),
              "accepted nested proof bytes remain exact",
            );
            assertEquals(hby.db.exns.get(node.body.said!), null, "child acceptance remains independently owned");
          }
        } else if (row.outcome === "reject") assertEquals(hby.db.enst.get(row.said), []);
      } finally {
        yield* hby.close(true);
      }
    });
  });
}
