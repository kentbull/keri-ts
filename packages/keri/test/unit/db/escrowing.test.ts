// @file-test-lane db-fast

import { run } from "effection";
import { assertEquals, assertExists } from "jsr:@std/assert";
import { Cigar, Dater, Diger, Prefixer, Seqner, SerderKERI, Siger, Signer } from "../../../../cesr/mod.ts";
import { TransIdxSigGroup } from "../../../src/core/dispatch.ts";
import { createLMDBer } from "../../../src/db/core/lmdber.ts";
import { Broker } from "../../../src/db/escrowing.ts";
import { encodeDateTimeToDater, makeNowIso8601 } from "../../../src/time/mod.ts";
import { brokerTestApi, expectKind } from "../../private-access.ts";

const textEncoder = new TextEncoder();

class RecoverableEscrowError extends Error {}

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
  const siger = signer.sign(ser, { index: 0 }) as Siger;
  return new TransIdxSigGroup(prefixer, makeSeqner(0), diger, [siger]);
}

function makeCigar(ser: Uint8Array): Cigar {
  const signer = Signer.random({ transferable: false });
  return signer.sign(ser) as Cigar;
}

function makeFreshDater(): Dater {
  return new Dater({
    qb64: encodeDateTimeToDater(makeNowIso8601()),
  });
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
        true,
      );

      let called = 0;
      broker.processEscrowState(
        "txn",
        ({ route, tsgs, cigars }) => {
          called += 1;
          assertEquals(route, "/tsn/registry/Eaid");
          assertEquals(tsgs.length, 1);
          assertEquals(tsgs[0].pre, tsg.pre);
          assertEquals(cigars.length, 1);
          assertEquals(cigars[0].verfer?.qb64, cigar.verfer?.qb64);
        },
        RecoverableEscrowError,
      );

      assertEquals(called, 1);
      assertEquals(broker.escrowdb.get(["txn", "Eregistry", "Eaid"]).length, 0);
      assertExists(broker.serderdb.get([diger.qb64]));
    } finally {
      yield* lmdber.close(true);
    }
  });
});

Deno.test("db/escrowing - Broker keeps escrowed notices on recoverable retry errors", async () => {
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

      broker.processEscrowState(
        "txn",
        () => {
          throw new RecoverableEscrowError("retry later");
        },
        RecoverableEscrowError,
      );

      assertEquals(broker.escrowdb.get(["txn", "Eregistry", "Eaid"]).length, 1);
    } finally {
      yield* lmdber.close(true);
    }
  });
});

Deno.test("db/escrowing - Broker escrow helper exposes typed keep/drop/accept decisions", async () => {
  await run(function*() {
    const lmdber = yield* createLMDBer({
      name: `broker-decision-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const broker = new Broker(lmdber, "txn");
      const { diger } = createBrokerEscrowFixture(broker);

      const decision = brokerTestApi(broker).processEscrowedStateNotice({
        aid: "Eaid",
        diger,
        processReply: () => {
          throw new RecoverableEscrowError("retry later");
        },
        extype: RecoverableEscrowError,
      });

      const keep = expectKind(decision, "keep");
      assertEquals(keep.reason, "recoverableError");
      assertEquals(keep.message, "retry later");
      assertEquals(keep.context?.aid, "Eaid");
    } finally {
      yield* lmdber.close(true);
    }
  });
});

Deno.test("db/escrowing - Broker preserves processing error detail on drop decisions", async () => {
  await run(function*() {
    const lmdber = yield* createLMDBer({
      name: `broker-processing-detail-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const broker = new Broker(lmdber, "txn");
      const { diger } = createBrokerEscrowFixture(broker);

      const decision = brokerTestApi(broker).processEscrowedStateNotice({
        aid: "Eaid",
        diger,
        processReply: () => {
          throw new Error("boom");
        },
        extype: RecoverableEscrowError,
      });

      const drop = expectKind(decision, "drop");
      assertEquals(drop.reason, "processingError");
      assertEquals(drop.message, "boom");
      assertEquals(drop.context?.said, diger.qb64);
    } finally {
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
      broker.processEscrowState(
        "txn",
        () => {
          called += 1;
        },
        RecoverableEscrowError,
      );

      assertEquals(called, 0);
      assertEquals(broker.escrowdb.get(["txn", "Eregistry", "Eaid"]).length, 0);
      assertExists(broker.serderdb.get([diger.qb64]));
      assertExists(broker.daterdb.get([diger.qb64]));
    } finally {
      yield* lmdber.close(true);
    }
  });
});

Deno.test("db/escrowing - Broker removes escrow and associated state on outer corruption failures", async () => {
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

      broker.processEscrowState(
        "txn",
        () => {},
        RecoverableEscrowError,
      );

      assertEquals(broker.escrowdb.get(["txn", "Eregistry", "Eaid"]).length, 0);
      assertEquals(broker.serderdb.get([diger.qb64]), null);
      assertEquals(broker.daterdb.get([diger.qb64]), null);
      assertEquals([...broker.tigerdb.getTopItemIter([diger.qb64, ""])], []);
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
