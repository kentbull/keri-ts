/** Frozen registry decisions use independently signed KELs through the real runtime. */
import { b, BlindState, BoundState, Diger, NumberPrimitive, parseBytes, Saider, SerderACDC } from "cesr-ts";
import { call, run } from "effection";
import { assertEquals, assertThrows } from "jsr:@std/assert";
import { acdcmap, blindate, regcept } from "../../../src/acdc/messaging.ts";
import { RegistryObserver } from "../../../src/acdc/observing.ts";
import { RegistryEventer } from "../../../src/acdc/regengine.ts";
import {
  type RegistryDisclosure,
  type RegistryVerification,
  validateRip,
  validateUpdate,
  verifyRegistryAnchor,
  vet,
  vetBinds,
} from "../../../src/acdc/regeventing.ts";
import { openRegistry, RegistryStore } from "../../../src/acdc/registering.ts";
import { createRegery } from "../../../src/acdc/registraring.ts";
import { FailedSchemaValidationError, MissingSchemaError } from "../../../src/acdc/scheming.ts";
import { acceptedEventReplayMessage, createHabery, type Habery } from "../../../src/app/habbing.ts";
import { dispatchEnvelope, envelopeFromFrame } from "../../../src/app/parsering.ts";
import { receipt } from "../../../src/core/protocol-eventing.ts";
import { makeNowIso8601, timestampMicros } from "../../../src/time/mod.ts";
import fixture from "../../fixtures/keripy-registry-vectors.json" with { type: "json" };

/** Hydrate parsed semantic disclosures; recomputation belongs to the verifier. */
function disclosure(name: string): RegistryDisclosure {
  const value = fixture.disclosures[name as keyof typeof fixture.disclosures];
  return "bn" in value ? BoundState.fromSad(value) : BlindState.fromSad(value);
}
/** Process only real signed bootstrap material and release each parsed frame. */
async function ingest(hby: Habery, wire: string | Uint8Array): Promise<void> {
  for (const frame of await parseBytes(typeof wire === "string" ? b(wire) : wire)) {
    {
      await run(() => dispatchEnvelope(envelopeFromFrame(frame), hby.rvy, hby.kevery));
    }
  }
}

Deno.test("shared registry time preserves exact microseconds and injected clock formatting", () => {
  for (
    const [text, expected] of [
      ["1970-01-01T00:00:00Z", 0n],
      ["1970-01-01T00:00:00.1+00:00", 100000n],
      ["1970-01-01T00:00:00.000001Z", 1n],
      ["1969-12-31T23:59:59.999999Z", -1n],
      ["1970-01-01T01:00:00.000001+01:00", 1n],
      ["1969-12-31T23:00:00.000001-01:00", 1n],
      ["2000-02-29T00:00:00Z", 951782400000000n],
    ] as const
  ) {
    assertEquals(timestampMicros(text), expected, text);
  }
  for (
    const invalid of [
      null,
      0,
      "2026-10-13T01:00:01.000001",
      "2026-02-30T01:00:00+00:00",
      "1900-02-29T00:00:00Z",
      "2026-10-13T24:00:00Z",
      "2026-10-13T01:00:01.0000001Z",
      "2026-10-13T01:00:01+24:00",
      "2026-10-13T01:00:01+01:60",
    ]
  ) {
    assertEquals(timestampMicros(invalid), null, String(invalid));
  }
  assertEquals(
    makeNowIso8601(new Date("2026-10-13T02:00:01.123+01:00")),
    "2026-10-13T01:00:01.123000+00:00",
  );
});

Deno.test("v2 registry vetting matches frozen decisions through missing evidence, binding and historical changes", async () => {
  assertEquals(fixture.reference, "927c0cb8794d7c84fc17143c67df64aab9deda6c");
  const bodies = new Map(Object.entries(fixture.bodies).map(([name, raw]) => [name, new SerderACDC({ raw: b(raw) })]));
  await run(function*() {
    const hby = yield* createHabery({ name: `registry-vetting-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    try {
      let through = 0;
      for (const row of fixture.cases) {
        while (through < row.through) {
          const wire = fixture.wires[through++];
          yield* call(() => ingest(hby, wire));
        }
        const sources = new Map(
          Object.entries(row.source ?? {}).map(([key, value]) => [bodies.get(key)!.said!, value]),
        );
        const args = {
          db: hby.db,
          rip: bodies.get(row.rip)!,
          updates: row.updates.map((key) => bodies.get(key)!),
          acdc: row.acdc ? bodies.get(row.acdc) : undefined,
          sources,
        };
        const result: RegistryVerification = row.blinders
          ? vetBinds({
            ...args,
            blinders: row.blinders.map(disclosure),
            target: bodies.get(row.target!)!.said!,
            cutoff: row.cutoff ?? undefined,
            controller: row.controller ?? undefined,
            requireSource: row.requireSource,
          })
          : vet({ ...args, blinder: row.blinder ? disclosure(row.blinder) : undefined });
        if (result.kind === "verified") {
          assertEquals<unknown>(
            { ...result, state: { ...result.state, sn: result.state.sn.toString() } },
            row.expected,
            row.name,
          );
        } else {
          assertEquals({ kind: result.kind, reason: result.reason }, row.expected, row.name);
        }
      }
      // All evidence came from accepted KEL events; a storage fault is never a remote refusal.
      const db = hby.db;
      const get = db.getKever;
      const failed = new Error("storage unavailable");
      try {
        db.getKever = () => {
          throw failed;
        };
        assertThrows(() => vet({ db, rip: bodies.get("rip")! }), Error, "storage unavailable");
      } finally {
        db.getKever = get;
      }
      const args = {
        db,
        rip: bodies.get("rip")!,
        updates: [bodies.get("issued")!],
        blinders: [disclosure("issued")],
        target: bodies.get("acdc")!.said!,
      };
      // The frozen issued state includes its exact timestamp and stays selected one microsecond later.
      const expected = fixture.cases.find((row) => row.name === "microsecond cutoff")!.expected;
      assertEquals(vetBinds({ ...args, cutoff: "2026-10-13T01:00:01.000000Z" }), {
        kind: "reject",
        reason: "binding",
      });
      for (const cutoff of ["2026-10-13T01:00:01.000001Z", "2026-10-13T01:00:01.000002Z"]) {
        const result = vetBinds({ ...args, cutoff });
        assertEquals(result.kind, "verified", cutoff);
        if (result.kind === "verified") {
          assertEquals<unknown>(
            { ...result, state: { ...result.state, sn: result.state.sn.toString() } },
            expected,
            cutoff,
          );
        }
      }
      assertEquals(vetBinds({ ...args, cutoff: "2026-02-30T01:00:00+00:00" }), {
        kind: "reject",
        reason: "timestamp",
      });
      assertEquals(vetBinds({ ...args, cutoff: "2026-10-13T01:00:01.000001" }), {
        kind: "reject",
        reason: "timestamp",
      });
      assertEquals(
        vetBinds({ ...args, cutoff: "2026-10-13T02:00:01.000001+01:00" }),
        vetBinds({ ...args, cutoff: "2026-10-13T01:00:01.000001Z" }),
      );
      assertThrows(
        () =>
          vet({
            db,
            rip: bodies.get("rip")!,
            sources: new Map([[bodies.get("rip")!.said!, Number.MAX_SAFE_INTEGER + 1]]),
          }),
        RangeError,
      );
    } finally {
      yield* hby.close(true);
    }
  });
});
Deno.test("registry field validation shares parsed facts without accepting a chain", () => {
  const body = (name: keyof typeof fixture.bodies) => new SerderACDC({ raw: b(fixture.bodies[name]) });
  const rip = body("rip"), update = body("issued");
  assertEquals(regcept(rip.issuer!, { uuid: rip.sad!.u as string, stamp: rip.sad!.dt as string }).raw, rip.raw);
  assertEquals(
    blindate(rip.said!, rip.said!, update.sad!.b as string, { stamp: update.sad!.dt as string }).raw,
    update.raw,
  );
  const inception = validateRip(rip, rip.issuer!);
  assertEquals(inception.kind, "valid");
  if (inception.kind === "valid") {
    assertEquals(inception.event, {
      serder: rip,
      said: rip.said!,
      ilk: "rip",
      regid: rip.said!,
      sn: 0n,
      prior: null,
      issuer: rip.issuer,
    });
  }
  assertEquals(validateRip(update), { kind: "reject", reason: "event" });
  assertEquals(validateRip(body("bad-n")), { kind: "reject", reason: "sequence" });
  assertEquals(validateRip(rip, body("wrong-issuer-acdc").issuer!), { kind: "reject", reason: "issuer" });
  assertEquals(validateUpdate(rip, rip.said!), { kind: "reject", reason: "event" });
  assertEquals(validateUpdate(body("wrong-registry"), rip.said!), { kind: "reject", reason: "registry" });
  assertEquals(validateUpdate(body("wrong-prior"), rip.said!, rip.said!), { kind: "reject", reason: "prior" });
  assertEquals(validateUpdate(body("gap"), rip.said!).kind, "valid", "sequence continuity belongs to the engine");
  assertEquals(validateUpdate(update, rip.said!, rip.said!).kind, "valid");
  assertEquals(validateUpdate(blindate(rip.said!, rip.said!, update.sad!.b as string, { sn: 0 }), rip.said!), {
    kind: "reject",
    reason: "sequence",
  });
});
Deno.test("local registry anchors require the full seal and verified witness receipts", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: `registry-anchor-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    const witnessHby = yield* createHabery({
      name: `registry-witness-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });
    try {
      const witness = witnessHby.makeHab("witness", undefined, { transferable: false });
      const issuer = hby.makeHab("issuer", undefined, { wits: [witness.pre], toad: 1 });
      const rip = regcept(issuer.pre), validated = validateRip(rip, issuer.pre);
      if (validated.kind !== "valid") throw new Error("Expected valid registry inception");
      const event = validated.event;
      const db = hby.db;
      const seal = { i: rip.said!, s: "0", d: rip.said! };
      // Observer digest vetting deliberately permits all four seals; the local path permits only the last.
      for (const candidate of [rip.said!, { ...seal, i: issuer.pre }, { ...seal, s: "1" }, seal]) {
        issuer.interact({ data: [candidate] });
        const anchor = issuer.kever!.serder;
        const claim = {
          db,
          issuer: issuer.pre,
          number: NumberPrimitive.fromNum(BigInt(anchor.sn!)),
          diger: new Diger({ qb64: anchor.said! }),
        };
        assertEquals(verifyRegistryAnchor(event, claim), false, "not yet fully witnessed");
        hby.kevery.processReceipt({
          serder: receipt(issuer.pre, anchor.sn!, anchor.said!),
          cigars: witness.sign(anchor.raw, false),
          wigers: [],
          tsgs: [],
          local: false,
        });
        assertEquals(db.fullyWitnessed(anchor), true);
        assertEquals(vet({ db, rip }).kind, "verified");
        assertEquals(verifyRegistryAnchor(event, claim), candidate === seal);
        assertEquals(verifyRegistryAnchor(event, { ...claim, diger: new Diger({ qb64: rip.said! }) }), false);
      }
      assertEquals(verifyRegistryAnchor(event, { db, issuer: issuer.pre }), false);
      assertEquals(
        verifyRegistryAnchor(event, {
          db,
          issuer: issuer.pre,
          number: NumberPrimitive.fromNum(2n ** 53n + 1n),
          diger: new Diger({ qb64: rip.said! }),
        }),
        false,
      );
      const claim = {
        db,
        issuer: issuer.pre,
        number: NumberPrimitive.fromNum(BigInt(issuer.kever!.sn)),
        diger: new Diger({ qb64: issuer.kever!.said }),
      };
      const read = db.getEvtSerder;
      try {
        db.getEvtSerder = () => {
          throw new Error("anchor database unavailable");
        };
        assertThrows(() => verifyRegistryAnchor(event, claim), Error, "anchor database unavailable");
      } finally {
        db.getEvtSerder = read;
      }
    } finally {
      yield* witnessHby.close(true);
      yield* hby.close(true);
    }
  });
});

Deno.test("registry inception atomically accepts or escrows without overwriting an accepted slot", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: `registry-engine-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    const baser = yield* openRegistry({ name: `registry-engine-${crypto.randomUUID()}`, temp: true });
    try {
      const store = new RegistryStore(baser), issuer = hby.makeHab("issuer");
      const rip = regcept(issuer.pre);
      let engine = new RegistryEventer(hby.db, issuer.pre, store);
      const foreign = regcept(hby.makeHab("foreign").pre);
      assertEquals(engine.processEvent(foreign), { kind: "reject", reason: "issuer" });
      assertEquals(store.event(foreign.said!), null);
      assertEquals(engine.regk, null);
      assertEquals(engine.processEvent(rip).kind, "escrow");
      assertEquals(store.event(rip.said!)!.raw, rip.raw);
      assertEquals(store.seqSaider(rip.said!, 0), null);
      assertEquals(store.head(rip.said!), null);
      assertEquals(baser.maes!.get(rip.said!, 0), [[rip.said!]]);
      assertEquals(engine.regk, rip.said);
      yield* baser.close(false);
      yield* baser.reopen({ reuse: true });
      engine = new RegistryEventer(hby.db, issuer.pre, store, rip.said!);
      issuer.interact({ data: [{ i: rip.said!, s: "0", d: rip.said! }] });
      assertEquals(engine.processEvent(rip).kind, "accept");
      assertEquals(store.seqSaider(rip.said!, 0)!.qb64, rip.said);
      assertEquals(store.head(rip.said!)!.qb64, rip.said);
      assertEquals(store.anchor(rip.said!)!.map((v) => v.qb64), [
        NumberPrimitive.fromNum(1n).qb64,
        issuer.kever!.said,
      ]);
      assertEquals(baser.maes!.get(rip.said!, 0), []);
      assertEquals(baser.ooes!.get(rip.said!, 0), []);
      assertEquals(engine.processEvent(rip).kind, "duplicate");
      assertEquals(store.head(rip.said!)!.qb64, rip.said);
      yield* baser.close(false);
      yield* baser.reopen({ reuse: true, readonly: true });
      engine = new RegistryEventer(hby.db, issuer.pre, store);
      assertEquals(engine.processEvent(rip).kind, "duplicate", "readonly replay requires no writable setup");
      assertEquals(engine.regk, rip.said);
      yield* baser.close(false);
      yield* baser.reopen({ reuse: true, readonly: false });
      const other = regcept(issuer.pre);
      assertEquals(engine.processEvent(other), { kind: "reject", reason: "registry" });
      assertEquals(store.event(other.said!), null);

      // A failure after tentative publication must roll back body, anchor, ordering and instance binding.
      const second = new RegistryEventer(hby.db, issuer.pre, store);
      issuer.interact({ data: [{ i: other.said!, s: "0", d: other.said! }] });
      const accept = store.accept;
      try {
        store.accept = function(...args) {
          accept.apply(this, args);
          throw new Error("registry write failed");
        };
        assertThrows(() => second.processEvent(other), Error, "registry write failed");
      } finally {
        store.accept = accept;
      }
      assertEquals([
        store.event(other.said!),
        store.anchor(other.said!),
        store.seqSaider(other.said!, 0),
        store.head(other.said!),
      ], [null, null, null, null]);
      assertEquals(second.regk, null);
      assertEquals(second.processEvent(other).kind, "accept");

      // A foreign registry body under an accepted marker is corruption, not a competing valid event.
      baser.tels.pinOn(rip.said!, 0, new Saider({ qb64: other.said! }));
      assertThrows(() => engine.processEvent(rip), Error, "Corrupt accepted registry event");
      assertEquals(store.seqSaider(rip.said!, 0)!.qb64, other.said);
      baser.evts.rem(other.said!);
      assertThrows(() => engine.processEvent(rip), Error, "Corrupt accepted registry event");
    } finally {
      yield* baser.close(true);
      yield* hby.close(true);
    }
  });
});
Deno.test("registry updates require accepted predecessors and preserve decided slots and heads", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: `registry-order-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    const baser = yield* openRegistry({ name: `registry-order-${crypto.randomUUID()}`, temp: true });
    try {
      const store = new RegistryStore(baser), issuer = hby.makeHab("issuer"), rip = regcept(issuer.pre);
      const engine = new RegistryEventer(hby.db, issuer.pre, store);
      const blid = fixture.disclosures.issued.d;
      const first = blindate(rip.said!, rip.said!, blid);
      const second = blindate(rip.said!, first.said!, blid, { sn: 2 });
      const wrong = blindate(rip.said!, rip.said!, blid, { sn: 2 });
      const competitor = blindate(rip.said!, first.said!, blid, { sn: 2, stamp: "2026-10-13T01:00:00Z" });
      assertEquals(engine.processEvent(first), { kind: "reject", reason: "event" });
      issuer.interact({ data: [{ i: rip.said!, s: "0", d: rip.said! }] });
      assertEquals(engine.processEvent(rip).kind, "accept");

      // Storing a body does not accept it. An unanchored successor first belongs in anchor escrow.
      store.putEvent(first);
      const unanchored = engine.processEvent(second);
      assertEquals(unanchored.kind === "escrow" && unanchored.reason, "anchor");
      assertEquals(baser.maes!.get(rip.said!, 2), [[second.said!]]);
      issuer.interact({ data: [{ i: rip.said!, s: "2", d: second.said! }] });
      const unordered = engine.processEvent(second);
      assertEquals(unordered.kind === "escrow" && unordered.reason, "order");
      assertEquals(baser.maes!.get(rip.said!, 2), []);
      assertEquals(baser.ooes!.get(rip.said!, 2), [[second.said!]]);
      assertEquals(store.seqSaider(rip.said!, 1), null);
      assertEquals(store.seqSaider(rip.said!, 2), null);
      assertEquals(store.head(rip.said!)!.qb64, rip.said);
      yield* baser.close(false);
      yield* baser.reopen({ reuse: true });
      assertEquals(baser.ooes!.get(rip.said!, 2), [[second.said!]], "order escrow survives reopen");
      issuer.interact({ data: [{ i: rip.said!, s: "1", d: first.said! }] });
      assertEquals(engine.processEvent(first).kind, "accept");
      assertEquals(engine.processEvent(wrong), { kind: "reject", reason: "prior" });
      assertEquals(store.event(wrong.said!), null);
      // Accepting the predecessor advances ready successors; later replay remains idempotent.
      assertEquals(engine.processEvent(second).kind, "duplicate");
      assertEquals(store.seqSaider(rip.said!, 2)!.qb64, second.said);
      assertEquals(store.head(rip.said!)!.qb64, second.said);
      assertEquals(baser.ooes!.get(rip.said!, 2), []);
      assertEquals(engine.processEvent(competitor), { kind: "reject", reason: "duplicity" });
      assertEquals(store.event(competitor.said!), null);
      for (const prior of [rip, first, second]) assertEquals(engine.processEvent(prior).kind, "duplicate");
      assertEquals(store.head(rip.said!)!.qb64, second.said);
      yield* baser.close(false);
      yield* baser.reopen({ reuse: true, readonly: true });
      assertEquals(engine.processEvent(first).kind, "duplicate");
      yield* baser.close(false);
      yield* baser.reopen({ reuse: true, readonly: false });

      const foreign = blindate(issuer.pre, second.said!, blid, { sn: 3 });
      assertEquals(engine.processEvent(foreign), { kind: "reject", reason: "registry" });
      const huge = blindate(rip.said!, second.said!, blid, { sn: 2n ** 53n });
      assertEquals(engine.processEvent(huge), { kind: "reject", reason: "ordinalRange" });
      assertEquals(store.event(huge.said!), null, "unsafe ordinals are refused before storage conversion");

      const forgedRegistry = regcept(issuer.pre);
      const forgedUpdate = blindate(forgedRegistry.said!, rip.said!, blid);
      store.accept(forgedRegistry.said!, 0, rip);
      issuer.interact({ data: [{ i: forgedRegistry.said!, s: "1", d: forgedUpdate.said! }] });
      const forgedEngine = new RegistryEventer(hby.db, issuer.pre, store, forgedRegistry.said!);
      assertThrows(() => forgedEngine.processEvent(forgedUpdate), Error, "Corrupt accepted registry event");
      assertEquals(store.seqSaider(forgedRegistry.said!, 1), null);
      store.putEvent(forgedRegistry);
      baser.heads.pin(rip.said!, new Saider({ qb64: forgedRegistry.said! }));
      const third = blindate(rip.said!, second.said!, blid, { sn: 3 });
      issuer.interact({ data: [{ i: rip.said!, s: "3", d: third.said! }] });
      assertThrows(() => engine.processEvent(third), Error, "Corrupt registry head");
      assertEquals(store.seqSaider(rip.said!, 3), null);
      baser.heads.pin(rip.said!, new Saider({ qb64: second.said! }));

      // A surviving higher head prevents a rollback even when its accepted slot was damaged.
      baser.tels.remOn(rip.said!, 2);
      assertThrows(() => engine.processEvent(second), Error, "Corrupt registry head ordinal");
      assertEquals(store.head(rip.said!)!.qb64, second.said);
      baser.evts.rem(first.said!);
      assertThrows(() => engine.processEvent(second), Error, "Corrupt accepted registry event");
    } finally {
      yield* baser.close(true);
      yield* hby.close(true);
    }
  });
});
Deno.test("registry anchor retry selects verified siblings independently of arrival order", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: `registry-retry-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    const baser = yield* openRegistry({ name: `registry-retry-${crypto.randomUUID()}`, temp: true });
    try {
      const store = new RegistryStore(baser), issuer = hby.makeHab("issuer"), rip = regcept(issuer.pre);
      const engine = new RegistryEventer(hby.db, issuer.pre, store);
      engine.processMissingAnchors();
      assertEquals(engine.processEvent(rip).kind, "escrow");
      engine.processMissingAnchors();
      assertEquals(store.head(rip.said!), null);
      issuer.interact({ data: [{ i: rip.said!, s: "0", d: rip.said! }] });
      engine.processMissingAnchors();
      assertEquals(store.head(rip.said!)!.qb64, rip.said);
      const blid = fixture.disclosures.issued.d;
      const candidates = [0, 1, 2].map((second) =>
        blindate(rip.said!, rip.said!, blid, {
          stamp: `2026-10-13T01:00:0${second}Z`,
        })
      );
      for (const event of candidates) assertEquals(engine.processEvent(event).kind, "escrow");
      // The last arrival gets the earliest anchor; an unanchored sibling cannot block it.
      for (const event of [candidates[2], candidates[0]]) {
        issuer.interact({ data: [{ i: rip.said!, s: "1", d: event.said! }] });
      }
      yield* baser.close(false);
      yield* baser.reopen({ reuse: true });
      engine.processMissingAnchors();
      const winner = candidates[2];
      assertEquals(store.seqSaider(rip.said!, 1)!.qb64, winner.said);
      assertEquals(baser.maes!.get(rip.said!, 1), []);
      assertEquals(baser.ooes!.get(rip.said!, 1), []);
      engine.processMissingAnchors();
      assertEquals(store.head(rip.said!)!.qb64, winner.said);

      // One KEL event may anchor competing siblings: SAID code-point order breaks the full-couple tie.
      const tied = [0, 1].map((second) =>
        blindate(rip.said!, winner.said!, blid, {
          sn: 2,
          stamp: `2026-10-13T01:01:0${second}Z`,
        })
      ).sort((a, b) => a.said! < b.said! ? -1 : 1);
      for (const event of [...tied].reverse()) engine.processEvent(event);
      issuer.interact({ data: tied.map((event) => ({ i: rip.said!, s: "2", d: event.said! })) });
      engine.processMissingAnchors();
      assertEquals(store.seqSaider(rip.said!, 2)!.qb64, tied[0].said);

      // Dangling/stale candidates are removable; an infrastructure fault is not a validation decision.
      const invalid = blindate(rip.said!, winner.said!, blid, { sn: 3 });
      store.putEvent(invalid);
      store.escrowMissingAnchor(rip.said!, 3, invalid.said!);
      store.escrowMissingAnchor(rip.said!, 3, issuer.kever!.said);
      const get = store.event;
      try {
        store.event = () => {
          throw new Error("retry read failed");
        };
        assertThrows(() => engine.processMissingAnchors(), Error, "retry read failed");
        assertEquals(baser.maes!.get(rip.said!, 3).length, 2);
      } finally {
        store.event = get;
      }
      engine.processMissingAnchors();
      assertEquals(baser.maes!.get(rip.said!, 3), []);
      assertEquals(store.head(rip.said!)!.qb64, tied[0].said);
    } finally {
      yield* baser.close(true);
      yield* hby.close(true);
    }
  });
});
Deno.test("registry queued replay retains earliest anchors and advances a contiguous chain", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: `registry-queued-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    const baser = yield* openRegistry({ name: `registry-queued-${crypto.randomUUID()}`, temp: true });
    try {
      const store = new RegistryStore(baser), issuer = hby.makeHab("issuer"), rip = regcept(issuer.pre);
      const engine = new RegistryEventer(hby.db, issuer.pre, store);
      engine.processEvent(rip);
      issuer.interact({ data: [{ i: rip.said!, s: "0", d: rip.said! }] });
      assertEquals(engine.anchorMsg(rip.said!).kind, "accept");
      const blid = fixture.disclosures.issued.d;
      const first = blindate(rip.said!, rip.said!, blid);
      const winner = blindate(rip.said!, first.said!, blid, { sn: 2 });
      const loser = blindate(rip.said!, first.said!, blid, { sn: 2, stamp: "2026-10-13T02:00:00Z" });
      const third = blindate(rip.said!, winner.said!, blid, { sn: 3 });
      const stale = blindate(rip.said!, first.said!, blid, { sn: 3 });
      for (const event of [first, loser, winner, stale, third]) engine.processEvent(event);
      assertEquals(engine.anchorMsg(issuer.pre), { kind: "reject", reason: "event" });
      assertEquals(engine.anchorMsg(first.said!, NumberPrimitive.fromNum(0n)), { kind: "reject", reason: "anchor" });
      assertEquals(store.anchor(first.said!), null);
      for (const event of [winner, loser, third, stale]) {
        issuer.interact({ data: [{ i: rip.said!, s: event.sad!.n, d: event.said! }] });
        const decision = engine.anchorMsg(
          event.said!,
          NumberPrimitive.fromNum(BigInt(issuer.kever!.sn)),
          new Diger({ qb64: issuer.kever!.said }),
        );
        assertEquals(decision.kind === "escrow" && decision.reason, "order");
      }
      const earliest = store.anchor(winner.said!)!.map((value) => value.qb64);
      issuer.interact({ data: [{ i: rip.said!, s: "2", d: winner.said! }] });
      assertEquals(
        engine.anchorMsg(
          winner.said!,
          NumberPrimitive.fromNum(BigInt(issuer.kever!.sn)),
          new Diger({ qb64: issuer.kever!.said }),
        ).kind,
        "escrow",
      );
      assertEquals(store.anchor(winner.said!)!.map((value) => value.qb64), earliest);
      assertEquals(
        engine.anchorMsg(
          first.said!,
          NumberPrimitive.fromNum(BigInt(issuer.kever!.sn)),
          new Diger({ qb64: issuer.kever!.said }),
        ),
        { kind: "reject", reason: "anchor" },
      );
      assertEquals(store.anchor(first.said!), null);
      yield* baser.close(false);
      yield* baser.reopen({ reuse: true });
      issuer.interact({ data: [{ i: rip.said!, s: "1", d: first.said! }] });
      engine.processEscrows();
      assertEquals(store.head(rip.said!)!.qb64, third.said);
      assertEquals(store.seqSaider(rip.said!, 2)!.qb64, winner.said);
      assertEquals([...baser.maes!.getTopItemIter(rip.said!)], []);
      assertEquals([...baser.ooes!.getTopItemIter(rip.said!)], []);
      assertEquals(engine.anchorMsg(winner.said!).kind, "duplicate");
      assertEquals(store.head(rip.said!)!.qb64, third.said);

      const badPrior = blindate(rip.said!, first.said!, blid, { sn: 4 });
      store.putEvent(badPrior);
      issuer.interact({ data: [{ i: rip.said!, s: "4", d: badPrior.said! }] });
      assertEquals(
        engine.anchorMsg(
          badPrior.said!,
          NumberPrimitive.fromNum(BigInt(issuer.kever!.sn)),
          new Diger({ qb64: issuer.kever!.said }),
        ),
        { kind: "reject", reason: "prior" },
      );
      assertEquals(store.anchor(badPrior.said!), null, "validation precedes explicit anchor persistence");
    } finally {
      yield* baser.close(true);
      yield* hby.close(true);
    }
  });
});
Deno.test("registry blind updates extend one staged frontier across reopen and refuse forks", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const baser = yield* openRegistry({ name: crypto.randomUUID(), temp: true });
    try {
      let rgy = yield* createRegery({ hby, baser });
      const issuer = hby.makeHab("issuer"), other = hby.makeHab("other");
      let registry = rgy.makeRegistry("local", issuer.pre);
      const regid = registry.regk!, acdc = acdcmap(issuer.pre, { regid, attribute: { d: "", name: "Alice" } });
      const options = { raw: b("0123456789abcdef"), stamp: "2026-10-13T01:00:00.000001Z" };
      assertThrows(() => registry.blind(acdc, "issued", options), Error, "must be anchored");
      issuer.interact({ data: [{ i: regid, s: "0", d: regid }] });
      assertEquals(registry.anchorMsg(regid).kind, "accept");
      assertThrows(() => registry.blind({} as SerderACDC, "issued"), Error, "self-verifying");
      const tampered = new SerderACDC({
        raw: b(new TextDecoder().decode(acdc.raw).replace(issuer.pre, other.pre)),
        verify: false,
      });
      assertThrows(() => registry.blind(tampered, "issued"), Error, "self-verifying");
      assertThrows(
        () => registry.blind(acdcmap(issuer.pre, { attribute: { d: "" } }), "issued"),
        Error,
        "another registry",
      );
      assertThrows(
        () => registry.blind(acdcmap(other.pre, { regid, attribute: { d: "" } }), "issued"),
        Error,
        "another issuer",
      );
      assertThrows(
        () => registry.blind(acdc, "issued", { ...options, ...{ blinder: disclosure("issued") } }),
        Error,
        "blinder overrides",
      );
      // This additional 71438328 gate preserves all frozen927 proof/frontier assertions below.
      const invalid = acdcmap(issuer.pre, {
        regid,
        schema: { $id: "", version: "1.0.0", type: "object", properties: { a: { type: "string" } } },
        attribute: { d: "" },
      });
      assertThrows(() => registry.blind(invalid, "issued", options), FailedSchemaValidationError);
      const missing = acdcmap(issuer.pre, { regid, schema: issuer.pre, attribute: { d: "" } });
      assertThrows(() => registry.blind(missing, "issued", options), MissingSchemaError);
      assertEquals(baser.maes!.get(regid, 1), [], "schema refusal precedes disclosure/event publication");
      assertEquals([...baser.evts.getTopItemIter()].length, 1, "refused credentials publish no event bodies");
      const [issued, first] = registry.blind(acdc, "issued", options);
      assertEquals([issued.td.nonce, issued.ts.text, first.sad!.n, first.sad!.p, first.sad!.b], [
        acdc.said,
        "issued",
        "1",
        regid,
        issued.d.nonce,
      ]);
      const [revoked, second] = registry.blind(acdc, "revoked", {
        ...options,
        bound: true,
        bsn: 1n,
        bd: issuer.kever!.said,
      });
      assertEquals([second.sad!.n, second.sad!.p, second.sad!.b], ["2", first.said, revoked.d.nonce]);
      assertEquals("bn" in revoked && revoked.bn.num, 1n);
      assertEquals("bd" in revoked && revoked.bd.nonce, issuer.kever!.said);
      assertEquals(issued.u.nonce === revoked.u.nonce, false, "ordinal changes the derived UUID");
      assertEquals(registry.sn, 0n, "staged updates do not establish acceptance");
      // Duplicate sightings across both escrow families are one successor; stale prior/dangling rows are not.
      rgy.store.escrowOutOfOrder(regid, 1, first.said!);
      const stale = blindate(regid, regid, issued.d.nonce, { sn: 2 });
      rgy.store.putEvent(stale);
      rgy.store.escrowMissingAnchor(regid, 2, stale.said!);
      rgy.store.escrowMissingAnchor(regid, 2, issuer.pre);
      yield* baser.close(false);
      yield* baser.reopen({ reuse: true });
      rgy = yield* createRegery({ hby, baser });
      registry = rgy.registryByName("local")!;
      const [reissued, third] = registry.blind(acdc, "issued", options);
      assertEquals([third.sad!.n, third.sad!.p, third.sad!.b], ["3", second.said, reissued.d.nonce]);
      const put = rgy.store.putEvent;
      try {
        rgy.store.putEvent = () => {
          throw new Error("blind storage failed");
        };
        assertThrows(() => registry.blind(acdc, "issued", options), Error, "blind storage failed");
      } finally {
        rgy.store.putEvent = put;
      }
      assertEquals(baser.maes!.get(regid, 4), []);
      const siblings = ["2026-10-13T02:00:00Z", "2026-10-13T02:00:01Z"].map((stamp) =>
        blindate(regid, third.said!, issued.d.nonce, { sn: 4, stamp })
      );
      for (const event of siblings) registry.processEvent(event);
      assertThrows(() => registry.blind(acdc, "issued", options), Error, "conflicting staged successors");
      assertEquals(baser.maes!.get(regid, 5), []);
      issuer.interact({ data: [first, second, third].map((event) => ({ i: regid, s: event.sad!.n, d: event.said! })) });
      registry.processEscrows();
      assertEquals([registry.sn, registry.head!.qb64], [3n, third.said]);
      const checked = vet({
        db: hby.db,
        rip: registry.regser!,
        updates: [first, second, third],
        blinder: reissued,
        acdc,
      });
      assertEquals(checked.kind, "verified");
    } finally {
      yield* baser.close(true);
      yield* hby.close(true);
    }
  });
});

Deno.test("public registry intake retries pre-inception updates from foreign public KEL after reopen", async () => {
  await run(function*() {
    const source = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const baser = yield* openRegistry({ name: crypto.randomUUID(), temp: true });
    try {
      const store = new RegistryStore(baser), witness = source.makeHab("witness", undefined, { transferable: false });
      const issuer = source.makeHab("issuer", undefined, { wits: [witness.pre], toad: 1 }), rip = regcept(issuer.pre);
      /** Verify a real foreign witness signature through the ordinary public receipt processor. */
      const witnessReceipt = () => {
        const anchor = issuer.kever!.serder;
        hby.kevery.processReceipt({
          serder: receipt(issuer.pre, anchor.sn!, anchor.said!),
          cigars: witness.sign(anchor.raw, false),
          wigers: [],
          tsgs: [],
          local: false,
        });
        hby.kevery.processEscrows();
      };
      const regid = rip.said!, blid = fixture.disclosures.issued.d;
      const first = blindate(regid, regid, blid), second = blindate(regid, first.said!, blid, { sn: 2 });
      let observer = new RegistryObserver(hby.db, store);
      for (const regid of ["", "not-a-SAID"]) {
        const invalid = blindate(regid, rip.said!, blid);
        assertEquals(invalid.verify(), true, "body SAID verification does not validate the registry reference");
        assertEquals(observer.processEvent(invalid), { kind: "reject", reason: "registry" });
        assertEquals(store.event(invalid.said!), null);
      }
      for (const event of [second, first]) {
        const decision = observer.processEvent(event);
        assertEquals(decision.kind === "escrow" && decision.reason, "inception");
        assertEquals(store.event(event.said!)!.raw, event.raw);
      }
      observer.processEscrows(regid);
      assertEquals([store.head(regid), store.seqSaider(regid, 0)], [null, null]);
      yield* baser.close(false);
      yield* baser.reopen({ reuse: true });
      observer = new RegistryObserver(hby.db, store);
      const pending = observer.processEvent(rip);
      assertEquals(pending.kind === "escrow" && pending.reason, "anchor");
      assertEquals([store.head(regid), ...[0, 1, 2].map((sn) => store.seqSaider(regid, sn))], [null, null, null, null]);
      yield* call(() => ingest(hby, acceptedEventReplayMessage(source, issuer.pre, 0).message));
      witnessReceipt();
      yield* call(() => ingest(hby, issuer.interact({ data: [regid] })));
      witnessReceipt();
      assertEquals(vet({ db: hby.db, rip }).kind, "verified", "digest-only observer vet is deliberately weaker");
      observer.processEscrows(regid);
      assertEquals(store.head(regid), null, "digest-only seals do not authorize public engine intake");
      const anchored = issuer.interact({
        data: [rip, first, second].map((event) => ({ i: regid, s: event.sad!.n, d: event.said! })),
      });
      yield* call(() => ingest(hby, anchored));
      observer.processEscrows(regid);
      assertEquals(store.head(regid), null, "full tuples without witness receipts remain unaccepted");
      witnessReceipt();
      observer.processEscrows(regid);
      assertEquals([0, 1, 2].map((sn) => store.seqSaider(regid, sn)!.qb64), [regid, first.said, second.said]);
      assertEquals(store.head(regid)!.qb64, second.said);
      assertEquals([...baser.maes!.getTopItemIter(regid), ...baser.ooes!.getTopItemIter(regid)], []);
      assertEquals(hby.habs.size, 0, "the observer has no local controlling habitat");
      assertEquals(store.records, null, "public intake creates no local aliases");
      assertEquals(observer.processEvent(rip).kind, "duplicate");
      assertEquals(observer.processEvent(first).kind, "duplicate");
      assertEquals(store.head(regid)!.qb64, second.said, "old prefix replay cannot downgrade the head");
      const wrong = blindate(regid, regid, blid, { sn: 2 });
      assertEquals(observer.processEvent(wrong), { kind: "reject", reason: "prior" });
      assertEquals(store.event(wrong.said!), null);
      const wrongRegistry = blindate(first.said!, first.said!, blid);
      assertEquals(observer.processEvent(wrongRegistry), { kind: "reject", reason: "registry" });
      assertEquals(store.event(wrongRegistry.said!), null);
      const competitor = blindate(regid, first.said!, blid, { sn: 2, stamp: "2026-10-13T01:00:00Z" });
      assertEquals(observer.processEvent(competitor), { kind: "reject", reason: "duplicity" });
      assertEquals(store.head(regid)!.qb64, second.said);
      const third = blindate(regid, second.said!, blid, { sn: 3 });
      assertEquals(observer.processEvent(third).kind, "escrow");
      observer.processEscrows(regid);
      assertEquals(store.head(regid)!.qb64, second.said, "unanchored successors cannot advance acceptance");

      // A later acceptance fault preserves the earlier prefix and its existing staged successor.
      yield* call(() => ingest(hby, issuer.interact({ data: [{ i: regid, s: "3", d: third.said! }] })));
      witnessReceipt();
      const accept = store.accept;
      store.accept = function(...args) {
        accept.apply(this, args);
        throw new Error("observer acceptance fault");
      };
      try {
        assertThrows(() => observer.processEscrows(regid), Error, "observer acceptance fault");
      } finally {
        store.accept = accept;
      }
      assertEquals([store.head(regid)!.qb64, store.seqSaider(regid, 3)], [second.said, null]);
      assertEquals(store.event(third.said!)!.raw, third.raw);
      observer.processEscrows(regid);
      assertEquals(store.head(regid)!.qb64, third.said);
      assertEquals(observer.processEvent(first).kind, "duplicate");
      assertEquals(store.head(regid)!.qb64, third.said);

      // Missing-inception staging also owns one rollback-capable transaction.
      const orphanRip = regcept(issuer.pre), orphan = blindate(orphanRip.said!, orphanRip.said!, blid);
      const escrow = store.escrowMissingAnchor;
      store.escrowMissingAnchor = function(...args) {
        escrow.apply(this, args);
        throw new Error("observer staging fault");
      };
      try {
        assertThrows(() => observer.processEvent(orphan), Error, "observer staging fault");
      } finally {
        store.escrowMissingAnchor = escrow;
      }
      assertEquals([store.event(orphan.said!), store.head(orphanRip.said!)], [null, null]);
      assertEquals(baser.maes!.get(orphanRip.said!, 1), []);
      baser.evts.pin(regid, orphanRip);
      assertThrows(() => observer.processEscrows(regid), Error, "Corrupt observer registry inception");
      assertEquals(store.head(regid)!.qb64, third.said);
      baser.evts.pin(regid, rip);
      const head = store.head(regid)!;
      baser.evts.rem(regid);
      assertThrows(() => observer.processEvent(first), Error, "Corrupt observer registry inception");
      baser.heads.rem(regid);
      assertThrows(() => observer.processEscrows(regid), Error, "Corrupt observer registry inception");
      assertEquals(store.event(regid), null, "accepted markers cannot turn body loss into missing-inception staging");
      assertEquals(store.seqSaider(regid, 0)!.qb64, regid);
      baser.heads.pin(regid, head);
      baser.evts.pin(regid, rip);
      yield* baser.close(false);
      yield* baser.reopen({ reuse: true, readonly: true });
      observer = new RegistryObserver(hby.db, store);
      assertEquals(observer.processEvent(second).kind, "duplicate", "readonly accepted replay opens no writer");
      assertThrows(() => observer.processEvent(orphan), Error, "readonly");
      assertThrows(() => observer.processEvent(orphanRip), Error, "readonly");
      assertThrows(() => observer.processEvent(blindate(regid, third.said!, blid, { sn: 4 })), Error, "readonly");
      assertEquals(
        [baser.opened, hby.db.opened, source.db.opened],
        [true, true, true],
        "intake borrows all lifecycle owners",
      );
    } finally {
      yield* baser.close(true);
      yield* hby.close(true);
      yield* source.close(true);
    }
  });
});

Deno.test("registry anchors keep their historical receipt requirement after witness removal", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const whby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    try {
      const witness = whby.makeHab("witness", undefined, { transferable: false });
      const issuer = hby.makeHab("issuer", undefined, { wits: [witness.pre], toad: 1 });
      const rip = regcept(issuer.pre), validated = validateRip(rip, issuer.pre);
      if (validated.kind !== "valid") throw new Error("Expected valid registry inception");
      issuer.interact({ data: [{ i: rip.said!, s: "0", d: rip.said! }] });
      const anchor = issuer.kever!.serder;
      const claim = {
        db: hby.db,
        issuer: issuer.pre,
        number: NumberPrimitive.fromNum(BigInt(anchor.sn!)),
        diger: new Diger({ qb64: anchor.said! }),
      };
      assertEquals(verifyRegistryAnchor(validated.event, claim), false);
      issuer.rotate({ cuts: [witness.pre], toad: 0 });
      assertEquals(
        verifyRegistryAnchor(validated.event, claim),
        false,
        "removing the witness cannot authenticate an old registry anchor",
      );
      hby.kevery.processReceipt({
        serder: receipt(issuer.pre, anchor.sn!, anchor.said!),
        cigars: witness.sign(anchor.raw, false),
        wigers: [],
        tsgs: [],
        local: false,
      });
      assertEquals(
        verifyRegistryAnchor(validated.event, claim),
        true,
        "the historical witness's late receipt proves the anchor",
      );
      issuer.rotate({ adds: [witness.pre], toad: 1 });
      assertEquals(verifyRegistryAnchor(validated.event, claim), true);
    } finally {
      yield* whby.close(true);
      yield* hby.close(true);
    }
  });
});
