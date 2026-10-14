/** Registry observer imports retain only complete verified chains across reopen. */
import {
  b,
  BoundState,
  Diger,
  discardFrame,
  NumberPrimitive,
  parseBytes,
  ResourceLimitError,
  SerderACDC,
} from "cesr-ts";
import { call, run } from "effection";
import { assertEquals, assertExists, assertRejects, assertThrows } from "jsr:@std/assert";
import { acdcmap } from "../../../src/acdc/messaging.ts";
import { RegBaser } from "../../../src/acdc/regbasing.ts";
import { vetBinds } from "../../../src/acdc/regeventing.ts";
import { openRegistry, RegistryStore } from "../../../src/acdc/registering.ts";
import { createRegery, Regery, Registrar } from "../../../src/acdc/registraring.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { dispatchEnvelope, envelopeFromFrame } from "../../../src/app/parsering.ts";
import { DatabaseOperationError } from "../../../src/core/errors.ts";
import { exchange } from "../../../src/core/protocol-exchanging.ts";
import { LMDBer } from "../../../src/db/core/lmdber.ts";
import { createRegistryEvidenceStore } from "../../../src/db/registry-evidence.ts";
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

Deno.test("v2 Registrar stages presentation and vacuous bindings through instances, keys and aliases", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const baser = yield* openRegistry({ name: crypto.randomUUID(), temp: true });
    try {
      const issuer = hby.makeHab("issuer"), presenter = hby.makeHab("presenter");
      let rgy = yield* createRegery({ hby, baser }), registrar = new Registrar(rgy);
      const issuing = registrar.makeRegistry("issuing", issuer.pre),
        presenting = registrar.makeRegistry("presenting", presenter.pre);
      const options = { raw: b("0123456789abcdef"), stamp: "2026-10-13T01:00:00.000001Z" };
      const target = new SerderACDC({ raw: b(fixture.bodies.acdc) }).said!;
      assertThrows(() => registrar.present(presenting, target, undefined, options), Error, "must be anchored");
      issuer.interact({ data: [{ i: issuing.regk!, s: "0", d: issuing.regk! }] });
      presenter.interact({ data: [{ i: presenting.regk!, s: "0", d: presenting.regk! }] });
      rgy.processEscrows();
      const acdc = acdcmap(issuer.pre, { regid: issuing.regk, attribute: { d: "", name: "Alice" } });
      const [issued] = registrar.issue("issuing", acdc, undefined, options);
      assertEquals([issued.td.nonce, issued.ts.text], [acdc.said, "issued"]);
      const bodies = [...baser.evts.getTopItemIter()].length;
      assertThrows(() => registrar.present("unknown", target), Error, "Unknown registry");
      assertThrows(() => registrar.vacate("unknown"), Error, "Unknown registry");
      assertThrows(() => registrar.issue("unknown", acdc), Error, "Unknown registry");
      assertThrows(() => registrar.present(presenting, "bad"), Error, "valid grant SAID");
      assertThrows(() => registrar.present(presenting, { said: null }), Error, "valid grant SAID");
      assertEquals([...baser.evts.getTopItemIter()].length, bodies, "bad references/targets publish nothing");
      // A grant SAID is a syntactic target; its controller need not issue the credential or grant.
      const [presented, first] = registrar.present(presenting, { said: target }, undefined, options);
      // These exact BLIDs/UUIDs were observed through frozen 927 Registrar.present/vacate.
      assertEquals([presented.d.nonce, presented.u.nonce, presented.td.nonce, presented.ts.text], [
        "EPxHsUaiDFVpr1YK9D5JJc9UyJeSvGDuUVNxb4MkLe_V",
        "aLCn6VBWdFGZmtzhOIWHqtAZHAQerL-_eanD_wsDbSoq",
        target,
        "presented",
      ]);
      rgy.names.set(presenting.regk!, issuing);
      const [vacuous, second] = registrar.vacate(presenting.regk!, options);
      rgy.names.delete(presenting.regk!);
      assertEquals(
        [second.sad!.rd, second.sad!.n, second.sad!.p],
        [presenting.regk, "2", first.said],
        "registry keys precede aliases",
      );
      assertEquals([vacuous.d.nonce, vacuous.u.nonce, vacuous.td.nonce, vacuous.ts.text], [
        "EAaemVlIFj33uXb4CugKMSFgu7iPiXYYPjICvb5roVl-",
        "aGlE7I7i5Lqwxz8ATad7801sRl1KW2KDTjCaVpfrUkAV",
        "",
        "",
      ]);
      assertEquals(presenting.sn, 0n, "construction stages evidence without claiming acceptance");
      yield* baser.close(false);
      yield* baser.reopen({ reuse: true });
      rgy = yield* createRegery({ hby, baser });
      registrar = new Registrar(rgy);
      const reopened = rgy.registryByName("presenting")!;
      const [bound, third] = registrar.present("presenting", target, "shared", {
        ...options,
        bound: true,
        bsn: 2n,
        bd: target,
      });
      assertEquals(third.sad!.n, "3");
      assertEquals(third.sad!.p, second.said);
      assertEquals([bound.d.nonce, bound.u.nonce, bound.td.nonce, bound.ts.text], [
        "ECYlEWjuVtWW4bpB_DXzA0lwSA1TuX0vLbBLBnO2199D",
        "aDL4vVgrU-XcbDy6pc_qrZh9jVsuE1PTWBdvh7wVKSeg",
        target,
        "shared",
      ]);
      assertEquals("bn" in bound && bound.bn.num, 2n);
      assertEquals("bd" in bound && bound.bd.nonce, target);
      for (const event of [first, second, third]) assertEquals(event.sad!.dt, options.stamp);
      presenter.interact({
        data: [first, second].map((event) => ({ i: reopened.regk!, s: event.sad!.n, d: event.said! })),
      });
      rgy.processEscrows();
      assertEquals(reopened.sn, 2n);
      const evidence = {
        db: hby.db,
        rip: reopened.regser!,
        updates: [first, second],
        target,
        controller: presenter.pre,
      };
      assertEquals(vetBinds({ ...evidence, blinders: [presented] }), { kind: "reject", reason: "disclosure" });
      const checked = vetBinds({ ...evidence, blinders: [presented, vacuous] });
      assertEquals(checked.kind, "verified");
      if (checked.kind === "verified") {
        assertEquals([checked.state.acdc, checked.state.state, checked.state.said, checked.state.sn], [
          target,
          "presented",
          second.said,
          2n,
        ]);
      }
      presenter.interact({ data: [{ i: reopened.regk!, s: "3", d: third.said! }] });
      rgy.processEscrows();
      assertEquals([reopened.sn, reopened.head!.qb64], [3n, third.said]);
      const latest = vetBinds({ ...evidence, updates: [first, second, third], blinders: [presented, vacuous, bound] });
      assertEquals(latest.kind, "verified");
      if (latest.kind === "verified") assertEquals(latest.state.state, "shared");
      // Direct instances from another manager remain valid borrowed references, as in KERIpy.
      const borrowed = new Registrar(new Regery(hby, baser));
      const put = reopened.store.putEvent;
      try {
        reopened.store.putEvent = () => {
          throw new Error("presentation storage failed");
        };
        assertThrows(() => borrowed.vacate(reopened, options), Error, "presentation storage failed");
      } finally {
        reopened.store.putEvent = put;
      }
      assertEquals(baser.maes!.get(reopened.regk!, 4), []);
      assertEquals(reopened.sn, 3n);
      const [grant] = exchange("/ipex/grant", {}, { sender: issuer.pre, stamp: options.stamp });
      const [grantProof, fourth] = borrowed.present(reopened, grant, undefined, options);
      assertEquals([grantProof.td.nonce, fourth.sad!.rd], [grant.said, reopened.regk]);
      assertEquals(fourth.sad!.n, "4", "a grant sender need not control the presentation registry");
      yield* baser.close(false);
      yield* baser.reopen({ reuse: true, readonly: true });
      registrar = new Registrar(yield* createRegery({ hby, baser }));
      assertEquals(registrar.rgy.registryByName("presenting")!.sn, 3n);
      assertThrows(() => registrar.vacate("presenting", options), Error);
      assertEquals(registrar.rgy.registryByName("presenting")!.sn, 3n);
    } finally {
      yield* baser.close(true);
      yield* hby.close(true);
    }
  });
});
