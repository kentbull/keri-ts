/** Python-recorded observations cross real public KEL/TEL and accepted IPEX boundaries. */
import { Registrar } from "@keri-ts/registrar";
import { b, parseBytes, SerderACDC } from "cesr-ts";
import { call, run } from "effection";
import { assert, assertEquals, assertObjectMatch, assertRejects } from "jsr:@std/assert";
import {
  createAgentRuntime,
  createHabery,
  FetchHttpClient,
  RegistryObserver,
  systemClock,
} from "keri-ts/runtime";
import { dispatchEnvelope, envelopeFromFrame } from "../../keri/src/app/protocol/parsering.ts";
import vectors from "../../keri/test/fixtures/keripy-ipex-state-vectors.json" with { type: "json" };
import { AcdcV2Verifier } from "../mod.ts";

Deno.test("accepted IPEX observations survive refresh and reopen without replacing first disclosures", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const hab = hby.makeHab("inspector"), http = new FetchHttpClient();
    const runtime = yield* createAgentRuntime(hby, http, systemClock);
    const registry = runtime.acdc!.store;
    const observer = new RegistryObserver(hby.db, registry), exchanger = runtime.exc;
    const inspector = new AcdcV2Verifier(hby, hab, exchanger, new Registrar(runtime.protocol, registry), http, {
      source: "https://observer.example",
      maximumAgeMs: 10000,
      requestTimeoutMs: 1000,
      now: Date.now,
    });
    const observations = (said: string) =>
      [...hby.db.exrs.getTopItemIter([said])]
        .map(([keys, record]) => ({ node: keys[1], ...record.asDict() }));
    const expectedObservations = new Map<string, unknown>();
    const views = new Map<string, { nests: string[]; paths: string[] }>();
    let through = 0;
    try {
      assertEquals(vectors.reference, "1f0f68a6ad44a8d159cbbb2bab7bb243bc7a0337");
      for (const row of vectors.cases) {
        while (through < row.through) {
          const item = vectors.support[through++];
          const [frame] = parseBytes(b(item.wire));
          if (item.kind === "kel") yield* dispatchEnvelope(envelopeFromFrame(frame), hby.rvy, hby.kevery);
          else {
            assert(frame.body instanceof SerderACDC);
            assertEquals(observer.processEvent(frame.body).kind, "accept");
          }
        }
        const [frame] = parseBytes(b(row.wire));
        if (row.name === "different Grant has independent observations") {
          const pin = hby.db.exrs.pin;
          try {
            hby.db.exrs.pin = () => {
              throw new Error("observation write failed");
            };
            yield* call(() =>
              assertRejects(
                () => run(() => exchanger.processEvent(envelopeFromFrame(frame))),
                Error,
                "observation write failed",
              )
            );
          } finally {
            hby.db.exrs.pin = pin;
          }
          assertEquals(hby.db.exns.get(row.said), null);
          assertEquals(hby.db.enst.get(row.said), []);
          assertEquals(hby.db.epath.get(row.said), []);
          assertEquals(observations(row.said), [], "publication failure rolls back evidence and observations together");
        }
        const decision = yield* exchanger.processEvent(envelopeFromFrame(frame));
        assertEquals(decision.kind, row.typescriptOutcome ?? row.outcome, `${row.name}: ${JSON.stringify(decision)}`);
        assertEquals(exchanger.complete(row.said), row.accepted);
        expectedObservations.set(row.said, row.observations);
        for (const [said, expected] of expectedObservations) assertEquals(observations(said), expected, row.name);
        if (!row.accepted) {
          yield* hby.db.reopen();
          assertEquals(observations(row.said), [], "refusal/escrow cannot create registry observations after reopen");
          continue;
        }
        const view = { nests: hby.db.enst.get(row.said), paths: hby.db.epath.get(row.said) };
        const first = views.get(row.said);
        if (first) {
          assertEquals(view, first, `${row.name}: accepted proof/path alternatives never replace the first view`);
        } else views.set(row.said, view);
        const before = observations(row.said);
        exchanger.verifyAccepted(row.said, "/ipex/grant");
        assert(exchanger.verifyAccepted(row.said, "/ipex/grant", { historical: true }));
        const inspection = inspector.inspectHistorical(row.said);
        assertEquals(
          observations(row.said),
          before,
          "current/historical inspection never refreshes recorded observations",
        );
        assertObjectMatch(inspection, { currentStanding: "not-evaluated", recordedRegistryStates: row.observations });
        yield* hby.db.reopen();
        assertEquals(inspector.inspectHistorical(row.said), inspection, "inspection is stable across Baser reopen");
      }
    } finally {
      yield* call(() => runtime.close());
      yield* hby.close(true);
    }
  });
});
