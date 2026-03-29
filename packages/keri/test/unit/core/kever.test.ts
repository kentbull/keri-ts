import { run } from "effection";
import { assertEquals, assertExists } from "jsr:@std/assert";
import { createHabery } from "../../../src/app/habbing.ts";
import { Kever } from "../../../src/core/kever.ts";
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
      const reloaded = new Kever({ state, db: hby.db });

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
