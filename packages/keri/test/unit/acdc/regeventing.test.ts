/** Frozen registry decisions use independently signed KELs through the real runtime. */
import { b, BlindState, BoundState, discardFrame, parseBytes, SerderACDC } from "cesr-ts";
import { call, run } from "effection";
import { assertEquals, assertThrows } from "jsr:@std/assert";
import {
  type RegistryDisclosure,
  type RegistryVerification,
  vet,
  vetBinds,
} from "../../../src/acdc/regeventing.ts";
import { createHabery, type Habery } from "../../../src/app/habbing.ts";
import { dispatchEnvelope, envelopeFromFrame } from "../../../src/app/parsering.ts";
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
