/** Registry observer imports retain only complete verified chains across reopen. */
import { b, Diger, discardFrame, NumberPrimitive, parseBytes, ResourceLimitError, SerderACDC } from "cesr-ts";
import { call, run } from "effection";
import { assertEquals, assertExists, assertThrows } from "jsr:@std/assert";
import { RegBaser } from "../../../src/acdc/regbasing.ts";
import { openRegistry, RegistryStore } from "../../../src/acdc/registering.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { dispatchEnvelope, envelopeFromFrame } from "../../../src/app/parsering.ts";
import { DatabaseOperationError } from "../../../src/core/errors.ts";
import { LMDBer } from "../../../src/db/core/lmdber.ts";
import { createRegistryEvidenceStore } from "../../../src/db/registry-evidence.ts";
import fixture from "../../fixtures/keripy-registry-vectors.json" with { type: "json" };

Deno.test("registry evidence import verifies before publication and preserves newer accepted heads", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const store = yield* createRegistryEvidenceStore({ name: crypto.randomUUID(), temp: true });
    const limited = yield* createRegistryEvidenceStore({ name: crypto.randomUUID(), temp: true, maxEvents: 1 });
    const rip = new SerderACDC({ raw: b(fixture.bodies.rip) });
    const issued = new SerderACDC({ raw: b(fixture.bodies.issued) });
    try {
      const args = { rip, updates: [issued], db: hby.db };
      assertEquals(store.importEvidence(args).kind, "missing");
      assertEquals(store.read(rip.said!), null);
      for (const wire of fixture.wires.slice(0, 3)) {
        const frames = yield* call(() => parseBytes(b(wire)));
        try {
          for (const frame of frames) yield* dispatchEnvelope(envelopeFromFrame(frame), hby.rvy, hby.kevery);
        } finally {
          yield* call(() => Promise.all(frames.map(discardFrame)));
        }
      }
      assertEquals(store.importEvidence({ ...args, updates: [] }).kind, "verified");
      assertEquals(store.importEvidence(args).kind, "missing");
      assertEquals(store.read(rip.said!)!.updates.length, 0);
      const [anchor] = yield* call(() => parseBytes(b(fixture.wires[3])));
      try {
        yield* dispatchEnvelope(envelopeFromFrame(anchor), hby.rvy, hby.kevery);
      } finally {
        yield* call(() => discardFrame(anchor));
      }
      assertEquals(store.importEvidence(args).kind, "verified");
      assertEquals(store.importEvidence({ ...args, updates: [] }).kind, "verified");
      assertEquals(store.read(rip.said!)!.updates.map((e) => e.said), [issued.said]);
      yield* store.reopen();
      assertEquals(store.read(rip.said!)!.rip.raw, rip.raw);
      assertEquals(store.read(rip.said!)!.updates[0].raw, issued.raw);
      assertEquals(store.importEvidence({ ...args, updates: [issued, issued] }).kind, "verified");
      assertThrows(() => limited.importEvidence(args), ResourceLimitError, "event limit");
      assertEquals(limited.read(rip.said!), null);
      assertEquals(limited.importEvidence({ ...args, updates: [] }).kind, "verified");
      assertExists(limited.read(rip.said!));
      const bad = new SerderACDC({ raw: b(fixture.bodies["wrong-prior"]) });
      assertEquals(store.importEvidence({ ...args, updates: [bad] }).kind, "reject");
      assertEquals(store.read(rip.said!)!.updates.map((e) => e.said), [issued.said]);
    } finally {
      yield* limited.close(true);
      yield* store.close(true);
      yield* hby.close(true);
    }
  });
});

Deno.test("RegBaser and observer reader reopen old three-table stores readonly without migration", async () => {
  const headDirPath = Deno.makeTempDirSync({ prefix: "old-registry-" });
  const options = { name: "legacy", headDirPath, temp: false };
  const databasePath = `${headDirPath}/keri/acdc/reg/legacy`;
  const rip = new SerderACDC({ raw: b(fixture.bodies.rip) });
  const issued = new SerderACDC({ raw: b(fixture.bodies.issued) });
  // Seed only the #168 physical layout; no new RegBaser bindings create these rows.
  const old = new LMDBer(options, { tailDirPath: "keri/acdc/reg" });
  const baser = new RegBaser({ ...options, readonly: true });
  try {
    await run(function*() {
      try {
        yield* old.reopen();
        assertEquals(old.path, databasePath);
        const evts = old.openDB("evts.");
        const tels = old.openDB("tels.");
        const heads = old.openDB("heds.");
        old.setVal(evts, b(rip.said!), rip.raw);
        old.setVal(evts, b(issued.said!), issued.raw);
        old.setVal(tels, b(`${rip.said}.00000000000000000000000000000000`), b(rip.said!));
        old.setVal(tels, b(`${rip.said}.00000000000000000000000000000001`), b(issued.said!));
        old.setVal(heads, b(rip.said!), b(issued.said!));
      } finally {
        yield* old.close();
      }
      const before = Deno.readFileSync(`${databasePath}/data.mdb`);
      try {
        assertEquals(baser.opened, false);
        yield* baser.reopen();
        assertEquals(baser.path, databasePath);
        assertEquals(baser.evts.get(issued.said!)!.raw, issued.raw);
        assertEquals(baser.tels.getOn(rip.said!, 0)!.qb64, rip.said);
        assertEquals(baser.tels.getOn(rip.said!, 1)!.qb64, issued.said);
        assertEquals(baser.heads.get(rip.said!)!.qb64, issued.said);
        const facade = new RegistryStore(baser);
        assertEquals([baser.ancs, baser.maes, baser.ooes, facade.records], [null, null, null, null]);
        assertEquals(facade.anchor(issued.said!), null);
        assertEquals(facade.seqEvent(rip.said!, 1)!.raw, issued.raw);
        assertEquals(facade.cloneTel(rip.said!, 1), issued.raw);
        facade.clearEscrows(rip.said!, 1, issued.said!);
        assertThrows(() => facade.putRecord("old", { registryKey: rip.said! }), DatabaseOperationError);
        assertThrows(
          () => facade.putAnchor(issued.said!, NumberPrimitive.fromNum(1n), new Diger({ qb64: issued.said! })),
          DatabaseOperationError,
        );
        const previous = baser.evts;
        yield* baser.reopen();
        assertEquals(baser.evts === previous, false, "reopen must replace closed table handles");
        assertEquals(baser.evts.get(rip.said!)!.raw, rip.raw);
      } finally {
        yield* baser.close();
      }
      const reader = yield* createRegistryEvidenceStore({ ...options, readonly: true });
      try {
        assertEquals(reader instanceof RegBaser, true);
        assertEquals(reader.read(rip.said!)!.rip.raw, rip.raw);
        assertEquals(reader.read(rip.said!)!.updates[0].raw, issued.raw);
      } finally {
        yield* reader.close();
      }
      assertEquals(
        Deno.readFileSync(`${databasePath}/data.mdb`),
        before,
        "readonly opening must preserve stored bytes",
      );
    });
  } finally {
    Deno.removeSync(headDirPath, { recursive: true });
  }
});

Deno.test("registry storage facade preserves aliases, earliest anchors, accepted cloning and escrow order", async () => {
  await run(function*() {
    const baser = yield* openRegistry({ name: `registry-facade-${crypto.randomUUID()}`, temp: true });
    const store = new RegistryStore(baser);
    const rip = new SerderACDC({ raw: b(fixture.bodies.rip) });
    const issued = new SerderACDC({ raw: b(fixture.bodies.issued) });
    const vacuous = new SerderACDC({ raw: b(fixture.bodies.vacuous) });
    try {
      assertEquals(store.opened, true);
      assertEquals(store.records, null);
      assertEquals(baser.hasTable("ancs."), false);
      for (const sn of [-1, Number.MAX_SAFE_INTEGER + 1, NaN]) {
        assertThrows(() => store.seqEvent(rip.said!, sn), RangeError, "safe integer");
        assertThrows(() => store.accept(rip.said!, sn, vacuous), RangeError, "safe integer");
        assertThrows(() => store.escrowMissingAnchor(rip.said!, sn, vacuous.said!), RangeError, "safe integer");
        assertThrows(() => store.cloneTel(rip.said!, sn), RangeError, "safe integer");
        assertThrows(() => store.clearEscrows(rip.said!, sn, vacuous.said!), RangeError, "safe integer");
      }
      assertEquals(store.event(vacuous.said!), null, "invalid ordinals publish no bodies or tables");
      assertEquals(baser.hasTable("maes."), false);
      store.putEvent(issued);
      assertEquals(store.event(issued.said!)!.raw, issued.raw);
      assertEquals(store.head(rip.said!), null, "a stored body is not an acceptance marker");
      assertEquals(store.seqEvent(rip.said!, 1), null);
      store.accept(rip.said!, 0, rip);
      store.accept(rip.said!, 1, issued);
      assertEquals(store.head(rip.said!)!.qb64, issued.said);
      assertEquals(store.headEvent(rip.said!)!.raw, issued.raw);
      assertEquals(store.seqSaider(rip.said!, 0)!.qb64, rip.said);
      assertEquals([...store.cloneTelIter(rip.said!)], [rip.raw, issued.raw]);
      assertEquals(store.cloneTel(rip.said!), new Uint8Array([...rip.raw, ...issued.raw]));
      assertEquals(store.cloneTel(rip.said!, 1), issued.raw);
      assertEquals(store.cloneTel(rip.said!, 2), new Uint8Array());
      assertEquals(store.cloneTel("unknown"), new Uint8Array());
      const early = NumberPrimitive.fromNum((1n << 64n) + 3n);
      const late = NumberPrimitive.fromNum(early.num + 1n);
      const first = new Diger({ qb64: rip.said! });
      const second = new Diger({ qb64: issued.said! });
      assertEquals(store.putAnchor(issued.said!, late, first), true);
      assertEquals(store.putAnchor(issued.said!, late, second), false, "equal reseals retain the first digest");
      assertEquals(store.putAnchor(issued.said!, early, second), true);
      assertEquals(store.putAnchor(issued.said!, late, first), false);
      assertEquals(store.anchor(issued.said!)!.map((item) => item.qb64), [early.qb64, second.qb64]);
      assertEquals(
        baser.getVal(baser.ancs!.sdb, b(issued.said!)),
        b("SAAAAQAAAAAAAAADEKBaUTD-M5aPKvzXw-IGOLY-LgdS5gjLlpvGnYCwGO1j"),
      );
      assertEquals(store.putRecord("public", { registryKey: rip.said! }), true);
      assertEquals(store.records!.get("public")!.asDict(), { registryKey: rip.said! });
      assertEquals(store.escrowMissingAnchor(rip.said!, 1, issued.said!), true);
      assertEquals(store.escrowMissingAnchor(rip.said!, 1, vacuous.said!), true);
      assertEquals(store.escrowMissingAnchor(rip.said!, 1, issued.said!), false);
      assertEquals(store.escrowOutOfOrder(rip.said!, 1, issued.said!), true);
      assertEquals(baser.maes!.get(rip.said!, 1), [[issued.said!], [vacuous.said!]]);
      const aliases = store.records;
      yield* baser.reopen();
      assertEquals(store.records === aliases, false, "alias mapper follows the owner's new environment");
      assertEquals(store.records!.get("public")!.registryKey, rip.said);
      assertEquals(store.anchor(issued.said!)![0].num, early.num);
      assertEquals(baser.maes!.get(rip.said!, 1), [[issued.said!], [vacuous.said!]]);
      assertEquals(baser.ooes!.get(rip.said!, 1), [[issued.said!]]);
      assertEquals(store.cloneTel(rip.said!, 1), issued.raw);
      store.clearEscrows(rip.said!, 1, issued.said!);
      assertEquals(baser.maes!.get(rip.said!, 1), [[vacuous.said!]]);
      assertEquals(baser.ooes!.get(rip.said!, 1), []);
      yield* baser.reopen({ readonly: true });
      assertEquals(store.records!.get("public")!.registryKey, rip.said);
      assertEquals(store.anchor(issued.said!)![0].num, early.num);
      assertEquals(baser.maes!.get(rip.said!, 1), [[vacuous.said!]]);
      const path = baser.path!;
      yield* store.close();
      assertEquals(store.opened, false);
      assertThrows(() => Deno.statSync(path), Deno.errors.NotFound);
    } finally {
      yield* baser.close(true);
    }
  });
});
