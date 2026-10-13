/** Parsed frozen observations exercise source decisions against genuinely accepted KELs. */
import { b, discardFrame, parseBytes, type SerderKERI } from "cesr-ts";
import { call, run } from "effection";
import { assertEquals, assertStrictEquals, assertThrows } from "jsr:@std/assert";
import { createHabery } from "../../../src/app/habbing.ts";
import { dispatchEnvelope, envelopeFromFrame } from "../../../src/app/parsering.ts";
import { KeriDispatchEnvelope } from "../../../src/core/dispatch.ts";
import { authenticateKramSource } from "../../../src/core/kram-auth.ts";
import { dgKey } from "../../../src/db/core/keys.ts";
import fixture from "../../fixtures/kram-source-auth-927.json" with { type: "json" };

Deno.test("KRAM source decisions match frozen last-candidate and exact missing-state observations", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    try {
      assertEquals(fixture.reference, "927c0cb8794d7c84fc17143c67df64aab9deda6c");
      for (const wire of fixture.kel) {
        const [frame] = yield* call(() => parseBytes(b(wire)));
        try {
          const envelope = envelopeFromFrame(frame);
          yield* dispatchEnvelope(envelope, hby.rvy, hby.kevery);
          assertEquals(hby.db.kels.getLast(envelope.serder.pre!, envelope.serder.sn!), envelope.serder.said);
        } finally {
          yield* call(() => discardFrame(frame));
        }
      }
      const bodies: Record<string, string> = fixture.bodies;
      let anchored: SerderKERI | undefined;
      for (const row of fixture.cases) {
        const [frame] = yield* call(() => parseBytes(b(bodies[row.body] + row.attachments)));
        try {
          const input = envelopeFromFrame(frame);
          if (row.name === "known valid") anchored = input.serder;
          if ("missingEvent" in row) {
            const source = input.sscs.at(-1)!;
            hby.db.delEvt(dgKey(input.serder.pre!, source.d.qb64));
          }
          const couples = input.sscs.map((v) => [v.s.qb64, v.d.qb64]);
          const triples = input.ssts.map((v) => [v.i.qb64, v.s.qb64, v.d.qb64]);
          const signatures = input.sigers.map((v) => v.qb64);
          if (row.name === "foreign triple alone cannot authenticate") {
            const [child] = yield* call(() => parseBytes(b(bodies.sealed + fixture.cases[0].attachments)));
            try {
              assertEquals(authenticateKramSource(hby.db, envelopeFromFrame(child)), { kind: "valid" });
              const parent = new KeriDispatchEnvelope({
                serder: input.serder,
                attachmentGroups: [],
                local: false,
                ssts: input.ssts,
                nests: [child],
              });
              assertEquals(authenticateKramSource(hby.db, parent), { kind: "invalid", reason: "noSource" });
              assertStrictEquals(parent.nests[0], child, "child source evidence remains independent");
            } finally {
              yield* call(() => discardFrame(child));
            }
          }
          const result = authenticateKramSource(hby.db, input);
          assertEquals(result.kind, row.kind, row.name);
          if (result.kind === "missing") {
            assertEquals(result.sender, input.serder.pre);
            assertEquals(result.sn.toString(16), "snhex" in row ? row.snhex : undefined, row.name);
          }
          assertEquals(input.sscs.map((v) => [v.s.qb64, v.d.qb64]), couples);
          assertEquals(input.ssts.map((v) => [v.i.qb64, v.s.qb64, v.d.qb64]), triples);
          assertEquals(input.sigers.map((v) => v.qb64), signatures);
        } finally {
          yield* call(() => discardFrame(frame));
        }
      }
      assertEquals(hby.db.msgc.get([anchored!.pre!, anchored!.said!]), null, "helper never publishes intake state");
      const [frame] = yield* call(() => parseBytes(b(bodies.sealed + fixture.cases[0].attachments)));
      try {
        const envelope = envelopeFromFrame(frame);
        hby.db.setEvt(dgKey(anchored!.pre!, envelope.sscs[0].d.qb64), b("invalid"));
        assertThrows(() => authenticateKramSource(hby.db, envelope), Error);
      } finally {
        yield* call(() => discardFrame(frame));
      }
    } finally {
      yield* hby.close(true);
    }
  });
});
