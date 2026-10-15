import { call, run } from "effection";
import { assertEquals, assertExists, assertRejects, assertStrictEquals, assertThrows } from "jsr:@std/assert";
import {
  b,
  BlindState,
  BoundState,
  CtrDexV1,
  CtrDexV2,
  Dater,
  Diger,
  FirstSeen,
  Labeler,
  Noncer,
  NumberPrimitive,
  parseBytes,
  parseCounterFromText,
  Prefixer,
  ResourceLimitError,
  SealEvent,
  SealKind,
  SealSource,
  Seqner,
  SerderKERI,
  Siger,
  Signer,
  Texter,
  TypeMedia,
  Verser,
  Vrsn_1_0,
  Vrsn_2_0,
} from "../../../../cesr/mod.ts";
import structingVectors from "../../../../cesr/test/fixtures/current-structing-vectors.json" with { type: "json" };
import { createHabery } from "../../../src/app/habbing.ts";
import {
  KeriDispatchEnvelope,
  PathedMaterialGroup,
  TransIdxSigGroup,
  TransLastIdxSigGroup,
  TransReceiptQuadruple,
} from "../../../src/core/dispatch.ts";
import { incept } from "../../../src/core/protocol-eventing.ts";
import { exchange } from "../../../src/core/protocol-exchanging.ts";
import { loadEvent } from "../../../src/core/protocol-serialization.ts";
import { Baser, BaserDoer, createBaser } from "../../../src/db/basing.ts";
import { dgKey } from "../../../src/db/core/keys.ts";
import {
  rehydrateKramFactors,
  removeKramFactors,
  storeKramFactors,
} from "../../../src/db/kram-factors.ts";
import { encodeDateTimeToDater } from "../../../src/time/mod.ts";
import replayVectors from "../../fixtures/replay-927.json" with { type: "json" };

Deno.test("db/basing - Baser binds DB-backed state and record stores", async () => {
  await run(function*() {
    const baser = yield* createBaser({
      name: `baser-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const dater = encodeDateTimeToDater("2026-03-16T12:34:56.000000+00:00");
      assertEquals(baser.kels.add("Epre", 0, "Esaid"), true);
      assertEquals(baser.kels.add("Epre", 1, "Esaid1"), true);
      assertEquals(baser.appendFel("Epre", "Esaid"), 0);
      assertEquals(baser.putDts("Epre", "Esaid", dater), true);
      assertEquals(
        baser.pinState("Epre", { i: "Epre", d: "Esaid", k: ["Dkey"], n: [] }),
        true,
      );
      assertEquals(baser.pinHab("Epre", { hid: "Epre", name: "alice" }), true);
      assertEquals(
        baser.ends.pin(["cid", "watcher", "eid"], { allowed: true }),
        true,
      );
      assertEquals(
        baser.oobis.pin("https://example.com/oobi", { cid: "Epre" }),
        true,
      );
      assertEquals(
        baser.wkas.put("Epre", [{
          url: "https://example.com/.well-known/keri/oobi/Epre",
          dt: "2026-03-16T12:34:56.000000+00:00",
        }]),
        true,
      );

      assertEquals(baser.kels.getLast("Epre", 0), "Esaid");
      assertEquals([...baser.getKelItemIter("Epre")], [
        [0, "Esaid"],
        [1, "Esaid1"],
      ]);
      assertEquals(baser.getFel("Epre", 0), "Esaid");
      assertEquals(baser.getFelFn("Epre", "Esaid"), 0);
      assertEquals(baser.getDts("Epre", "Esaid"), dater);
      assertEquals(baser.getState("Epre")?.d, "Esaid");
      assertEquals(baser.getHab("Epre")?.name, "alice");
      assertEquals(baser.ends.get(["cid", "watcher", "eid"])?.allowed, true);
      assertEquals(baser.oobis.get("https://example.com/oobi")?.cid, "Epre");
      assertEquals(
        baser.wkas.get("Epre")[0]?.url.includes("/.well-known/"),
        true,
      );
    } finally {
      yield* baser.close(true);
    }
  });
});

Deno.test("db/basing - raw pathed evidence retains binary identity and order after reopen", async () => {
  await run(function*() {
    const baser = yield* createBaser({ name: `ptds-${crypto.randomUUID()}`, temp: true });
    try {
      const keys = ["AID", "MID"];
      const first = new Uint8Array([0xff, 0x00, 0x80]);
      const second = new Uint8Array([0xfe, 0x00, 0x80]);
      assertEquals(baser.ptds.put(keys, [first, second]), true);
      assertEquals(baser.ptds.add(keys, first.slice()), false);
      assertEquals(baser.ptds.get(keys), [first, second]);
      yield* baser.close(false);
      yield* baser.reopen({ reuse: true });
      assertEquals(baser.ptds.get(keys), [first, second]);
      assertEquals([...baser.ptds.getItemIter(keys)], [[keys, first], [keys, second]]);
      assertEquals(baser.ptds.getLast(keys), second);
      assertEquals(baser.ptds.add(keys, second.slice()), false);
      assertEquals(baser.ptds.cnt(keys), 2);
    } finally {
      yield* baser.close(true);
    }
  });
});

Deno.test("db/basing - BaserDoer reopens closed basers and clears temp stores on exit", async () => {
  let tempPath: string | null = null;

  await run(function*() {
    const baser = new Baser({
      name: `baser-doer-${crypto.randomUUID()}`,
      temp: true,
    });
    const doer = new BaserDoer(baser);

    assertEquals(baser.opened, false);
    yield* doer.enter();
    assertEquals(baser.opened, true);
    tempPath = baser.path;
    assertExists(tempPath);

    yield* doer.exit();
    assertEquals(baser.opened, false);
    assertEquals(baser.path, null);
  });

  await assertRejects(() => Deno.stat(tempPath!));
});

Deno.test("db/basing - cloneEvtMsg emits v1 replay counters", async () => {
  await run(function*() {
    const baser = yield* createBaser({
      name: `baser-clone-evt-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const signer = Signer.random({ transferable: true });
      const serder = incept([signer.verfer.qb64]);
      const pre = serder.pre!;
      const said = serder.said!;
      const key = dgKey(pre, said);
      const siger = signer.sign(serder.raw, { index: 0 }) as Siger;
      const dater = encodeDateTimeToDater("2026-03-16T12:34:56.000000+00:00");

      assertEquals(baser.evts.put(key, serder), true);
      assertEquals(baser.sigs.put(key, [siger]), true);
      assertEquals(baser.appendFel(pre, said), 0);
      assertEquals(baser.putDts(pre, said, dater), true);

      assertEquals(loadEvent(baser, pre, said).timestamp, "2026-03-16T12:34:56.000000+00:00");
      const message = baser.cloneEvtMsg(pre, 0, said);
      let offset = serder.raw.length;
      const group = parseCounterFromText(message.slice(offset), Vrsn_1_0);
      offset += group.fullSize;
      const signatures = parseCounterFromText(message.slice(offset), Vrsn_1_0);
      offset += signatures.fullSize + siger.qb64b.length;
      const firstSeen = parseCounterFromText(message.slice(offset), Vrsn_1_0);

      assertEquals(group.code, CtrDexV1.AttachmentGroup);
      assertEquals(signatures.code, CtrDexV1.ControllerIdxSigs);
      assertEquals(firstSeen.code, CtrDexV1.FirstSeenReplayCouples);
      const v2Message = baser.cloneEvtMsg(pre, 0, said, Infinity, Vrsn_2_0);
      assertEquals(parseCounterFromText(v2Message.slice(serder.size), Vrsn_2_0).code, CtrDexV2.AttachmentGroup);
      assertEquals(baser.cloneEvtMsg(pre, 0, said, v2Message.length, Vrsn_2_0), v2Message);
      assertThrows(() => baser.cloneEvtMsg(pre, 0, said, v2Message.length - 1, Vrsn_2_0), ResourceLimitError);
    } finally {
      yield* baser.close(true);
    }
  });
});

Deno.test("db/basing - imported protocol versions replay exact KERIpy evidence after reopen", async () => {
  for (const vector of replayVectors.vectors) {
    await run(function*() {
      const baser = yield* createBaser({ name: `replay-vector-${crypto.randomUUID()}`, temp: true });
      try {
        // The frozen Python body, signature, and wire expectation are independent of this serializer.
        const body = new TextEncoder().encode(vector.body);
        const serder = new SerderKERI({ raw: body });
        const signature = new Siger({ qb64: vector.signature });
        const key = dgKey(vector.pre, vector.said);
        baser.evts.put(key, serder);
        baser.sigs.put(key, [signature]);
        const number = new NumberPrimitive({ qb64: vector.seal.number });
        const diger = new Diger({ qb64: vector.seal.digest });
        if (vector.evidence === "source") {
          baser.aess.put(key, [number, diger]);
        } else {
          // Two persisted receipt tuples must remain one wire group with both signatures.
          const prefixer = new Prefixer({ qb64: vector.seal.pre });
          for (const receipt of vector.receipts) {
            baser.vrcs.add(key, [prefixer, number, diger, new Siger({ qb64: receipt })]);
          }
        }
        baser.appendFel(vector.pre, vector.said);
        baser.putDts(vector.pre, vector.said, vector.datetime);
        yield* baser.close();
        yield* baser.reopen({ reuse: true });
        const replay = baser.cloneEvtMsg(vector.pre, 0, vector.said);
        assertEquals(replay, new TextEncoder().encode(vector.replay));
        const [frame] = yield* call(() => parseBytes(replay));
        assertEquals(frame.body.raw, body);
        assertEquals(frame.attachments.map((group) => group.name), [
          "ControllerIdxSigs",
          vector.evidence === "source" ? "SealSourceCouples" : "TransIdxSigGroups",
          "FirstSeenReplayCouples",
        ]);
        assertEquals([...baser.clonePreIter(vector.pre)], [replay]);
      } finally {
        yield* baser.close(true);
      }
    });
  }
});

Deno.test("db/basing - current typed-seal nonce roles and first-seen tuples survive reopen", async () => {
  await run(function*() {
    const baser = yield* createBaser({ name: `structing-${crypto.randomUUID()}`, temp: true });
    try {
      for (const row of structingVectors.records) {
        const parts = row.parts.map((part) => b(part.qb64)) as [Uint8Array, Uint8Array];
        if (row.clan === "SealKind") {
          baser.tdcs.add([row.clan], SealKind.toTuple(SealKind.fromQb64bTuple(parts)));
        } else {
          baser.frcs.add([row.clan], FirstSeen.toTuple(FirstSeen.fromQb64bTuple(parts)));
        }
      }
      yield* baser.close(false);
      yield* baser.reopen({ reuse: true });
      const typed = baser.tdcs.get(["SealKind"]);
      assertEquals(typed.length, 4);
      for (const tuple of typed) assertEquals(tuple[1] instanceof Noncer, true);
      assertEquals(
        typed.map((tuple) => tuple.map((part) => part.qb64).join("")),
        structingVectors.records.filter((row) => row.clan === "SealKind").map((row) => row.qb64),
      );
      const firstSeen = baser.frcs.get(["FirstSeen"]);
      assertEquals(
        firstSeen.map((tuple) => tuple.map((part) => part.qb64).join("")),
        structingVectors.records.filter((row) => row.clan === "FirstSeen").map((row) => row.qb64),
      );
      assertEquals(
        firstSeen.map((tuple) => FirstSeen.toSad(FirstSeen.fromTuple(tuple))),
        structingVectors.records.filter((row) => row.clan === "FirstSeen").map((row) => ({
          f: row.sad.f!,
          dt: row.sad.dt!,
        })),
      );
    } finally {
      yield* baser.close(true);
    }
  });
});

Deno.test("db/basing - partial factors preserve independent owners, qualified tuples and frozen last state", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: `factors-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    try {
      const alice = hby.makeHab("sender"),
        bob = hby.makeHab("foreign"),
        carol = hby.makeHab("cigar", undefined, { transferable: false });
      const db = hby.db;
      const body = exchange("/factors", {}, { sender: alice.pre, pvrsn: Vrsn_2_0 })[0];
      const keys = [alice.pre, body.said!];
      const sender = alice.sign(body.raw, true)[0], foreign = bob.sign(body.raw, true)[0];
      const pre = new Prefixer({ qb64: bob.pre }), dig = new Diger({ qb64: bob.kever!.lastEst.d });
      const ordinal = NumberPrimitive.fromNum(0n), oldDigest = dig.qb64;
      const explicit = new TransIdxSigGroup(pre, ordinal, dig, [foreign]);
      const first = FirstSeen.fromTuple([ordinal, new Dater({ qb64: "1AAG2026-03-29T10c20c30d000000p00c00" })]);
      const typed = SealKind.fromTuple([
        new Verser({ qb64: "YKERICAA" }),
        new Noncer({ code: dig.code, raw: dig.raw }),
      ]);
      const nonce = new Noncer({ qb64: "0AAxyHwW6htOZ_rANOaZb2N2" }), empty = new Noncer({ qb64: "1AAP" });
      const label = new Labeler({ qb64: "0J_i" });
      const envelope = new KeriDispatchEnvelope({
        serder: body,
        attachmentGroups: [],
        local: false,
        sigers: [foreign],
        tsgs: [new TransIdxSigGroup(new Prefixer({ qb64: alice.pre }), ordinal, dig, [sender])],
        ssgs: [new TransLastIdxSigGroup(pre, [foreign])],
        cigars: [carol.sign(body.raw, false)[0]],
        trqs: [new TransReceiptQuadruple(pre, new Seqner({ code: "0A", raw: new Uint8Array(16) }), dig, foreign)],
        sscs: [SealSource.fromTuple([ordinal, dig])],
        ssts: [SealEvent.fromTuple([pre, ordinal, dig])],
        frcs: [first],
        tdcs: [typed],
        ptds: [PathedMaterialGroup.fromRaw(new Uint8Array([0xff]))],
        bsqs: [BlindState.fromTuple([nonce, nonce, empty, label])],
        bsss: [BoundState.fromTuple([nonce, nonce, empty, label, ordinal, empty])],
        tmqs: [TypeMedia.fromTuple([typed.d, nonce, label, new Texter({ qb64: "4BABAAAA" })])],
      });
      db.env!.transactionSync(() => {
        db.pmkm.pin(keys, body);
        db.pmks.add(keys, sender);
        db.pmsk.pin(keys, [ordinal, new Diger({ qb64: alice.kever!.lastEst.d })]);
        storeKramFactors(db, keys, envelope);
      });
      assertEquals(db.pmks.get(keys).map((s) => s.qb64), [sender.qb64]);
      assertEquals(db.tsgs.get(keys).length, 1);
      assertEquals(db.cigs.get(keys).length, 1);
      bob.rotate();
      yield* db.close(false);
      yield* db.reopen({ reuse: true });
      const incoming = new KeriDispatchEnvelope({
        serder: body,
        attachmentGroups: [],
        local: false,
        tsgs: [
          explicit,
          new TransIdxSigGroup(pre, new Seqner({ code: "0A", raw: new Uint8Array(16) }), dig, [foreign]),
        ],
        ptds: [PathedMaterialGroup.fromRaw(new Uint8Array([0xfe]))],
        nests: envelope.nests,
      });
      const restored = rehydrateKramFactors(db, keys, incoming);
      assertThrows(
        () =>
          rehydrateKramFactors(
            db,
            keys,
            new KeriDispatchEnvelope({
              ...incoming,
              attachmentGroups: [],
              serder: incept([Signer.random().verfer.qb64]),
            }),
          ),
        Error,
        "body mismatch",
      );
      assertEquals(restored.sigers.map((s) => s.qb64), [sender.qb64]);
      assertEquals(restored.tsgs.map((g) => [g.sn, g.said, g.sigers.map((s) => s.qb64)]), [[0n, oldDigest, [
        foreign.qb64,
      ]]]);
      assertEquals(restored.cigars[0].verfer?.qb64, carol.pre);
      assertEquals(restored.cigars[0].qb64, envelope.cigars[0].qb64);
      assertEquals(restored.ptds.map((v) => [...v.raw]), [[0xff], [0xfe]]);
      for (const name of ["ssts", "frcs", "tdcs", "bsqs", "bsss", "tmqs"] as const) {
        assertEquals(restored[name], envelope[name]);
      }
      assertEquals(restored.trqs[0].sn, 0n);
      assertEquals(restored.sscs, []);
      assertEquals(db.sscs.get(keys), []);
      assertStrictEquals(restored.nests, incoming.nests);
      assertEquals(db.pmsk.get(keys)![1].qb64, alice.kever!.lastEst.d);
      const unknown = hby.makeHab("unknown"), unknownPre = new Prefixer({ qb64: unknown.pre });
      const unknownState = db.states.get([unknown.pre])!, unknownSigs = unknown.sign(body.raw, true);
      db.kevers.delete(unknown.pre);
      db.states.rem([unknown.pre]);
      storeKramFactors(
        db,
        keys,
        new KeriDispatchEnvelope({
          ...incoming,
          attachmentGroups: [],
          ssgs: [new TransLastIdxSigGroup(unknownPre, unknownSigs)],
        }),
      );
      db.states.pin([unknown.pre], unknownState);
      yield* db.close(false);
      yield* db.reopen({ reuse: true });
      const unresolved = rehydrateKramFactors(db, keys, incoming);
      assertExists(db.getKever(unknown.pre));
      assertEquals(unresolved.unresolvedLast.map((p) => p.qb64), [unknown.pre]);
      assertEquals(unresolved.tsgs.some((g) => g.pre === unknown.pre), false);
      db.msgc.pin(keys, { mdt: "2026-03-29T10:20:30.000000+00:00", d: 1, ml: 1, pml: 1, xl: 1, pxl: 1 });
      removeKramFactors(db, keys);
      assertEquals([db.pmkm.get(keys), db.pmsk.get(keys)], [null, null]);
      assertEquals(
        rehydrateKramFactors(db, keys, new KeriDispatchEnvelope({ serder: body, attachmentGroups: [], local: false }))
          .sigers,
        [],
      );
      assertExists(db.msgc.get(keys));
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("db/basing - factor union deduplicates exact members and propagates corrupt rows", async () => {
  await run(function*() {
    const db = yield* createBaser({ name: `factor-union-${crypto.randomUUID()}`, temp: true });
    try {
      const body = incept([Signer.random().verfer.qb64]);
      const key = [body.pre!, body.said!];
      const empty = new KeriDispatchEnvelope({ serder: body, attachmentGroups: [], local: false });
      const rows = [new Uint8Array([1]), new Uint8Array([2])];
      db.ptds.put(key, rows);
      const union = rehydrateKramFactors(
        db,
        key,
        new KeriDispatchEnvelope({
          ...empty,
          attachmentGroups: [],
          ptds: [PathedMaterialGroup.fromRaw(rows[0]), PathedMaterialGroup.fromRaw(new Uint8Array([3]))],
        }),
      );
      assertEquals(union.ptds.map((item) => item.raw), [...rows, new Uint8Array([3])]);
      db.cigs.sdb.putSync(b(`${key.join(".")}.${"0".repeat(32)}`), b("!"));
      assertThrows(() => rehydrateKramFactors(db, key, empty));
    } finally {
      yield* db.close(true);
    }
  });
});

Deno.test("db/basing - full event seal search skips accepted opaque and digest-only KEL data", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    try {
      const issuer = hby.makeHab("issuer"), seal = { i: issuer.pre, s: "0", d: issuer.pre };
      issuer.interact({ data: [issuer.pre, { d: issuer.pre }, { application: "payload" }] });
      const opaque = issuer.kever!.serder;
      assertEquals(opaque.verify(), true);
      assertThrows(() => opaque.eventSeals, Error, "expected plain object");
      assertEquals(hby.db.fetchLastSealingEventByEventSeal(issuer.pre, seal), null);
      assertEquals(hby.db.fetchAllSealingEventByEventSeal(issuer.pre, seal), null);
      issuer.interact({ data: [seal] });
      assertEquals(hby.db.fetchLastSealingEventByEventSeal(issuer.pre, seal)!.said, issuer.kever!.said);
      assertEquals(hby.db.fetchAllSealingEventByEventSeal(issuer.pre, seal)!.said, issuer.kever!.said);
      assertEquals(hby.db.fetchLastSealingEventByEventSeal(issuer.pre, { ...seal, s: "1" }), null);
      assertEquals(hby.db.fetchLastSealingEventByEventSeal(issuer.pre, seal, issuer.kever!.sn + 1), null);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("readonly legacy Baser opening leaves absent schema escrow tables absent", async () => {
  await run(function*() {
    const db = yield* createBaser({ name: crypto.randomUUID(), temp: true });
    try {
      db.emse!.sdb.dropSync();
      db.emsd!.sdb.dropSync();
      yield* db.close();
      yield* db.reopen({ reuse: true, readonly: true });
      assertEquals(db.emse, null);
      assertEquals(db.emsd, null);
      assertEquals(db.env!.getBinary(b("emse.")), undefined);
      assertEquals(db.env!.getBinary(b("emsd.")), undefined);
    } finally {
      yield* db.close(true);
    }
  });
});
