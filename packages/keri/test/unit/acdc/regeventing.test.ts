/** Frozen registry decisions use independently signed KELs through the real runtime. */
import { b, BlindState, BoundState, Diger, discardFrame, NumberPrimitive, parseBytes, SerderACDC } from "cesr-ts";
import { call, run } from "effection";
import { assertEquals, assertThrows } from "jsr:@std/assert";
import { blindate, regcept } from "../../../src/acdc/messaging.ts";
import {
  type RegistryDisclosure,
  type RegistryVerification,
  validateRip,
  validateUpdate,
  verifyRegistryAnchor,
  vet,
  vetBinds,
} from "../../../src/acdc/regeventing.ts";
import { createHabery, type Habery } from "../../../src/app/habbing.ts";
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
async function ingest(hby: Habery, wire: string): Promise<void> {
  for (const frame of await parseBytes(b(wire))) {
    try {
      await run(() => dispatchEnvelope(envelopeFromFrame(frame), hby.rvy, hby.kevery));
    } finally {
      await discardFrame(frame);
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
  assertEquals(
    validateUpdate(blindate(rip.said!, rip.said!, update.sad!.b as string, { sn: 0 }), rip.said!),
    { kind: "reject", reason: "sequence" },
  );
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
