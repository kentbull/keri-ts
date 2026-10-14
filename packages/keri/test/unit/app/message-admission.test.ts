/** Non-event policy gates precede real route acceptance and retain borrowed ownership. */
import { b, Diger, discardFrame, essrPayload, parseBytes, Prefixer, SerderKERI, Vrsn_1_0, Vrsn_2_0 } from "cesr-ts";
import { call, run, spawn } from "effection";
import { assertEquals, assertExists, assertRejects, assertThrows } from "jsr:@std/assert";
import { createAgentRuntime } from "../../../src/app/agent-runtime.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { dispatchEnvelope, envelopeFromFrame } from "../../../src/app/parsering.ts";
import { Reactor } from "../../../src/app/reactor.ts";
import { TransIdxSigGroup } from "../../../src/core/dispatch.ts";
import { Kevery, type QueryEnvelope } from "../../../src/core/eventing.ts";
import { type KramConfig, type KramReceipt, kramReceipt, kramReceiptTime } from "../../../src/core/kraming.ts";
import { query, reply } from "../../../src/core/protocol-eventing.ts";
import { exchange } from "../../../src/core/protocol-exchanging.ts";
import { messagize, serializeMessage } from "../../../src/core/protocol-serialization.ts";
import { Revery } from "../../../src/core/routing.ts";
import { makeNowIso8601 } from "../../../src/time/mod.ts";
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

Deno.test("optional KRAM uses the receiver clock and scopes consumers through ready acknowledgement", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const sender = hby.makeHab("sender", undefined, { icount: 3, isith: "2", ncount: 3, nsith: "2" });
    let now = Date.now();
    const runtime = yield* createAgentRuntime(hby, {
      kram: { enabled: true, caches: { "~": [1000, 5000, 60000, 300000, 5000, 60000, 300000] } },
      services: { clock: { now: () => now, setTimeout, clearTimeout: (timer) => clearTimeout(timer as number) } },
    });
    const body = query("ksn", { i: sender.pre, src: sender.pre }, { pre: sender.pre, pvrsn: Vrsn_2_0 });
    const sigers = sender.sign(body.raw, true), key = [sender.pre, body.said!];
    const frame = (index: number) => parseBytes(messagize(body, { sigers: [sigers[index]], gvrsn: Vrsn_2_0 }));
    try {
      const [partial] = yield* call(() => frame(0));
      yield* runtime.reactor.settle(partial, {}, function*(_envelope, decision) {
        assertEquals(decision?.kind, "pending");
      });
      assertEquals(hby.db.kready.get(key), null);
      now += 1000;
      const [complete] = yield* call(() => frame(1));
      const failure = new Error("transport consumer failed");
      const fail = function*(ready?: import("../../../src/core/dispatch.ts").KeriDispatchEnvelope) {
        assertEquals(ready!.sigers.map((sig) => sig.index), [0, 1]);
        assertExists(hby.db.pmkm.get(key), "consumer runs before acknowledgement");
        assertEquals(runtime.reactor.kevery.kramer!.prune().kind, "busy");
        throw failure;
      };
      yield* call(() =>
        assertRejects(() => run(() => runtime.reactor.settle(complete, {}, fail)), Error, failure.message)
      );
      const receipt = hby.db.kready.get(key)!;
      assertEquals(Date.parse(receipt), now, "services.clock owns first completion time");
      now += 1000;
      const [retry] = yield* call(() => frame(1));
      const returned = yield* runtime.reactor.settle(retry, {}, function*(ready) {
        assertEquals(hby.db.kready.get(key), receipt);
        assertEquals(ready!.sigers.map((sig) => sig.index), [0, 1]);
      });
      assertEquals(returned!.sigers.map((sig) => sig.index), [1], "returned input cannot expose hydrated pool/owners");
      assertEquals([hby.db.pmkm.get(key), hby.db.kready.get(key)], [null, null]);
      yield* runtime.reactor.settle((yield* call(() => frame(1)))[0], {}, function*(_ready, decision) {
        assertEquals(decision, { kind: "drop", reason: "replay" });
      });
      now += 120000;
      yield* runtime.reactor.processEscrowsOnce();
      assertEquals(hby.db.msgc.get(key), null, "ordinary escrow scheduling advances finite pruning");
    } finally {
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});

Deno.test("KRAM exchange receipt survives dependency escrow and cannot be forged or refreshed", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const sender = hby.makeHab("sender");
    let now = Date.now(), dependency = false;
    const runtime = yield* createAgentRuntime(hby, {
      kram: { enabled: true, caches: { "~": [1000, 5000, 60000, 300000, 5000, 60000, 300000] } },
      services: { clock: { now: () => now, setTimeout, clearTimeout: (timer) => clearTimeout(timer as number) } },
    });
    const seen: (string | undefined)[] = [], handled: (string | undefined)[] = [];
    runtime.reactor.exchanger.addHandler({
      resource: "/receipt",
      verify: ({ receiverTime }) => {
        seen.push(receiverTime);
        return dependency ? true : { kind: "escrow", reason: "Missing route dependency" };
      },
      handle: ({ receiverTime }) => {
        handled.push(receiverTime);
      },
    });
    const body = (label: string) =>
      exchange("/receipt", { label }, {
        sender: sender.pre,
        recipient: sender.pre,
        pvrsn: Vrsn_2_0,
        stamp: makeNowIso8601(new Date(now - 1000)),
      })[0];
    const group = (serder: SerderKERI) =>
      new TransIdxSigGroup(
        new Prefixer({ qb64: sender.pre }),
        sender.kever!.sner,
        new Diger({ qb64: sender.kever!.said }),
        sender.sign(serder.raw, true),
      );
    const pending = body("pending"), receipt = makeNowIso8601(new Date(now));
    let escaped: KramReceipt | undefined, borrowed: SerderKERI | undefined;
    try {
      const [frame] = yield* call(() =>
        parseBytes(serializeMessage(pending, { tsgs: [group(pending)], gvrsn: Vrsn_2_0 }))
      );
      yield* runtime.reactor.settle(frame, {}, function*(ready, decision) {
        assertEquals(decision?.kind, "escrow");
        escaped = kramReceipt(ready!);
        borrowed = ready!.serder;
        assertExists(escaped);
        assertEquals(kramReceiptTime(escaped, borrowed), receipt);
        assertThrows(() => kramReceiptTime(escaped!, pending), Error, "Invalid scoped KRAM receipt");
      });
      assertThrows(() => kramReceiptTime(escaped!, borrowed!), Error, "Invalid scoped KRAM receipt");
      assertEquals(seen, [receipt]);
      assertEquals(handled, []);
      assertEquals(hby.db.exchangeMeta.get([pending.said!])?.receiverTime, receipt);
      assertEquals(hby.db.kready.get([sender.pre, pending.said!]), null);
      now += 120000;
      yield* hby.db.reopen();
      dependency = true;
      yield* runtime.reactor.exchanger.processEscrows();
      assertEquals(seen, [receipt, receipt]);
      assertEquals(handled, [receipt]);
      assertExists(hby.db.exns.get([pending.said!]));
      assertEquals(hby.db.exchangeMeta.get([pending.said!])?.receiverTime, receipt);
      // A new direct attempt cannot replace first qualified provenance with sender dt.
      yield* runtime.reactor.exchanger.processEvent({ serder: pending, tsgs: [group(pending)] });
      assertEquals(handled, [receipt, receipt]);
      const fresh = body("forged");
      yield* call(() =>
        assertRejects(
          () =>
            run(() =>
              runtime.reactor.exchanger.processEvent({
                serder: fresh,
                tsgs: [group(fresh)],
                receipt: {} as KramReceipt,
              })
            ),
          Error,
          "Invalid scoped KRAM receipt",
        )
      );
      assertEquals(hby.db.exchangeMeta.get([fresh.said!]), null);
      const competing = body("competing"), winning = makeNowIso8601(new Date(now));
      runtime.reactor.exchanger.routes.set("/receipt", {
        resource: "/receipt",
        verify: () => {
          hby.db.exchangeMeta.pin([competing.said!], { mailboxAid: null, receiverTime: winning });
          return true;
        },
        handle: () => {
          throw new Error("must not consume stale admission");
        },
      });
      yield* call(() =>
        assertRejects(
          () =>
            run(() =>
              runtime.reactor.exchanger.processEvent({
                serder: competing,
                tsgs: [group(competing)],
              })
            ),
          Error,
          "Exchange receiver receipt changed during admission",
        )
      );
      assertEquals(hby.db.exchangeMeta.get([competing.said!])?.receiverTime, winning);
      assertEquals(hby.db.exns.get([competing.said!]), null);
      hby.db.exchangeMeta.pin([pending.said!], { mailboxAid: null, receiverTime: "corrupt" });
      yield* call(() =>
        assertRejects(
          () =>
            run(() =>
              runtime.reactor.exchanger.processEvent({
                serder: pending,
                tsgs: [group(pending)],
              })
            ),
          Error,
          "Corrupt exchange receiver receipt",
        )
      );
    } finally {
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});

Deno.test("disabled, exempt, default and v1 exchange intake cannot confer KRAM receipt authority", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const sender = hby.makeHab("sender");
    try {
      const cases: { kram?: KramConfig; pvrsn: typeof Vrsn_2_0 }[] = [
        { pvrsn: Vrsn_2_0 },
        { kram: { enabled: false }, pvrsn: Vrsn_2_0 },
        { kram: { enabled: true, denials: [[[2, 0], "exn", ""]] }, pvrsn: Vrsn_2_0 },
        { kram: { enabled: true }, pvrsn: Vrsn_1_0 },
      ];
      for (const { kram, pvrsn } of cases) {
        const runtime = yield* createAgentRuntime(hby, { kram });
        runtime.reactor.exchanger.addHandler({
          resource: "/unqualified",
          verify: ({ receiverTime }) => {
            assertEquals(receiverTime, undefined);
            return true;
          },
          handle: ({ receiverTime }) => {
            assertEquals(receiverTime, undefined);
          },
        });
        const message = exchange("/unqualified", { n: crypto.randomUUID() }, {
          sender: sender.pre,
          recipient: sender.pre,
          pvrsn,
        })[0];
        const tsg = new TransIdxSigGroup(
          new Prefixer({ qb64: sender.pre }),
          sender.kever!.sner,
          new Diger({ qb64: sender.kever!.said }),
          sender.sign(message.raw, true),
        );
        try {
          yield* runtime.reactor.processBytes(serializeMessage(message, { tsgs: [tsg], gvrsn: pvrsn }));
          assertExists(hby.db.exns.get([message.said!]));
          assertEquals(hby.db.exchangeMeta.get([message.said!])?.receiverTime, undefined);
        } finally {
          yield* runtime.close();
        }
      }
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("optional KRAM preserves actual OOBI verification and frozen processor stubs", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const sender = hby.makeHab("sender"), wrong = hby.makeHab("wrong");
    const runtime = yield* createAgentRuntime(hby, { kram: { enabled: true } });
    try {
      const endpoint = reply("/end/role/add", { cid: sender.pre, role: "controller", eid: sender.pre }, {
        pre: sender.pre,
        pvrsn: Vrsn_2_0,
      });
      const location = reply("/loc/scheme", { eid: sender.pre, scheme: "http", url: "http://example.test/" }, {
        pre: sender.pre,
        pvrsn: Vrsn_2_0,
      });
      const group = (body: SerderKERI, signer = sender) =>
        new TransIdxSigGroup(
          new Prefixer({ qb64: sender.pre }),
          sender.kever!.sner,
          new Diger({ qb64: sender.kever!.said }),
          signer.sign(body.raw, true),
        );
      yield* runtime.reactor.processBytes(
        serializeMessage(location, { tsgs: [group(location, wrong)], gvrsn: Vrsn_2_0 }),
      );
      assertEquals(hby.db.locs.get([sender.pre, "http"]), null, "exemption cannot authenticate signatures");
      for (const body of [endpoint, location]) {
        yield* runtime.reactor.processBytes(serializeMessage(body, { tsgs: [group(body)], gvrsn: Vrsn_2_0 }));
        assertEquals(hby.db.msgc.get([sender.pre, body.said!]), null);
      }
      assertEquals(hby.db.ends.get([sender.pre, "controller", sender.pre])?.allowed, true);
      assertEquals(hby.db.locs.get([sender.pre, "http"])?.url, "http://example.test/");
      const stubs = fixture.cases.filter((row) => row.name.endsWith("reference stub"));
      assertEquals(stubs.length, 3);
      for (const row of stubs) {
        const [frame] = yield* call(() => parseBytes(b(row.wire)));
        const disabled = new Reactor(hby, { kram: { enabled: false } });
        yield* disabled.settle(frame, {}, function*(_ready, decision) {
          assertEquals(decision, { kind: "drop", reason: "referenceStub" });
        });
      }
    } finally {
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});
