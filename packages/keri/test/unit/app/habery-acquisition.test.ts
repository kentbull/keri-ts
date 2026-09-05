// @file-test-lane app-stateful-a
import { action, run } from "effection";
import { assertEquals, assertExists, assertRejects } from "jsr:@std/assert";
import { createConfiger } from "../../../src/app/configing.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { Baser } from "../../../src/db/basing.ts";
import { Keeper } from "../../../src/db/keeping.ts";
import { Outboxer } from "../../../src/db/outboxing.ts";

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

Deno.test("cancelled Habery Outboxer acquisition closes the Outboxer that has not returned to its caller", async () => {
  const directory = Deno.makeTempDirSync({ prefix: "habery-cancel-" });
  const original = Outboxer.prototype.reopen;
  let captured: Outboxer | undefined;
  let entered!: () => void;
  const acquired = new Promise<void>((resolve) => entered = resolve);
  Outboxer.prototype.reopen = function*(args) {
    const opened = yield* original.call(this, args);
    captured = this;
    entered();
    yield* action<void>(() => () => {});
    return opened;
  };
  const task = run(() =>
    createHabery({
      name: "cancelled",
      headDirPath: directory,
      skipConfig: true,
      skipSignator: true,
      outboxer: "create",
    })
  );
  try {
    await acquired;
    assertEquals(captured!.opened, true);
    await task.halt();
    assertEquals(captured!.opened, false, "cancelled child factory must close its unreturned native handle");
  } finally {
    Outboxer.prototype.reopen = original;
    await task.halt();
    if (captured?.opened) await run(() => captured!.close());
    Deno.removeSync(directory, { recursive: true });
  }
});
