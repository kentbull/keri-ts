/** Frozen registry decisions use independently signed KELs through the real runtime. */
import { b, BlindState, BoundState, discardFrame, parseBytes, SerderACDC } from "cesr-ts";
import { call, run } from "effection";
import { assertEquals, assertThrows } from "jsr:@std/assert";
import {
  type RegistryDisclosure,
  type RegistryVerification,
  vetRegistry,
  vetRegistryBindings,
} from "../../../src/acdc/regeventing.ts";
import { createHabery, type Habery } from "../../../src/app/habbing.ts";
import { dispatchEnvelope, envelopeFromFrame } from "../../../src/app/parsering.ts";
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
          ? vetRegistryBindings({
            ...args,
            blinders: row.blinders.map(disclosure),
            target: bodies.get(row.target!)!.said!,
            cutoff: row.cutoff ?? undefined,
            controller: row.controller ?? undefined,
            requireSource: row.requireSource,
          })
          : vetRegistry({ ...args, blinder: row.blinder ? disclosure(row.blinder) : undefined });
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
        assertThrows(() => vetRegistry({ db, rip: bodies.get("rip")! }), Error, "storage unavailable");
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
      assertEquals(vetRegistryBindings({ ...args, cutoff: "2026-02-30T01:00:00+00:00" }), {
        kind: "reject",
        reason: "timestamp",
      });
      assertEquals(vetRegistryBindings({ ...args, cutoff: "2026-10-13T01:00:01.000001" }), {
        kind: "reject",
        reason: "timestamp",
      });
      assertEquals(
        vetRegistryBindings({ ...args, cutoff: "2026-10-13T02:00:01.000001+01:00" }),
        vetRegistryBindings({ ...args, cutoff: "2026-10-13T01:00:01.000001Z" }),
      );
      assertThrows(
        () =>
          vetRegistry({
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
