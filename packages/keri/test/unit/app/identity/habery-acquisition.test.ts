import { action, run } from "effection";
import { assertEquals, assertExists, assertRejects } from "jsr:@std/assert";
import { createConfiger } from "../../../../src/app/identity/configing.ts";
import { openHabery } from "../../../../src/app/identity/habbing.ts";
import { createHabery } from "../../../../src/app/identity/lmdb-habery.ts";
import { openNoterForHabery } from "../../../../src/app/notifications/notifying.ts";
import { ValidationError } from "../../../../src/core/errors.ts";
import { Baser } from "../../../../src/db/basing.ts";
import { LmdbStoreOpener } from "../../../../src/db/core/lmdb-opener.ts";
import type { StoreOpener } from "../../../../src/db/core/store-owner.ts";
import { Keeper } from "../../../../src/db/keeping.ts";
import { createBaser, createKeeper } from "../../../../src/db/lmdb-stores.ts";

Deno.test("failed encrypted Habery acquisition closes actual Baser and Keeper before returning", async () => {
  const directory = Deno.makeTempDirSync({ prefix: "habery-acquisition-" });
  const options = {
    name: "encrypted",
    headDirPath: directory,
    temp: false,
    skipConfig: true,
    skipSignator: true,
    bran: "0123456789abcdefghijk",
  };
  const captured: Array<Baser | Keeper> = [];
  const baserReopen = Baser.prototype.reopen;
  const keeperReopen = Keeper.prototype.reopen;
  let aid = "";
  try {
    await run(function*() {
      const hby = yield* createHabery(options);
      try {
        aid = hby.makeHab("alice").pre;
      } finally {
        yield* hby.close();
      }
    });
    // Observe real acquisition; original reopen and wrong-password validation still execute.
    Baser.prototype.reopen = function*(args) {
      const opened = yield* baserReopen.call(this, args);
      captured.push(this);
      return opened;
    };
    Keeper.prototype.reopen = function*(args) {
      const opened = yield* keeperReopen.call(this, args);
      captured.push(this);
      return opened;
    };
    await assertRejects(() =>
      run(() => createHabery({ ...options, bran: "a-different-passcode-of-sufficient-length" }))
    );
    assertEquals(captured.length, 2);
    for (const store of captured) {
      if (store instanceof Baser) assertEquals(store.env, null, "failure must join actual LMDB close");
      assertEquals(store.opened, false);
    }
    Baser.prototype.reopen = baserReopen;
    Keeper.prototype.reopen = keeperReopen;
    const config = await run(() => createConfiger({ name: "provided", headDirPath: directory }));
    try {
      await assertRejects(() =>
        run(() => createHabery({ ...options, cf: config, bran: "a-different-passcode-of-sufficient-length" }))
      );
      assertEquals(config.pathManager.opened, true, "failed factory must preserve caller-owned config");
    } finally {
      await run(() => config.close());
    }
    await run(function*() {
      const hby = yield* createHabery(options);
      try {
        assertEquals(hby.habByName("alice")?.pre, aid);
        assertExists(hby.db.env);
      } finally {
        yield* hby.close();
      }
    });
  } finally {
    Baser.prototype.reopen = baserReopen;
    Keeper.prototype.reopen = keeperReopen;
    for (const store of captured.reverse()) if (store.opened) await run(() => store.close());
    Deno.removeSync(directory, { recursive: true });
  }
});

Deno.test("cancelled Habery keeper acquisition closes the keeper that has not returned to its caller", async () => {
  const directory = Deno.makeTempDirSync({ prefix: "habery-cancel-" });
  const original = Keeper.prototype.reopen;
  let captured: Keeper | undefined;
  let entered!: () => void;
  const acquired = new Promise<void>((resolve) => entered = resolve);
  Keeper.prototype.reopen = function*(args) {
    const opened = yield* original.call(this, args);
    captured = this;
    entered();
    yield* action<void>(() => () => {});
    return opened;
  };
  const task = run(() =>
    createHabery({ name: "cancelled", headDirPath: directory, skipConfig: true, skipSignator: true })
  );
  try {
    await acquired;
    assertEquals(captured!.opened, true);
    await task.halt();
    assertEquals(captured!.opened, false, "cancelled child factory must close its unreturned native handle");
  } finally {
    Keeper.prototype.reopen = original;
    await task.halt();
    if (captured?.opened) await run(() => captured!.close());
    Deno.removeSync(directory, { recursive: true });
  }
});

Deno.test("cancelled Habery Baser acquisition closes the Baser that has not returned to its caller", async () => {
  const directory = Deno.makeTempDirSync({ prefix: "habery-cancel-" });
  const original = Baser.prototype.reopen;
  let captured: Baser | undefined;
  let entered!: () => void;
  const acquired = new Promise<void>((resolve) => entered = resolve);
  Baser.prototype.reopen = function*(args) {
    const opened = yield* original.call(this, args);
    captured = this;
    entered();
    yield* action<void>(() => () => {});
    return opened;
  };
  const task = run(() =>
    createHabery({ name: "cancelled", headDirPath: directory, skipConfig: true, skipSignator: true })
  );
  try {
    await acquired;
    assertEquals(captured!.opened, true);
    await task.halt();
    assertEquals(captured!.opened, false, "cancelled child factory must close its unreturned native handle");
  } finally {
    Baser.prototype.reopen = original;
    await task.halt();
    if (captured?.opened) await run(() => captured!.close());
    Deno.removeSync(directory, { recursive: true });
  }
});

/** Open borrowed stores that outlive the Habery under test. */
function* borrowedStores(name: string) {
  const db = yield* createBaser({ name, temp: true });
  const ks = yield* createKeeper({ name, temp: true });
  return { db, ks };
}

Deno.test("Habery leaves borrowed stores open when it closes, even when clearing", async () => {
  await run(function*() {
    const stores = yield* borrowedStores(`borrowed-${crypto.randomUUID()}`);
    try {
      const hby = yield* createHabery({ name: "borrowed", temp: true, skipConfig: true, skipSignator: true, stores });
      yield* hby.close(true);
      assertEquals(stores.db.opened, true);
      assertEquals(stores.ks.opened, true);
    } finally {
      yield* stores.ks.close(true);
      yield* stores.db.close(true);
    }
  });
});

Deno.test("failed Habery acquisition leaves borrowed stores open for their owner", async () => {
  const directory = Deno.makeTempDirSync({ prefix: "habery-borrowed-" });
  try {
    await run(function*() {
      const encrypted = { name: "encrypted", headDirPath: directory, skipConfig: true, skipSignator: true };
      const seeded = yield* createHabery({ ...encrypted, bran: "0123456789abcdefghijk" });
      yield* seeded.close();
      const db = yield* createBaser({ name: "encrypted", headDirPath: directory });
      const ks = yield* createKeeper({ name: "encrypted", headDirPath: directory });
      try {
        let failed = false;
        try {
          yield* createHabery({ ...encrypted, bran: "bad0123456789abcdefgh", stores: { db, ks } });
        } catch {
          failed = true;
        }
        assertEquals(failed, true);
        assertEquals(db.opened, true);
        assertEquals(ks.opened, true);
      } finally {
        yield* ks.close();
        yield* db.close();
      }
    });
  } finally {
    Deno.removeSync(directory, { recursive: true });
  }
});

Deno.test("Habery creates stores and sidecars through its injected opener", async () => {
  const families: string[] = [];
  const lmdb = new LmdbStoreOpener();
  const opener: StoreOpener = {
    create(family, identity) {
      families.push(family.tail);
      return lmdb.create(family, identity);
    },
  };
  await run(function*() {
    const hby = yield* createHabery({
      name: `opener-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
      skipSignator: true,
      opener,
    });
    try {
      const noter = yield* openNoterForHabery(hby);
      yield* noter.close(true);
      assertEquals(families, ["db", "ks", "not"]);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("backend-neutral openHabery refuses to guess how to create a config file", async () => {
  await assertRejects(
    () => run(() => openHabery({ name: "unconfigured", opener: {} as StoreOpener })),
    ValidationError,
    "A Habery needs a Configer, a Configer factory or skipConfig.",
  );
});
