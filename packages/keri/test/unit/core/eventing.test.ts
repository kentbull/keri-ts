import { run } from "effection";
import { assertEquals, assertExists } from "jsr:@std/assert";
import { SerderKERI } from "../../../../cesr/mod.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { Kevery } from "../../../src/core/eventing.ts";

Deno.test("Kevery.processEvent returns accept for an in-order local ixn", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `kevery-accept-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const hab = hby.makeHab("alice", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const kever = hab.kever;
      assertExists(kever);

      const serder = new SerderKERI({
        sad: {
          t: "ixn",
          i: hab.pre,
          s: "1",
          p: kever.said,
          a: [],
        },
        makify: true,
      });

      const kvy = new Kevery(hby.db, { local: true });
      const decision = kvy.processEvent({
        serder,
        sigers: hab.sign(serder.raw, true),
        wigers: [],
        frcs: [],
        sscs: [],
        ssts: [],
        local: true,
      });

      assertEquals(decision.kind, "accept");
      assertEquals(hby.db.getKever(hab.pre)?.sn, 1);
      assertEquals(hby.db.getKever(hab.pre)?.said, serder.said);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Kevery.decideEvent returns duplicate for the same accepted inception SAID", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `kevery-dup-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const hab = hby.makeHab("alice", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const kever = hab.kever;
      assertExists(kever);
      const serder = hby.db.getEvtSerder(hab.pre, kever.said);
      assertExists(serder);

      const kvy = new Kevery(hby.db);
      const decision = kvy.decideEvent({
        serder,
        sigers: hby.db.sigs.get([hab.pre, kever.said]),
        wigers: [],
        frcs: [],
        sscs: [],
        ssts: [],
        local: false,
      });

      assertEquals(decision.kind, "duplicate");
      if (decision.kind !== "duplicate") {
        throw new Error("Expected duplicate decision.");
      }
      assertEquals(decision.duplicate, "sameSaid");
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Kevery.decideEvent returns ooo escrow for out-of-order ixn", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `kevery-ooo-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const hab = hby.makeHab("alice", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const kever = hab.kever;
      assertExists(kever);

      const serder = new SerderKERI({
        sad: {
          t: "ixn",
          i: hab.pre,
          s: "2",
          p: kever.said,
          a: [],
        },
        makify: true,
      });

      const kvy = new Kevery(hby.db);
      const decision = kvy.decideEvent({
        serder,
        sigers: hab.sign(serder.raw, true),
        wigers: [],
        frcs: [],
        sscs: [],
        ssts: [],
        local: false,
      });

      assertEquals(decision.kind, "escrow");
      if (decision.kind !== "escrow") {
        throw new Error("Expected escrow decision.");
      }
      assertEquals(decision.reason, "ooo");
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Kevery.processEvent rejects invalid local ixn without throwing normal control exceptions", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `kevery-reject-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const hab = hby.makeHab("alice", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const kever = hab.kever;
      assertExists(kever);

      const serder = new SerderKERI({
        sad: {
          t: "ixn",
          i: hab.pre,
          s: "1",
          p: kever.said,
          a: [],
        },
        makify: true,
      });

      const kvy = new Kevery(hby.db, { local: true });
      const decision = kvy.processEvent({
        serder,
        sigers: [],
        wigers: [],
        frcs: [],
        sscs: [],
        ssts: [],
        local: true,
      });

      assertEquals(decision.kind, "reject");
      if (decision.kind !== "reject") {
        throw new Error("Expected reject decision.");
      }
      assertEquals(decision.code, "invalidThreshold");
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Kevery applies weighted threshold satisfaction to local ixn signatures", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `kevery-weighted-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const nested = [{ "1": ["1/2", "1/2"] }];
      const hab = hby.makeHab("weighted", undefined, {
        transferable: true,
        icount: 2,
        isith: nested,
        ncount: 2,
        nsith: nested,
        toad: 0,
      });
      const kever = hab.kever;
      assertExists(kever);

      const serder = new SerderKERI({
        sad: {
          t: "ixn",
          i: hab.pre,
          s: "1",
          p: kever.said,
          a: [],
        },
        makify: true,
      });
      const sigers = hab.sign(serder.raw, true);
      const kvy = new Kevery(hby.db, { local: true });

      const partial = kvy.decideEvent({
        serder,
        sigers: [sigers[0]],
        wigers: [],
        frcs: [],
        sscs: [],
        ssts: [],
        local: true,
      });
      assertEquals(partial.kind, "escrow");
      if (partial.kind !== "escrow") {
        throw new Error("Expected weighted partial signature escrow.");
      }
      assertEquals(partial.reason, "partialSigs");

      const accepted = kvy.processEvent({
        serder,
        sigers,
        wigers: [],
        frcs: [],
        sscs: [],
        ssts: [],
        local: true,
      });
      assertEquals(accepted.kind, "accept");
      assertEquals(hby.db.getKever(hab.pre)?.sn, 1);
    } finally {
      yield* hby.close(true);
    }
  });
});
