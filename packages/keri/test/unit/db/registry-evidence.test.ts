/** Registry observer imports retain only complete verified chains across reopen. */
import { b, discardFrame, parseBytes, ResourceLimitError, SerderACDC } from "cesr-ts";
import { call, run } from "effection";
import { assertEquals, assertExists, assertThrows } from "jsr:@std/assert";
import { RegBaser } from "../../../src/acdc/regbasing.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { dispatchEnvelope, envelopeFromFrame } from "../../../src/app/parsering.ts";
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
