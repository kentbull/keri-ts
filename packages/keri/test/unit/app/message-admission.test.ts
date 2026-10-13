/** Non-event policy gates precede real route acceptance and retain borrowed ownership. */
import { b, Diger, discardFrame, essrPayload, parseBytes, Prefixer, SerderKERI, Vrsn_2_0 } from "cesr-ts";
import { call, run, spawn } from "effection";
import { assertEquals, assertExists, assertRejects } from "jsr:@std/assert";
import { createAgentRuntime } from "../../../src/app/agent-runtime.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { dispatchEnvelope, envelopeFromFrame } from "../../../src/app/parsering.ts";
import { Reactor } from "../../../src/app/reactor.ts";
import { TransIdxSigGroup } from "../../../src/core/dispatch.ts";
import { Kevery, type QueryEnvelope } from "../../../src/core/eventing.ts";
import { exchange } from "../../../src/core/protocol-exchanging.ts";
import { serializeMessage } from "../../../src/core/protocol-serialization.ts";
import { Revery } from "../../../src/core/routing.ts";
import fixture from "../../fixtures/keripy-admission-vectors.json" with { type: "json" };
import ipex from "../../fixtures/keripy-ipex-vectors.json" with { type: "json" };

Deno.test("v2 non-event dispatch matches frozen processMsg delegation and prerequisite refusals", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    try {
      assertEquals(fixture.reference, "927c0cb8794d7c84fc17143c67df64aab9deda6c");
      for (const row of fixture.cases) {
        const [frame] = yield* call(() => parseBytes(b(row.wire)));
        try {
          const observed: { target: string; source: string | null; sigers: string[] }[] = [];
          /** Record delegation, without representing it as route verification. */
          const record = (target: string, query?: QueryEnvelope) => {
            observed.push({
              target,
              source: query?.source?.qb64 ?? null,
              sigers: query?.sigers?.map((s) => s.qb64) ?? [],
            });
          };
          const kevery = new Kevery(hby.db, {
            messagePolicy: { allowList: new Set(row.allow), denyList: new Set(row.deny) },
          });
          kevery.processQuery = (query) => record("kel-query", query);
          const revery = new Revery(hby.db);
          revery.processReply = () => {
            record("reply");
            return { kind: "accept" };
          };
          const result = yield* dispatchEnvelope(
            envelopeFromFrame(frame),
            revery,
            kevery,
            row.processor
              ? {
                *processEvent() {
                  record("exchange");
                },
              }
              : undefined,
            row.processor ? { tvy: { processQuery: (query) => record("tel-query", query) } } : {},
          );
          assertEquals(observed, row.observed, row.name);
          if (!row.observed.length) {
            assertEquals(result?.kind, "drop", row.name);
            if (result?.kind !== "drop") throw new Error(row.name);
            if (row.name.endsWith("reference stub")) assertEquals(result.reason, "referenceStub", row.name);
            if (row.name.endsWith("denied") || row.name === "deny wins") {
              assertEquals(result.reason, "deniedSender", row.name);
            }
            if (row.name === "allow excludes sender") assertEquals(result.reason, "senderNotAllowed", row.name);
            if (row.error) {
              assertEquals(
                ["missingAuthentication", "unsupportedRoute", "missingProcessor"].includes(result.reason),
                true,
                row.name,
              );
            }
          }
        } finally {
          yield* call(() => discardFrame(frame));
        }
      }
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("runtime sender policy blocks v2 effects while KEL and legacy traffic retain their own verification", async () => {
  await run(function*() {
    const source = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const target = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const sender = source.makeHab("sender");
    const wrong = source.makeHab("wrong");
    const denyList = new Set([sender.pre]);
    const runtime = yield* createAgentRuntime(target, {
      messagePolicy: { allowList: new Set([sender.pre]), denyList },
    });
    try {
      // The claimed-sender policy is not a KEL ingestion or cryptographic trust policy.
      for (const wire of source.db.clonePreIter(sender.pre)) yield* runtime.reactor.processBytes(wire);
      assertExists(target.db.getKever(sender.pre));
      const [parent] = exchange("/challenge/response", { words: ["sender", "policy"] }, {
        sender: sender.pre,
        pvrsn: Vrsn_2_0,
      });
      const group = new TransIdxSigGroup(
        new Prefixer({ qb64: sender.pre }),
        sender.kever!.sner,
        new Diger({ qb64: sender.kever!.said }),
        sender.sign(parent.raw, true),
      );
      const wire = serializeMessage(parent, { tsgs: [group], gvrsn: Vrsn_2_0 });
      yield* runtime.reactor.processBytes(wire);
      assertEquals(target.db.exns.get(parent.said!), null);
      assertEquals(target.db.epse.get(parent.said!), null);
      assertEquals(target.db.reps.get(sender.pre), []);
      denyList.clear();
      assertEquals(runtime.reactor.kevery.denyList.has(sender.pre), true, "configuration inputs are copied");
      const [legacy] = exchange("/challenge/response", { words: ["legacy"] }, { sender: sender.pre });
      yield* runtime.reactor.processBytes(sender.endorse(legacy));
      assertExists(target.db.exns.get(legacy.said!));
      runtime.reactor.kevery.denyList.clear();
      group.sigers.splice(0, group.sigers.length, ...wrong.sign(parent.raw, true));
      yield* runtime.reactor.processBytes(serializeMessage(parent, { tsgs: [group], gvrsn: Vrsn_2_0 }));
      assertEquals(target.db.exns.get(parent.said!), null, "allowance does not authenticate signatures");
      yield* runtime.reactor.processBytes(wire);
      assertExists(target.db.exns.get(parent.said!));
      assertEquals(target.db.reps.get(sender.pre).map((d) => d.qb64), [legacy.said, parent.said]);
    } finally {
      yield* runtime.close();
      yield* target.close(true);
      yield* source.close(true);
    }
  });
});

Deno.test("refused nested evidence is disposed with joined cleanup and infrastructure failures still propagate", async () => {
  const [frame] = await parseBytes(b(ipex.cases[0].wire));
  const parent = frame.body as SerderKERI;
  let read = false;
  let discarded = 0;
  let begin!: () => void;
  let release!: () => void;
  const cleaning = new Promise<void>((resolve) => {
    begin = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  frame.nests![0].essr = essrPayload(
    {
      size: 8,
      async *open() {
        read = true;
        yield b("4BABYWJj");
      },
      async discard() {
        discarded++;
        begin();
        await gate;
      },
    },
    1,
    3,
    Vrsn_2_0,
  );
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const reactor = new Reactor(hby, { messagePolicy: { denyList: new Set([parent.pre!]) } });
    let finished = false;
    try {
      const task = yield* spawn(function*() {
        yield* reactor.settle(frame, {}, function*(_envelope, decision) {
          assertEquals(decision, { kind: "drop", reason: "deniedSender" });
        });
        finished = true;
      });
      yield* call(() => cleaning);
      assertEquals(finished, false);
      assertEquals(read, false);
      assertEquals(hby.db.enst.get(parent.said!), []);
      release();
      yield* task;
      assertEquals(discarded, 1);
      const [signed] = yield* call(() =>
        parseBytes(b(fixture.cases.find((row) => row.name === "signed exchange")!.wire))
      );
      try {
        reactor.kevery.denyList.clear();
        yield* call(() =>
          assertRejects(
            () =>
              run(() =>
                dispatchEnvelope(envelopeFromFrame(signed), reactor.revery, reactor.kevery, {
                  *processEvent() {
                    throw new Error("storage unavailable");
                  },
                })
              ),
            Error,
            "storage unavailable",
          )
        );
      } finally {
        yield* call(() => discardFrame(signed));
      }
    } finally {
      release();
      yield* hby.close(true);
    }
  });
});
