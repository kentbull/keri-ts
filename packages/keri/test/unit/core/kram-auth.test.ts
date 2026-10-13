/** Parsed frozen observations exercise source decisions against genuinely accepted KELs. */
import { b, discardFrame, parseBytes, type SerderKERI } from "cesr-ts";
import { call, run } from "effection";
import { assertEquals, assertExists, assertStrictEquals, assertThrows } from "jsr:@std/assert";
import { createHabery } from "../../../src/app/habbing.ts";
import { dispatchEnvelope, envelopeFromFrame } from "../../../src/app/parsering.ts";
import { KeriDispatchEnvelope } from "../../../src/core/dispatch.ts";
import { authenticateKramSource } from "../../../src/core/kram-auth.ts";
import { verifyKramSignatures } from "../../../src/core/kram-signatures.ts";
import { dgKey } from "../../../src/db/core/keys.ts";
import signatureFixture from "../../fixtures/kram-signatures-927.json" with { type: "json" };
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

Deno.test("KRAM sender normalization and signatures preserve frozen factor ordering and ownership", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const bodies: Record<string, string> = { ...signatureFixture.bodies, "source.wrong": fixture.bodies.wrong };
    const proofs: Record<string, string> = signatureFixture.proofs;
    const establishments: Record<string, { pre: string; snhex: string; digest: string }> =
      signatureFixture.senderEstablishments;
    try {
      for (const wire of [...fixture.kel, ...signatureFixture.kel]) {
        const [frame] = yield* call(() => parseBytes(b(wire)));
        try {
          const envelope = envelopeFromFrame(frame);
          yield* dispatchEnvelope(envelope, hby.rvy, hby.kevery);
          assertEquals(hby.db.kels.getLast(envelope.serder.pre!, envelope.serder.sn!), envelope.serder.said);
        } finally {
          yield* call(() => discardFrame(frame));
        }
      }
      const [child] = yield* call(() =>
        parseBytes(b(bodies[signatureFixture.cases[0].body] + signatureFixture.cases[0].attachments))
      );
      try {
        for (const row of signatureFixture.cases) {
          const [frame] = yield* call(() => parseBytes(b(bodies[row.body] + row.attachments)));
          try {
            const parsed = envelopeFromFrame(frame);
            const input = new KeriDispatchEnvelope({
              ...parsed,
              attachmentGroups: [...parsed.attachmentGroups],
              nests: [child],
            });
            const kever = hby.db.kevers.get(input.serder.pre!);
            assertExists(kever);
            const sigers = input.sigers.map((s) => s.qb64);
            const inputVerfers = input.sigers.map((s) => s.verfer);
            const couples = [...input.sscs],
              triples = [...input.ssts],
              lastGroups = [...input.ssgs],
              groups = [...input.tsgs];
            const result = verifyKramSignatures(hby.db, input, kever);
            const expected = row.verified.map((name) => proofs[name]);
            assertEquals(result.kind, row.kind, row.name);
            if (result.kind === "verified") assertEquals(result.auth, "auth" in row ? row.auth : undefined, row.name);
            assertEquals(result.sigers.map((s) => s.qb64), expected, row.name);
            assertEquals(
              result.envelope.sigers.map((s) => s.qb64),
              ("normalizedSigers" in row && row.normalizedSigers ? row.normalizedSigers : row.verified).map((name) =>
                proofs[name]
              ),
              row.name,
            );
            if ("threshold" in row) {
              assertEquals(
                kever.tholder!.satisfy([...new Set(result.sigers.map((s) => s.index))]),
                row.threshold,
                row.name,
              );
            }
            const senderGroups = result.envelope.tsgs.filter((g) => g.pre === input.serder.pre);
            assertEquals(senderGroups.length, row.senderGroup ? 1 : 0);
            if (row.senderGroup) {
              assertEquals(
                { pre: senderGroups[0].pre, snhex: senderGroups[0].snh, digest: senderGroups[0].said },
                establishments[row.body],
              );
              assertEquals(senderGroups[0].sigers.map((s) => s.qb64), expected);
            }
            assertEquals(
              result.staleSenderGroups.map((g) => ({
                snhex: g.snh,
                digest: g.said,
                sigers: g.sigers.map((s) => s.qb64),
              })),
              "stale" in row && row.stale
                ? row.stale.map((g) => ({ ...g, sigers: g.sigers.map((name) => proofs[name]) }))
                : [],
            );
            assertEquals(result.envelope.ssgs, lastGroups.filter((g) => g.pre !== input.serder.pre));
            assertEquals(
              result.envelope.tsgs.filter((g) => g.pre !== input.serder.pre),
              groups.filter((g) => g.pre !== input.serder.pre),
            );
            if ("sourceCouples" in row) {
              assertEquals(result.envelope.sscs.map((s) => [s.s.qb64, s.d.qb64]), row.sourceCouples);
            }
            if ("sourceTriples" in row) {
              assertEquals(result.envelope.ssts.map((s) => [s.i.qb64, s.s.qb64, s.d.qb64]), row.sourceTriples);
            }
            assertEquals(input.sigers.map((s) => s.qb64), sigers);
            assertEquals(input.sigers.map((s) => s.verfer), inputVerfers);
            assertEquals([input.sscs, input.ssts, input.ssgs, input.tsgs], [couples, triples, lastGroups, groups]);
            assertStrictEquals(result.envelope.nests[0], child);
            assertEquals(hby.db.msgc.get([input.serder.pre!, input.serder.said!]), null);
          } finally {
            yield* call(() => discardFrame(frame));
          }
        }
      } finally {
        yield* call(() => discardFrame(child));
      }
    } finally {
      yield* hby.close(true);
    }
  });
});
