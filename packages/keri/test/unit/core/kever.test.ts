import { run } from "effection";
import { assertEquals, assertExists } from "jsr:@std/assert";
import { b, DigDex, Diger, SerderKERI, Verfer } from "../../../../cesr/mod.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { Kever } from "../../../src/core/kever.ts";
import { KeyStateRecord } from "../../../src/core/records.ts";
import { createBaser } from "../../../src/db/basing.ts";

Deno.test("Kever reloads durable state and serializes back to the same key-state record", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `kever-roundtrip-${crypto.randomUUID()}`,
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

      const state = hby.db.getState(hab.pre);
      assertExists(state);
      const reloaded = Kever.fromState({ state, db: hby.db });

      assertEquals(reloaded.pre, hab.pre);
      assertEquals(reloaded.said, state.d);
      assertEquals(reloaded.sn, 0);
      assertEquals(reloaded.fn, 0);
      assertEquals(reloaded.state(), state);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Kever reloads weighted threshold state without flattening it", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `kever-weighted-roundtrip-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const nested = [{ "1": ["1/2", "1/2"] }];
      const hab = hby.makeHab("weighted", undefined, {
        transferable: true,
        icount: 2,
        isith: ["1/2", "1/2"],
        ncount: 2,
        nsith: nested,
        toad: 0,
      });

      const state = hby.db.getState(hab.pre);
      assertExists(state);
      const reloaded = Kever.fromState({ state, db: hby.db });

      assertEquals(reloaded.tholder?.sith, ["1/2", "1/2"]);
      assertEquals(reloaded.ntholder?.sith, nested);
      assertEquals(reloaded.state(), state);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Kever constructor path preserves delegated inception state", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `kever-dip-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const delegator = hby.makeHab("delegator", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const delegate = hby.makeHab("delegate", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
        delpre: delegator.pre,
      });

      const kever = delegate.kever;
      const state = hby.db.getState(delegate.pre);
      assertExists(kever);
      assertExists(state);
      assertEquals(kever.delegated, true);
      assertEquals(kever.delpre, delegator.pre);
      assertEquals(state.di, delegator.pre);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Kever evaluateInception normalizes deprecated intive bt inputs before persisting state", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `kever-intive-bt-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const witness = hby.makeHab("witness", undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        ncount: 0,
        nsith: "0",
        toad: 0,
      });
      const [verfers, digers] = hby.mgr.incept({
        icount: 1,
        ncount: 1,
        transferable: true,
      });
      const serder = new SerderKERI({
        sad: {
          t: "icp",
          i: "",
          kt: "1",
          k: [verfers[0].qb64],
          nt: "1",
          n: [digers[0].qb64],
          bt: 1,
          b: [witness.pre],
          c: [],
          a: [],
        },
        saids: {
          d: DigDex.Blake3_256,
          i: DigDex.Blake3_256,
        },
        makify: true,
      });

      const decision = Kever.evaluateInception({
        db: hby.db,
        serder,
        sigers: hby.mgr.sign(serder.raw, [verfers[0].qb64], true),
        wigers: [],
        frcs: [],
        sscs: [],
        ssts: [],
        local: true,
      });

      assertEquals(decision.kind, "accept");
      if (decision.kind !== "accept") {
        throw new Error("Expected accept decision.");
      }
      assertEquals(decision.transition.state.bt, "1");
      assertEquals(decision.transition.log.wits, [witness.pre]);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Kever reload preserves large bt hex values without bigint-to-number drift", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `kever-large-bt-${crypto.randomUUID()}`,
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
      const state = hby.db.getState(hab.pre);
      assertExists(state);

      const hugeState = KeyStateRecord.fromDict({
        ...state.asDict(),
        bt: "20000000000001",
      });
      const reloaded = Kever.fromState({ state: hugeState, db: hby.db });

      assertEquals(reloaded.toader.numh, hugeState.bt);
      assertEquals(reloaded.state(), hugeState);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Baser reopen reloads accepted local kevers and prefixes", async () => {
  const name = `baser-kevers-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-baser-${crypto.randomUUID()}`;
  let pre = "";

  await run(function*() {
    const hby = yield* createHabery({
      name,
      headDirPath,
    });
    try {
      pre = hby.makeHab("alice", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      }).pre;
      assertEquals(hby.db.getKever(pre)?.pre, pre);
      assertEquals(hby.db.prefixes.has(pre), true);
    } finally {
      yield* hby.close();
    }
  });

  await run(function*() {
    const baser = yield* createBaser({
      name,
      headDirPath,
      reopen: true,
    });
    try {
      assertEquals(baser.getKever(pre)?.pre, pre);
      assertEquals(baser.prefixes.has(pre), true);
    } finally {
      yield* baser.close(true);
    }
  });
});

Deno.test("Baser reopen removes orphaned non-group hab records like KERIpy reload", async () => {
  const name = `baser-orphan-hab-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-baser-${crypto.randomUUID()}`;
  let pre = "";

  await run(function*() {
    const hby = yield* createHabery({
      name,
      headDirPath,
      skipSignator: true,
    });
    try {
      pre = hby.makeHab("alice", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      }).pre;
      assertEquals(hby.db.getHab(pre)?.hid, pre);
      hby.db.states.rem(pre);
      assertEquals(hby.db.getState(pre), null);
    } finally {
      yield* hby.close();
    }
  });

  await run(function*() {
    const baser = yield* createBaser({
      name,
      headDirPath,
      reopen: true,
    });
    try {
      assertEquals(baser.getHab(pre), null);
      assertEquals(baser.getKever(pre), null);
      assertEquals(baser.prefixes.has(pre), false);
    } finally {
      yield* baser.close(true);
    }
  });
});

Deno.test("Kever.verifyIndexedSignatures preserves verifier context for ECDSA prior-next exposures", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `kever-ecdsa-exposed-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const hab = hby.makeHab("alice", undefined, {
        transferable: true,
        icode: "J",
        icount: 1,
        isith: "1",
        ncode: "J",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const kever = hab.kever;
      assertExists(kever);

      const nextDiger = kever.ndigers[0];
      assertExists(nextDiger);
      const nextPub = [...hby.ks.pris.getTopItemIter()]
        .map(([keys]) => keys[0])
        .find((pub): pub is string =>
          !!pub && pub !== kever.verfers[0].qb64
          && Diger.compare(b(pub), nextDiger.code, nextDiger.raw)
        );
      assertExists(nextPub);

      const ser = new TextEncoder().encode("prior-next-exposure");
      const sigers = hby.mgr.sign(ser, [nextPub], true);
      const verified = Kever.verifyIndexedSignatures(
        ser,
        sigers,
        [new Verfer({ qb64: nextPub })],
      );

      assertEquals(verified.sigers.length, 1);
      assertEquals(verified.sigers[0].verfer?.qb64, nextPub);
      assertEquals(kever.exposeds(verified.sigers), [0]);
    } finally {
      yield* hby.close(true);
    }
  });
});
