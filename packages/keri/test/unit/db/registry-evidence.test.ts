/** Public registry intake preserves accepted prefixes and historical storage bytes across reopen. */
import { b, Diger, discardFrame, NumberPrimitive, parseBytes, ResourceLimitError, SerderACDC } from "cesr-ts";
import { call, run } from "effection";
import { assertEquals, assertExists, assertRejects, assertThrows } from "jsr:@std/assert";
import { blindate, regcept } from "../../../src/acdc/messaging.ts";
import { RegistryObserver } from "../../../src/acdc/observing.ts";
import { RegBaser } from "../../../src/acdc/regbasing.ts";
import { openRegistry, RegistryStore } from "../../../src/acdc/registering.ts";
import { createRegery, Regery } from "../../../src/acdc/registraring.ts";
import { acceptedEventReplayMessage, createHabery } from "../../../src/app/habbing.ts";
import { dispatchEnvelope, envelopeFromFrame } from "../../../src/app/parsering.ts";
import { DatabaseOperationError } from "../../../src/core/errors.ts";
import { LMDBer } from "../../../src/db/core/lmdber.ts";
import fixture from "../../fixtures/keripy-registry-vectors.json" with { type: "json" };

Deno.test("named v2 registries reopen by stored issuer and retain explicit store ownership", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const baser = yield* openRegistry({ name: crypto.randomUUID(), temp: true });
    try {
      const first = hby.makeHab("first"), second = hby.makeHab("second");
      let rgy = yield* createRegery({ hby, baser });
      assertEquals(rgy.registryByName("absent"), null);
      assertThrows(() => rgy.makeRegistry("unknown", "unknown"), Error, "Unknown local registry issuer");
      const one = rgy.makeRegistry("one", first.pre), two = rgy.makeRegistry("two", second.pre);
      assertEquals([one.head, one.regser, one.sn], [null, null, -1n]);
      const rip = rgy.store.event(one.regk!)!;
      assertThrows(() => rgy.makeRegistry("one", first.pre), Error, "alias already exists");
      assertThrows(
        () =>
          rgy.makeRegistry("duplicate", first.pre, {
            uuid: rip.sad!.u as string,
            stamp: rip.sad!.dt as string,
          }),
        Error,
        "Registry already exists",
      );
      rgy.store.putRecord("two.alias", { registryKey: two.regk! });
      first.interact({ data: [{ i: one.regk!, s: "0", d: one.regk! }] });
      rgy.processEscrows();
      assertEquals(one.regser!.said, one.regk);
      assertEquals([one.regd, one.sn], [one.regk, 0n]);
      yield* rgy.close();
      assertEquals(baser.opened, true, "injected store remains caller-owned");
      yield* baser.close(false);
      yield* baser.reopen({ reuse: true });
      rgy = yield* createRegery({ hby, baser });
      assertEquals(rgy.registryByName("one")!.hab === first, true);
      assertEquals(rgy.registryByName("two")!.hab === second, true);
      assertEquals(rgy.registryByName("two.alias") === rgy.registryByName("two"), true);
      assertEquals(rgy.regs.size, 2);
      hby.habs.delete(second.pre);
      try {
        assertThrows(() => new Regery(hby, baser), Error, "Unknown local registry issuer");
        assertEquals(baser.opened, true);
      } finally {
        hby.habs.set(second.pre, second);
      }
      rgy.store.putRecord("broken", { registryKey: first.pre });
      assertThrows(() => new Regery(hby, baser), Error, "Corrupt registry inception");
      rgy.store.records!.rem("broken");
      const records = rgy.store.records!, pin = records.pin;
      const bodies = [...baser.evts.getTopItemIter()].length;
      try {
        records.pin = function(...args) {
          pin.apply(this, args);
          throw new Error("alias publication failed");
        };
        assertThrows(() => rgy.makeRegistry("failed", first.pre), Error, "alias publication failed");
      } finally {
        records.pin = pin;
      }
      assertEquals(rgy.registryByName("failed"), null);
      assertEquals(records.get("failed"), null);
      assertEquals([...baser.evts.getTopItemIter()].length, bodies);
      second.interact({ data: [{ i: two.regk!, s: "0", d: two.regk! }] });
      rgy.processEscrows();
      assertEquals(rgy.registryByName("two")!.sn, 0n);
      yield* baser.close(false);
      yield* baser.reopen({ reuse: true, readonly: true });
      rgy = yield* createRegery({ hby, baser });
      assertEquals(rgy.registryByName("one")!.sn, 0n);
      assertThrows(() => rgy.makeRegistry("readonly", first.pre), Error, "readonly");

      const owned = yield* createRegery({ hby, name: crypto.randomUUID() });
      const ownedPath = owned.baser.path!;
      yield* owned.close();
      yield* owned.close();
      assertEquals(owned.baser.opened, false);
      yield* call(() => assertRejects(() => Deno.stat(ownedPath), Deno.errors.NotFound));
    } finally {
      yield* baser.close(true);
      yield* hby.close(true);
    }
  });
});

Deno.test("named registry acquisition closes its owned store when alias loading fails", async () => {
  const hby = await run(() => createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true }));
  const load = Regery.prototype.loadRegistries, reopen = RegBaser.prototype.reopen;
  let opened: RegBaser | undefined;
  try {
    RegBaser.prototype.reopen = function*(options) {
      opened = this;
      return yield* reopen.call(this, options);
    };
    Regery.prototype.loadRegistries = () => {
      throw new Error("invalid persisted alias");
    };
    await assertRejects(() => run(() => createRegery({ hby })), Error, "invalid persisted alias");
    assertExists(opened);
    assertEquals(opened.opened, false);
    assertEquals(opened.env, null);
  } finally {
    Regery.prototype.loadRegistries = load;
    RegBaser.prototype.reopen = reopen;
    await run(() => hby.close(true));
  }
});

Deno.test("public registry intake preserves accepted prefixes across missing anchors, limits and reopen", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const source = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const baser = yield* openRegistry({ name: crypto.randomUUID(), temp: true });
    const limitedBaser = yield* openRegistry({ name: crypto.randomUUID(), temp: true });
    const store = new RegistryStore(baser), limitedStore = new RegistryStore(limitedBaser);
    const observer = new RegistryObserver(hby.db, store);
    const limited = new RegistryObserver(hby.db, limitedStore, { maxEvents: 1 });
    const issuer = source.makeHab("issuer"), rip = regcept(issuer.pre);
    const issued = blindate(rip.said!, rip.said!, fixture.disclosures.issued.d);
    try {
      assertEquals(observer.processEvent(rip).kind, "escrow");
      assertEquals(observer.processEvent(issued).kind, "escrow");
      assertEquals([store.head(rip.said!), ...[0, 1].map((sn) => store.seqSaider(rip.said!, sn))], [null, null, null]);
      for (const [sn, event] of [rip, issued].entries()) {
        const anchor = issuer.interact({ data: [{ i: rip.said!, s: sn.toString(16), d: event.said! }] });
        const wires = sn ? [anchor] : [acceptedEventReplayMessage(source, issuer.pre, 0).message, anchor];
        for (const wire of wires) {
          const frames = yield* call(() => parseBytes(wire));
          try {
            for (const frame of frames) yield* dispatchEnvelope(envelopeFromFrame(frame), hby.rvy, hby.kevery);
          } finally {
            yield* call(() => Promise.all(frames.map(discardFrame)));
          }
        }
        observer.processEscrows(rip.said!);
        assertEquals(store.head(rip.said!)!.qb64, event.said);
        if (sn === 0) assertEquals(store.seqSaider(rip.said!, 1), null, "unanchored suffix remains unaccepted");
      }
      assertEquals(hby.habs.size, 0, "the registry issuer is independently controlled");
      assertEquals(observer.processEvent(rip).kind, "duplicate");
      assertEquals(store.head(rip.said!)!.qb64, issued.said, "prefix replay cannot downgrade the head");
      yield* baser.close(false);
      yield* baser.reopen({ reuse: true });
      assertEquals(store.seqEvent(rip.said!, 0)!.raw, rip.raw);
      assertEquals(store.seqEvent(rip.said!, 1)!.raw, issued.raw);
      for (const event of [issued, issued]) assertEquals(observer.processEvent(event).kind, "duplicate");
      assertEquals([...baser.tels.getTopItemIter(rip.said!)].length, 2);
      assertThrows(() => limited.processEvent(issued), ResourceLimitError, "event limit");
      assertEquals([limitedStore.head(rip.said!), limitedStore.event(issued.said!)], [null, null]);
      assertEquals(limited.processEvent(rip).kind, "accept");
      assertEquals(limitedStore.head(rip.said!)!.qb64, rip.said);
      const bad = blindate(rip.said!, rip.said!, fixture.disclosures.issued.d, { sn: 2 });
      assertEquals(observer.processEvent(bad), { kind: "reject", reason: "prior" });
      assertEquals(store.event(bad.said!), null);
      assertEquals(store.head(rip.said!)!.qb64, issued.said);
    } finally {
      yield* limitedBaser.close(true);
      yield* baser.close(true);
      yield* source.close(true);
      yield* hby.close(true);
    }
  });
});

Deno.test("RegBaser and public registry facade reopen old three-table stores readonly without migration", async () => {
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
      const reader = yield* openRegistry({ ...options, readonly: true });
      try {
        assertEquals(reader instanceof RegBaser, true);
        const facade = new RegistryStore(reader);
        assertEquals(facade.seqEvent(rip.said!, 0)!.raw, rip.raw);
        assertEquals(facade.seqEvent(rip.said!, 1)!.raw, issued.raw);
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
