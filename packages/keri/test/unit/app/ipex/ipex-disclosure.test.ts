/** Current Python-authored wires fix the disclosure contract at actual exchange intake. */
import { b, collectPayload, concatBytes, framePayload, parseBytes } from "cesr-ts";
import { call, run } from "effection";
import { assertEquals } from "jsr:@std/assert";
import { Exchanger } from "../../../../src/app/exchanges/exchanging.ts";
import { createHabery } from "../../../../src/app/identity/habbing.ts";
import { loadIpexHandlers } from "../../../../src/app/ipex/ipexing.ts";
import { dispatchEnvelope, envelopeFromFrame } from "../../../../src/app/protocol/parsering.ts";
import vectors from "../../../fixtures/keripy-ipex-disclosure-vectors.json" with { type: "json" };

Deno.test("IPEX disclosure matches literal Python paths, whole-node checks and exact BFS selection", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const exchanger = new Exchanger(hby);
    loadIpexHandlers(hby, exchanger);
    try {
      assertEquals(vectors.reference, "550f401489488a5fec6e1b847e74bf8312f647ca");
      for (const wire of vectors.wires) {
        for (const frame of parseBytes(b(wire))) {
          yield* dispatchEnvelope(envelopeFromFrame(frame), hby.rvy, hby.kevery);
        }
      }
      const outcomes: { name: string; outcome: string }[] = [];
      for (const row of vectors.cases) {
        const [frame] = parseBytes(b(row.wire));
        const decision = yield* exchanger.processEvent(envelopeFromFrame(frame));
        outcomes.push({ name: row.name, outcome: decision.kind });
        assertEquals(exchanger.complete(row.said), decision.kind === "accept", row.name);
        if (decision.kind !== "accept") continue;
        const chunks: Uint8Array[] = [];
        yield* call(async () => {
          for await (const chunk of exchanger.replay(row.said)) chunks.push(chunk);
        });
        const [retained] = parseBytes(concatBytes(...chunks));
        assertEquals(retained.body.raw, frame.body.raw, row.name);
        assertEquals(retained.nests?.length ?? 0, frame.nests?.length ?? 0, row.name);
        for (const [i, child] of (retained.nests ?? []).entries()) {
          assertEquals(
            yield* call(() => collectPayload(framePayload(child))),
            yield* call(() => collectPayload(framePayload(frame.nests![i]))),
            `${row.name}: exact independent child proof`,
          );
          assertEquals(hby.db.exns.get(child.body.said!), null, "a parent never accepts a credential independently");
        }
      }
      assertEquals(outcomes, vectors.cases.map(({ name, outcome }) => ({ name, outcome })));
    } finally {
      yield* hby.close(true);
    }
  });
});
