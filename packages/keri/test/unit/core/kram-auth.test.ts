/** Parsed frozen observations exercise source decisions against genuinely accepted KELs. */
import {
  b,
  Diger,
  discardFrame,
  type EssrPayload,
  essrPayload,
  MemoryPayloadSink,
  NumberPrimitive,
  parseBytes,
  Prefixer,
  SerderKERI,
  Siger,
  Vrsn_2_0,
} from "cesr-ts";
import { call, run } from "effection";
import { assertEquals, assertExists, assertRejects, assertStrictEquals, assertThrows } from "jsr:@std/assert";
import { createHabery } from "../../../src/app/habbing.ts";
import { dispatchEnvelope, envelopeFromFrame } from "../../../src/app/parsering.ts";
import { KeriDispatchEnvelope } from "../../../src/core/dispatch.ts";
import { authenticateKramSource } from "../../../src/core/kram-auth.ts";
import { KramPolicy } from "../../../src/core/kram-policy.ts";
import { verifyKramSignatures } from "../../../src/core/kram-signatures.ts";
import { stageKram } from "../../../src/core/kram-staging.ts";
import { CacheTypeRecord } from "../../../src/core/records.ts";
import { dgKey } from "../../../src/db/core/keys.ts";
import { removeKramFactors } from "../../../src/db/kram-factors.ts";
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

Deno.test("KRAM staging atomically pools frozen proofs, retains ready receipts and discards rotated partials", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const receipt = "2026-10-13T12:00:02.000000+00:00", later = "2026-10-13T12:00:03.000000+00:00";
    const policy = new KramPolicy(hby.db, {
      enabled: true,
      caches: { "~": [1000, 3000, 10000, 60000, 3000, 10000, 60000] },
    });
    const proofs: Record<string, string> = signatureFixture.proofs;
    const body = new SerderKERI({ raw: b(fixture.bodies.wrong) }), key = [body.pre!, body.said!];
    const child = { body: new SerderKERI({ raw: b(signatureFixture.bodies.foreign) }), attachments: [] };
    const input = (names: string[]) =>
      new KeriDispatchEnvelope({
        serder: body,
        sigers: names.map((name) => new Siger({ qb64: proofs[name] })),
        attachmentGroups: [],
        local: false,
      });
    let owner: EssrPayload | undefined;
    const unexpected = function*() {
      throw new Error("pending invoked consumer");
    };
    try {
      // Inception-only state first: the frozen prior proof becomes stale at the real accepted rotation.
      for (const wire of [fixture.kel[0]]) {
        const [frame] = yield* call(() => parseBytes(b(wire)));
        try {
          yield* dispatchEnvelope(envelopeFromFrame(frame), hby.rvy, hby.kevery);
        } finally {
          yield* call(() => discardFrame(frame));
        }
      }
      const prior = new KeriDispatchEnvelope({
        serder: new SerderKERI({ raw: b(signatureFixture.bodies.prior) }),
        attachmentGroups: [],
        local: false,
        sigers: [new Siger({ qb64: proofs.prior0 })],
      });
      const priorKey = [prior.serder.pre!, prior.serder.said!];
      assertEquals(yield* stageKram(hby.db, policy, prior, receipt, unexpected), { kind: "pending", key: priorKey });
      for (const wire of [...fixture.kel.slice(1), ...signatureFixture.kel]) {
        const [frame] = yield* call(() => parseBytes(b(wire)));
        try {
          yield* dispatchEnvelope(envelopeFromFrame(frame), hby.rvy, hby.kevery);
        } finally {
          yield* call(() => discardFrame(frame));
        }
      }
      assertEquals(yield* stageKram(hby.db, policy, prior, later, unexpected), { kind: "drop", reason: "replay" });
      assertExists(hby.db.msgc.get(priorKey));
      assertEquals([
        hby.db.pmkm.get(priorKey),
        hby.db.pmsk.get(priorKey),
        hby.db.pmks.get(priorKey),
        hby.db.kready.get(priorKey),
      ], [null, null, [], null]);
      const first = new KeriDispatchEnvelope({
        ...input(["sender0", "sender0Only"]),
        attachmentGroups: [],
        nests: [child],
      });
      assertEquals(yield* stageKram(hby.db, policy, first, receipt, unexpected), { kind: "pending", key });
      assertEquals(hby.db.pmks.get(key).map((sig) => sig.qb64), [proofs.sender0, proofs.sender0Only]);
      assertEquals(hby.db.kready.get(key), null, "same-index variants do not satisfy threshold");
      const snapshot = hby.db.kpnd.get(key);
      assertExists(snapshot);
      const foreign = new SerderKERI({ raw: b(signatureFixture.bodies.single) }).pre!;
      const repeat = new KeriDispatchEnvelope({
        ...input(["sender0"]),
        attachmentGroups: [],
        ssts: [{ i: new Prefixer({ qb64: foreign }), s: NumberPrimitive.fromNum(0n), d: new Diger({ qb64: foreign }) }],
      });
      assertEquals(yield* stageKram(hby.db, policy, repeat, later, unexpected), { kind: "pending", key });
      assertEquals(hby.db.ssts.get(key).map(([prefix]) => prefix.qb64), [foreign]);
      assertEquals(hby.db.kpnd.get(key), snapshot, "retry preserves independent saved child");
      const ready = yield* stageKram(hby.db, policy, input(["sender1"]), later, function*(envelope, stagedKey, clock) {
        assertEquals(stagedKey, key);
        assertEquals(clock, later);
        assertEquals(envelope.sigers.map((sig) => sig.qb64), [proofs.sender0, proofs.sender0Only, proofs.sender1]);
        assertEquals(envelope.nests[0].body.raw, child.body.raw);
        assertEquals(envelope.ssts.map((triple) => triple.i.qb64), [foreign]);
        assertEquals(hby.db.msgc.get([child.body.pre!, child.body.said!]), null, "parent admission never admits child");
        assertEquals(hby.db.kready.get(key), later, "publication precedes scoped consumption");
        return "consumed";
      });
      assertEquals(ready, { kind: "ready", key, receiverTime: later, value: "consumed" });
      const sink = new MemoryPayloadSink(8);
      yield* call(() => sink.write(b("4BABYWJj")));
      owner = essrPayload(yield* call(() => sink.finish()), 1, 3, Vrsn_2_0);
      const wire = owner.wire;
      const changedReceipt = new KeriDispatchEnvelope({
        ...input(["sender1"]),
        attachmentGroups: [],
        essr: {
          ...owner,
          wire: {
            size: wire.size,
            async *open(signal?: AbortSignal) {
              hby.db.kready.pin(key, receipt);
              yield* wire.open(signal);
            },
          },
        },
      });
      yield* call(() =>
        assertRejects(
          () => run(() => stageKram(hby.db, policy, changedReceipt, later, unexpected)),
          Error,
          "ready receipt changed",
        )
      );
      hby.db.kready.pin(key, later);
      yield* call(() => hby.db.reopen());
      const retry = yield* stageKram(hby.db, policy, input(["sender1"]), receipt, function*(_envelope, _key, clock) {
        return clock;
      });
      assertEquals(
        retry,
        { kind: "ready", key, receiverTime: later, value: later },
        "reopen freezes first ready receipt",
      );
      const failConsumer = function*() {
        throw new Error("handoff failed");
      };
      yield* call(() =>
        assertRejects(
          () => run(() => stageKram(hby.db, policy, input(["sender1"]), receipt, failConsumer)),
          Error,
          "handoff failed",
        )
      );
      assertEquals(hby.db.kready.get(key), later, "consumer failure retains ready ownership");
      hby.db.env!.transactionSync(() => {
        removeKramFactors(hby.db, key);
        hby.db.kpnd.rem(key);
        hby.db.kready.rem(key);
      });
      assertEquals(yield* stageKram(hby.db, policy, first, later, unexpected), { kind: "drop", reason: "replay" });
      // Re-admit only after removing the replay row, then fail the last publication write.
      hby.db.msgc.rem(key);
      const pin = hby.db.kready.pin.bind(hby.db.kready);
      hby.db.kready.pin = (keys, value) => {
        pin(keys, value);
        throw new Error("ready write failed");
      };
      try {
        const complete = new KeriDispatchEnvelope({
          ...input(["sender0", "sender1"]),
          attachmentGroups: [],
          nests: [child],
        });
        yield* call(() =>
          assertRejects(
            () => run(() => stageKram(hby.db, policy, complete, receipt, unexpected)),
            Error,
            "ready write failed",
          )
        );
      } finally {
        hby.db.kready.pin = pin;
      }
      assertEquals([
        hby.db.msgc.get(key),
        hby.db.pmkm.get(key),
        hby.db.pmsk.get(key),
        hby.db.pmks.get(key),
        hby.db.kpnd.get(key),
        hby.db.kready.get(key),
      ], [null, null, null, [], null, null]);
      // A real serializer read changes current policy before the transaction rechecks admission.
      const original = hby.db.ctyp.get("~")!;
      const changed = new KeriDispatchEnvelope({
        ...input(["sender0", "sender1"]),
        attachmentGroups: [],
        essr: {
          ...owner,
          wire: {
            size: wire.size,
            async *open(signal?: AbortSignal) {
              hby.db.ctyp.pin("~", new CacheTypeRecord({ d: 0, sl: 1, ll: 1, xl: 1, psl: 1, pll: 1, pxl: 1 }));
              yield* wire.open(signal);
            },
          },
        },
      });
      try {
        assertEquals(yield* stageKram(hby.db, policy, changed, later, unexpected), {
          kind: "drop",
          reason: "timeliness",
        });
        assertEquals([hby.db.msgc.get(key), hby.db.pmkm.get(key), hby.db.kpnd.get(key)], [null, null, null]);
      } finally {
        hby.db.ctyp.pin("~", original);
      }
    } finally {
      if (owner) yield* call(() => owner!.discard());
      yield* hby.close(true);
    }
  });
});
