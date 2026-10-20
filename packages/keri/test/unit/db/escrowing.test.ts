import { run } from "effection";
import { assert, assertEquals, assertExists, assertThrows } from "jsr:@std/assert";
import {
  Cigar,
  Dater,
  Diger,
  NumberPrimitive,
  Prefixer,
  Seqner,
  SerderKERI,
  Siger,
  Signer,
  Vrsn_1_0,
  Vrsn_2_0,
} from "../../../../cesr/mod.ts";
import { TransIdxSigGroup } from "../../../src/core/dispatch.ts";
import { acceptEscrow, dropEscrow, keepEscrow } from "../../../src/core/kever-decisions.ts";
import { consoleLogger } from "../../../src/core/logger.ts";
import { reply } from "../../../src/core/protocol-eventing.ts";
import { createLMDBer } from "../../../src/db/core/lmdber.ts";
import { Broker } from "../../../src/db/escrowing.ts";
import { encodeDateTimeToDater, makeNowIso8601 } from "../../../src/time/mod.ts";

const textEncoder = new TextEncoder();

function makeDiger(label: string): Diger {
  return new Diger({
    code: "E",
    raw: Diger.digest(textEncoder.encode(label), "E"),
  });
}

function makeSeqner(num: number): Seqner {
  const raw = new Uint8Array(16);
  let value = BigInt(num);
  for (let i = raw.length - 1; i >= 0; i--) {
    raw[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return new Seqner({ code: "0A", raw });
}

function makeReplySerder(route: string, prefix: string): SerderKERI {
  return new SerderKERI({
    sad: {
      t: "rpy",
      dt: makeNowIso8601(),
      r: route,
      a: {
        i: prefix,
      },
    },
    makify: true,
  });
}

function makeTsg(ser: Uint8Array) {
  const signer = Signer.random({ transferable: true });
  const prefixer = new Prefixer({ code: "D", raw: signer.verfer.raw });
  const diger = makeDiger("establishment");
  const siger = signer.sign(ser, { index: 0 });
  assert(siger instanceof Siger);
  return new TransIdxSigGroup(prefixer, makeSeqner(0), diger, [siger]);
}

function makeCigar(ser: Uint8Array): Cigar {
  const signer = Signer.random({ transferable: false });
  const cigar = signer.sign(ser);
  assert(cigar instanceof Cigar);
  return cigar;
}

function makeFreshDater(): Dater {
  return new Dater({
    qb64: encodeDateTimeToDater(makeNowIso8601()),
  });
}

/** Check the fixture's decoded prefix rather than erasing it with a record assertion. */
function noticePrefix(serder: SerderKERI): string {
  const state = serder.sad?.a;
  assert(state && typeof state === "object" && "i" in state && typeof state.i === "string");
  return state.i;
}

function createBrokerEscrowFixture(broker: Broker) {
  const serder = makeReplySerder("/tsn/registry/Eaid", "Eregistry");
  const diger = new Diger({ qb64: serder.said ?? "" });
  broker.escrowStateNotice({
    typ: "txn",
    pre: "Eregistry",
    aid: "Eaid",
    serder,
    diger,
    dater: makeFreshDater(),
    tsgs: [makeTsg(serder.raw)],
  });
  return { diger };
}

Deno.test("db/escrowing - Broker escrows and successfully unescrows state notices", async () => {
  await run(function*() {
    const lmdber = yield* createLMDBer({
      name: `broker-success-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const broker = new Broker(lmdber, "txn");
      const serder = makeReplySerder("/tsn/registry/Eaid", "Eregistry");
      const diger = new Diger({ qb64: serder.said ?? "" });
      const dater = makeFreshDater();
      const tsg = makeTsg(serder.raw);
      const cigar = makeCigar(serder.raw);

      assertEquals(
        broker.escrowStateNotice({
          typ: "txn",
          pre: "Eregistry",
          aid: "Eaid",
          serder,
          diger,
          dater,
          cigars: [cigar],
          tsgs: [tsg],
        }),
        { added: true, changed: true },
      );

      let called = 0;
      broker.retryStateNotices(
        "txn",
        ({ route, tsgs, cigars }) => {
          called += 1;
          assertEquals(route, "/tsn/registry/Eaid");
          assertEquals(tsgs.length, 1);
          assertEquals(tsgs[0].pre, tsg.pre);
          assertEquals(cigars.length, 1);
          assertEquals(cigars[0].verfer?.qb64, cigar.verfer?.qb64);
          return { decision: acceptEscrow(), changed: false };
        },
      );

      assertEquals(called, 1);
      assertEquals(broker.escrowdb.get(["txn", "Eregistry", "Eaid"]).length, 0);
      assertExists(broker.serderdb.get([diger.qb64]));
    } finally {
      yield* lmdber.close(true);
    }
  });
});

Deno.test("db/escrowing - Broker keeps escrowed notices on typed retry decisions", async () => {
  await run(function*() {
    const lmdber = yield* createLMDBer({
      name: `broker-retry-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const broker = new Broker(lmdber, "txn");
      const serder = makeReplySerder("/tsn/registry/Eaid", "Eregistry");
      const diger = new Diger({ qb64: serder.said ?? "" });
      const dater = makeFreshDater();

      broker.escrowStateNotice({
        typ: "txn",
        pre: "Eregistry",
        aid: "Eaid",
        serder,
        diger,
        dater,
        tsgs: [makeTsg(serder.raw)],
      });

      const cigar = makeCigar(serder.raw);
      const retry = () =>
        broker.retryStateNotices("txn", (args) => {
          const retained = broker.escrowStateNotice({
            typ: "txn",
            pre: "Eregistry",
            aid: "Eaid",
            serder,
            diger,
            dater,
            tsgs: args.tsgs,
            cigars: [cigar],
          });
          assertEquals(retained.added, false, "Additional proof does not create a second membership");
          return { decision: keepEscrow("recoverableError", "retry later"), changed: retained.changed };
        });
      assertEquals(retry(), { processed: 1, done: true, changed: true }, "New retained proof is semantic progress");
      assertEquals(retry(), { processed: 1, done: true, changed: false }, "Identical proof is stable");

      assertEquals(broker.escrowdb.get(["txn", "Eregistry", "Eaid"]).length, 1);
    } finally {
      yield* lmdber.close(true);
    }
  });
});

Deno.test("Broker combines equivalent ordinal proofs independently of primitive encoding and body version", async () => {
  await run(function*() {
    const db = yield* createLMDBer({ name: crypto.randomUUID(), temp: true });
    try {
      const broker = new Broker(db, "ordinal");
      for (const pvrsn of [Vrsn_1_0, Vrsn_2_0]) {
        const serder = reply("/tsn/registry/Eaid", { i: "Eregistry" }, { pvrsn });
        const diger = new Diger({ qb64: serder.said! });
        const dater = makeFreshDater(), proof = makeTsg(serder.raw);
        const other = Signer.random({ transferable: true }).sign(serder.raw, { index: 1 });
        assert(other instanceof Siger);
        const fixed = new TransIdxSigGroup(proof.prefixer, makeSeqner(17), proof.diger, proof.sigers);
        const compact = new TransIdxSigGroup(proof.prefixer, NumberPrimitive.fromNum(17n), proof.diger, [other]);
        const store = (tsgs: TransIdxSigGroup[]) =>
          broker.escrowStateNotice({ typ: "registry-mae", pre: "Eregistry", aid: "Eaid", serder, diger, dater, tsgs });
        assertEquals(store([fixed]), { added: true, changed: true });
        assertEquals(store([compact]), { added: false, changed: true });
        // Parsing may hydrate the same explicit 0A bytes as Number in either attachment genus.
        const explicit = new TransIdxSigGroup(
          proof.prefixer,
          new NumberPrimitive(fixed.seqner),
          proof.diger,
          proof.sigers,
        );
        assertEquals(store([explicit]), { added: false, changed: false });
        assertEquals(
          broker.tigerdb.get([diger.qb64, proof.pre, "00000000000000000000000000000011", proof.said]).length,
          2,
        );
        assertEquals(
          broker.retryStateNotices("registry-mae", ({ tsgs }) => {
            assertEquals(tsgs.length, 1, "Equivalent ordinals form one threshold-proof group");
            assertEquals(tsgs[0].sn, 17n);
            assertEquals(tsgs[0].sigers.map((siger) => siger.index), [0, 1]);
            const retained = store(tsgs);
            assertEquals(retained, { added: false, changed: false });
            return { decision: keepEscrow("recoverableError"), changed: retained.changed };
          }),
          { processed: 1, done: true, changed: false },
        );
        broker.escrowdb.rem(["registry-mae", "Eregistry", "Eaid"], diger);
      }
    } finally {
      yield* db.close(true);
    }
  });
});

Deno.test("db/escrowing - Broker propagates processing failures and drops only on typed decisions", async () => {
  await run(function*() {
    const lmdber = yield* createLMDBer({ name: crypto.randomUUID(), temp: true });
    const warnings: Parameters<typeof consoleLogger.warn>[] = [];
    const warn = consoleLogger.warn;
    consoleLogger.warn = (...args) => warnings.push(args);
    try {
      const broker = new Broker(lmdber, "txn");
      const { diger } = createBrokerEscrowFixture(broker);
      const failure = new Error("storage unavailable");
      assertEquals(
        assertThrows(() =>
          broker.retryStateNotices("txn", () => {
            throw failure;
          })
        ),
        failure,
      );
      assertEquals(broker.escrowdb.get(["txn", "Eregistry", "Eaid"]).length, 1);
      assertExists(broker.serderdb.get([diger.qb64]));
      assertEquals(warnings, []);
      const rem = broker.escrowdb.rem;
      try {
        broker.escrowdb.rem = () => {
          throw failure;
        };
        assertEquals(
          assertThrows(() =>
            broker.retryStateNotices("txn", () => ({ decision: dropEscrow("processingError"), changed: false }))
          ),
          failure,
        );
        assertEquals(warnings, [], "A failed index removal must not claim an ejection");
      } finally {
        broker.escrowdb.rem = rem;
      }
      assertEquals(
        broker.retryStateNotices(
          "txn",
          () => ({ decision: dropEscrow("processingError", "Untrusted state attester."), changed: false }),
        ),
        { processed: 1, done: true, changed: true },
      );
      assertEquals(broker.escrowdb.get(["txn", "Eregistry", "Eaid"]).length, 0);
      assertExists(broker.serderdb.get([diger.qb64]));
      assertEquals(warnings.length, 1);
      assertEquals(warnings[0][1], {
        family: "txn",
        said: diger.qb64,
        pre: "Eregistry",
        aid: "Eaid",
        route: "/tsn/registry/Eaid",
        reason: "processingError",
        detail: "Untrusted state attester.",
      });
    } finally {
      consoleLogger.warn = warn;
      yield* lmdber.close(true);
    }
  });
});

Deno.test("db/escrowing - Broker removes stale escrow entries without purging stored artifacts", async () => {
  await run(function*() {
    const lmdber = yield* createLMDBer({
      name: `broker-stale-${crypto.randomUUID()}`,
      temp: true,
    });
    const warnings: Parameters<typeof consoleLogger.warn>[] = [];
    const warn = consoleLogger.warn;
    consoleLogger.warn = (...args) => warnings.push(args);
    try {
      const broker = new Broker(lmdber, "txn", { timeout: 1 });
      const serder = makeReplySerder("/tsn/registry/Eaid", "Eregistry");
      const diger = new Diger({ qb64: serder.said ?? "" });
      const dater = new Dater({
        qb64: encodeDateTimeToDater("2000-01-01T00:00:00.000000+00:00"),
      });

      broker.escrowStateNotice({
        typ: "txn",
        pre: "Eregistry",
        aid: "Eaid",
        serder,
        diger,
        dater,
        tsgs: [makeTsg(serder.raw)],
      });

      let called = 0;
      broker.retryStateNotices(
        "txn",
        () => {
          called += 1;
          return { decision: acceptEscrow(), changed: false };
        },
      );

      assertEquals(called, 0);
      assertEquals(broker.escrowdb.get(["txn", "Eregistry", "Eaid"]).length, 0);
      assertExists(broker.serderdb.get([diger.qb64]));
      assertExists(broker.daterdb.get([diger.qb64]));
      assertEquals(warnings.length, 1);
      assertEquals(warnings[0][1], {
        family: "txn",
        said: diger.qb64,
        pre: "Eregistry",
        aid: "Eaid",
        route: "/tsn/registry/Eaid",
        reason: "stale",
        detail: undefined,
      });
    } finally {
      consoleLogger.warn = warn;
      yield* lmdber.close(true);
    }
  });
});

Deno.test("db/escrowing - Broker preserves malformed signer evidence instead of purging it", async () => {
  await run(function*() {
    const lmdber = yield* createLMDBer({
      name: `broker-corrupt-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const broker = new Broker(lmdber, "txn");
      const serder = makeReplySerder("/tsn/registry/Eaid", "Eregistry");
      const diger = new Diger({ qb64: serder.said ?? "" });
      const dater = makeFreshDater();
      const tsg = makeTsg(serder.raw);

      broker.daterdb.put([diger.qb64], dater);
      broker.serderdb.put([diger.qb64], serder);
      broker.tigerdb.put(
        [diger.qb64, tsg.pre, "nothex", tsg.said],
        [tsg.sigers[0]],
      );
      broker.escrowdb.put(["txn", "Eregistry", "Eaid"], [diger]);

      let called = false;
      assertThrows(
        () =>
          broker.retryStateNotices("txn", () => {
            called = true;
            return { decision: acceptEscrow(), changed: false };
          }),
        Error,
        "Invalid hex ordinal",
      );
      assertEquals(called, false);
      assertEquals(broker.escrowdb.get(["txn", "Eregistry", "Eaid"]).length, 1);
      assertEquals(broker.serderdb.get([diger.qb64])?.said, serder.said);
      assertEquals(broker.daterdb.get([diger.qb64])?.qb64, dater.qb64);
      assertEquals([...broker.tigerdb.getTopItemIter([diger.qb64, ""])].map(([keys, siger]) => [keys, siger.qb64]), [
        [[diger.qb64, tsg.pre, "nothex", tsg.said], tsg.sigers[0].qb64],
      ]);
    } finally {
      yield* lmdber.close(true);
    }
  });
});

Deno.test("db/escrowing - Broker updateReply pins current-state pointers by (prefix, aid)", async () => {
  await run(function*() {
    const lmdber = yield* createLMDBer({
      name: `broker-update-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const broker = new Broker(lmdber, "txn");
      const serder = makeReplySerder("/tsn/registry/Eaid", "Eregistry");
      const diger = new Diger({ qb64: serder.said ?? "" });
      const dater = makeFreshDater();

      broker.updateReply("Eaid", serder, diger, dater);

      assertEquals(broker.current(["Eregistry", "Eaid"])?.qb64, diger.qb64);
      assertExists(broker.serderdb.get([diger.qb64]));
      assertExists(broker.daterdb.get([diger.qb64]));
    } finally {
      yield* lmdber.close(true);
    }
  });
});

Deno.test("Broker typed finite retry advances kept rows and preserves failures", async () => {
  await run(function*() {
    const db = yield* createLMDBer({ name: crypto.randomUUID(), temp: true });
    try {
      const broker = new Broker(db, "typed", { timeout: 1 });
      const stamp = "2026-10-13T00:00:00.000001+00:00";
      const add = (pre: string) => {
        const serder = makeReplySerder("/tsn/registry/Eaid", pre);
        const diger = new Diger({ qb64: serder.said! });
        broker.escrowStateNotice({
          typ: "registry-mae",
          pre,
          aid: "Eaid",
          serder,
          diger,
          dater: new Dater({ qb64: encodeDateTimeToDater(stamp) }),
          cigars: [makeCigar(serder.raw)],
        });
        return diger;
      };
      const first = add("E01"), second = add("E02"), last = add("E03");
      const visited: string[] = [];
      const retry = () =>
        broker.retryStateNotices("registry-mae", ({ serder, cigars }) => {
          assertEquals(cigars.length, 1);
          visited.push(noticePrefix(serder));
          let changed = false;
          if (visited.length === 1) {
            add("E00");
            add("E99");
            changed = true;
          }
          return { decision: keepEscrow("recoverableError"), changed };
        }, { maxRows: 2, now: stamp });
      assertEquals(retry(), { processed: 2, done: false, changed: true });
      assertEquals(retry(), { processed: 1, done: true, changed: false });
      assertEquals(visited, ["E01", "E02", "E03"], "Insertions cannot extend the captured horizon");
      const failure = new Error("storage unavailable");
      assertThrows(
        () =>
          broker.retryStateNotices("registry-mae", () => {
            throw failure;
          }, { now: stamp }),
        Error,
        "storage unavailable",
      );
      assertEquals(broker.escrowdb.cnt(), 5, "Infrastructure failure removes nothing");
      const next: string[] = [];
      assertEquals(
        broker.retryStateNotices("registry-mae", ({ serder }) => {
          next.push(noticePrefix(serder));
          return { decision: next.length === 1 ? acceptEscrow() : dropEscrow("processingError"), changed: false };
        }, { now: stamp }),
        { processed: 5, done: true, changed: true },
      );
      assertEquals(next, ["E00", "E01", "E02", "E03", "E99"], "Next pass includes insertions behind checkpoint");
      assertEquals(broker.escrowdb.cnt(), 0);
      for (const diger of [first, second, last]) assertExists(broker.serderdb.get([diger.qb64]));
      add("E04");
      let calls = 0;
      const expiry = (now: string) =>
        broker.retryStateNotices("registry-mae", () => {
          calls++;
          return { decision: keepEscrow("recoverableError"), changed: false };
        }, { now });
      assertEquals(expiry("2026-10-13T00:00:01.000001+00:00").processed, 1);
      assertEquals(expiry("2026-10-13T00:00:01.000002+00:00").processed, 1);
      assertEquals(calls, 1, "Inclusive TTL preserves the exact boundary and expires one microsecond later");
      assertEquals(broker.escrowdb.cnt(), 0);
      const corrupt = add("E05");
      broker.daterdb.rem([corrupt.qb64]);
      assertThrows(() => expiry(stamp), Error, "Corrupt Broker retry artifacts");
      assertEquals(broker.escrowdb.cnt(), 1, "Corruption is not converted into terminal remote refusal");
    } finally {
      yield* db.close(true);
    }
  });
});

Deno.test("Broker restarts its family horizon after an interrupted sweep", async () => {
  await run(function*() {
    const db = yield* createLMDBer({ name: crypto.randomUUID(), temp: true });
    try {
      const broker = new Broker(db, "restart");
      for (const pre of ["EA", "EB", "EC"]) {
        const serder = makeReplySerder("/tsn/registry/Eaid", pre);
        broker.escrowStateNotice({
          typ: "registry-mae",
          pre,
          aid: "Eaid",
          serder,
          diger: new Diger({ qb64: serder.said! }),
          dater: makeFreshDater(),
          cigars: [makeCigar(serder.raw)],
        });
      }
      let dependencyAccepted = false;
      assertEquals(
        broker.retryStateNotices("registry-mae", ({ serder }) => {
          if (noticePrefix(serder) === "EA") return { decision: keepEscrow("recoverableError"), changed: false };
          dependencyAccepted = true;
          return { decision: acceptEscrow(), changed: true };
        }, { maxRows: 2 }),
        { processed: 2, done: false, changed: true },
      );
      const failure = new Error("Interrupted second page");
      assertEquals(
        assertThrows(() =>
          broker.retryStateNotices("registry-mae", () => {
            throw failure;
          })
        ),
        failure,
      );
      const visited: string[] = [];
      assertEquals(
        broker.retryStateNotices("registry-mae", ({ serder }) => {
          visited.push(noticePrefix(serder));
          return {
            decision: dependencyAccepted ? acceptEscrow() : keepEscrow("recoverableError"),
            changed: false,
          };
        }),
        { processed: 2, done: true, changed: true },
      );
      assertEquals(visited, ["EA", "EC"], "Restart revisits earlier rows unblocked before the failure");
    } finally {
      yield* db.close(true);
    }
  });
});
