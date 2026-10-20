import { run } from "effection";
import { assert, assertEquals, assertRejects, assertStrictEquals, assertThrows } from "jsr:@std/assert";
import { b, t } from "../../../../../cesr/mod.ts";
import { DatabaseNotOpenError } from "../../../../src/core/errors.ts";
import { LMDBer } from "../../../../src/db/core/lmdber.ts";

Deno.test("db/core lmdber lifecycle - reopen preserves data and close clears env state", async () => {
  await run(function*() {
    const lmdber = new LMDBer({
      name: `lifecycle-${crypto.randomUUID()}`,
      temp: true,
    });

    assertEquals(yield* lmdber.reopen({ temp: true }), true);
    assert(lmdber.opened);
    assertEquals(lmdber.getVer(), "1.0.0");
    assertEquals(lmdber.inWriteTransaction, false);
    lmdber.env!.transactionSync(() => assertEquals(lmdber.inWriteTransaction, true));
    assertEquals(lmdber.inWriteTransaction, false);

    const stories = lmdber.openDB("stories.", false);
    lmdber.setVal(stories, b("story.alpha"), b("first draft"));
    const firstPath = lmdber.path;

    assertEquals(yield* lmdber.close(), true);
    assertEquals(lmdber.env, null);
    assertEquals(lmdber.opened, false);
    assertThrows(() => lmdber.getVer(), DatabaseNotOpenError);
    assertThrows(() => lmdber.inWriteTransaction, DatabaseNotOpenError);

    assertEquals(yield* lmdber.reopen({ temp: true }), true);
    assert(lmdber.opened);
    assertEquals(lmdber.path, firstPath);
    const reopenedStories = lmdber.openDB("stories.", false);
    assertEquals(
      t(lmdber.getVal(reopenedStories, b("story.alpha"))!),
      "first draft",
    );

    yield* lmdber.close(true);
  });
});

Deno.test("db/core lmdber lifecycle - readonly reopen on a missing database returns false without a half-open env", async () => {
  const headDirPath = await Deno.makeTempDir({ prefix: "lmdber-readonly-" });

  try {
    await run(function*() {
      const lmdber = new LMDBer({
        headDirPath,
        base: "missing",
        name: `readonly-${crypto.randomUUID()}`,
        readonly: true,
      });

      assertEquals(yield* lmdber.reopen({ readonly: true }), false);
      assertEquals(lmdber.env, null);
      assertEquals(lmdber.opened, false);
      assert(lmdber.path !== null);

      yield* lmdber.close(true);
    });
  } finally {
    await Deno.remove(headDirPath, { recursive: true }).catch(() => undefined);
  }
});

Deno.test("db/core lmdber lifecycle - getVer and setVer handle overwrite, missing metadata, and empty markers", async () => {
  await run(function*() {
    const lmdber = new LMDBer({
      name: `version-${crypto.randomUUID()}`,
      temp: true,
    });

    assertEquals(yield* lmdber.reopen({ temp: true }), true);
    assertEquals(lmdber.getVer(), "1.0.0");

    lmdber.setVer("2.5.0");
    assertEquals(lmdber.getVer(), "2.5.0");

    lmdber.env!.removeSync(b("__version__"));
    assertEquals(lmdber.getVer(), null);

    lmdber.env!.putSync(b("__version__"), new Uint8Array());
    assertEquals(lmdber.getVer(), null);

    yield* lmdber.close(true);
  });
});

Deno.test("db/core lmdber lifecycle - openDB changes duplicate semantics for named databases", async () => {
  await run(function*() {
    const lmdber = new LMDBer({
      name: `named-db-${crypto.randomUUID()}`,
      temp: true,
    });

    assertEquals(yield* lmdber.reopen({ temp: true }), true);

    const plain = lmdber.openDB("plain.", false);
    const dups = lmdber.openDB("dups.", true);

    lmdber.setVal(plain, b("item"), b("draft"));
    lmdber.setVal(plain, b("item"), b("final"));
    assertEquals(lmdber.cnt(plain), 1);
    assertEquals(t(lmdber.getVal(plain, b("item"))!), "final");

    lmdber.setVal(dups, b("item"), b("draft"));
    lmdber.setVal(dups, b("item"), b("final"));
    assertEquals(lmdber.cnt(dups), 2);
    assertEquals(
      [...lmdber.getValsIter(dups, b("item"))].map((value) => t(value)),
      ["draft", "final"],
    );

    yield* lmdber.close(true);
  });
});

for (const existingOnly of [false, true]) {
  for (const throwsSynchronously of [false, true]) {
    Deno.test(`db/core lmdber lifecycle - ${existingOnly ? "existing-only" : "ordinary"} failed close (${throwsSynchronously ? "throw" : "reject"}) refuses reuse and deletion`, async () => {
      const headDirPath = await Deno.makeTempDir();
      const db = new LMDBer({ headDirPath, name: "uncertain" });
      await run(() => db.reopen());
      const path = db.path!;
      db.setVal(db.openDB("proof."), b("key"), b("retained"));
      if (existingOnly) {
        await run(() => db.close());
        await run(() => db.openExisting(path));
      }
      const native = db.env!;
      const originalClose = native.close.bind(native);
      const failure = new Error("injected native shutdown failure");
      let calls = 0;
      native.close = () => {
        calls++;
        if (throwsSynchronously) throw failure;
        return Promise.reject(failure);
      };
      try {
        assertStrictEquals(await assertRejects(() => run(() => db.close(!existingOnly))), failure);
        assertEquals(db.opened, false);
        assertEquals(db.env, null);
        assertThrows(() => db.openDB("unsafe."), DatabaseNotOpenError);
        assertStrictEquals(await assertRejects(() => run(() => db.reopen({ name: "replacement" }))), failure);
        assertStrictEquals(await assertRejects(() => run(() => db.close())), failure);
        await assertRejects(() => run(() => db.openExisting(path)));
        if (existingOnly) await assertRejects(() => run(() => db.close(true)), Error, "cannot clear");
        assertEquals(calls, 1);
        assertEquals(db.path, path);
        assert((await Deno.stat(`${path}/data.mdb`)).isFile);
        assertEquals([...Deno.readDirSync(`${headDirPath}/keri/db`)].map(entry => entry.name), ["uncertain"]);
      } finally {
        await originalClose(); // Fault injection did not close this real native owner.
        await Deno.remove(headDirPath, { recursive: true });
      }
    });
  }
}

Deno.test("db/core lmdber lifecycle - native completion callback is joined and known-closed repetition is harmless", async () => {
  const db = new LMDBer({ temp: true });
  await run(() => db.reopen());
  const native = db.env!;
  const originalClose = native.close.bind(native);
  let release!: () => Promise<void>;
  let calls = 0;
  const started = new Promise<void>(resolve => {
    native.close = ((done: () => void) => {
      calls++;
      release = async () => {
        await originalClose();
        done();
      };
      resolve();
      return Promise.resolve(); // 3.5.3's deferred-read branch can do this.
    }) as typeof native.close;
  });
  let completed = false;
  const closing = run(() => db.close()).then(() => {
    completed = true;
  });
  await started;
  await Promise.resolve();
  assertEquals(completed, false);
  assertEquals(db.env, null);
  await release();
  await closing;
  await run(() => db.close());
  assertEquals(calls, 1);
  assertEquals(db.opened, false);
  await run(() => db.close(true));
});

Deno.test("db/core lmdber lifecycle - cancelling close joins native completion before returning", async () => {
  const db = new LMDBer({ temp: true });
  await run(() => db.reopen());
  const native = db.env!;
  const originalClose = native.close.bind(native);
  let release!: () => Promise<void>;
  const started = new Promise<void>(resolve => {
    native.close = ((done: () => void) => {
      release = async () => {
        await originalClose();
        done();
      };
      resolve();
      return Promise.resolve();
    }) as typeof native.close;
  });
  const closing = run(() => db.close());
  await started;
  let halted = false;
  const halt = Promise.resolve(closing.halt()).then(() => {
    halted = true;
  });
  await Promise.resolve();
  assertEquals(halted, false);
  await release();
  await halt;
  assertEquals(db.opened, false);
  await run(() => db.close(true));
});

Deno.test("db/core lmdber lifecycle - cancellation preserves a late native close rejection", async () => {
  const db = new LMDBer({ temp: true });
  await run(() => db.reopen());
  const native = db.env!;
  const originalClose = native.close.bind(native);
  const failure = new Error("late native close failure");
  let reject!: (error: Error) => void;
  native.close = () =>
    new Promise<void>((_, failed) => {
      reject = failed;
    });
  const closing = run(() => db.close());
  const halted = Promise.resolve(closing.halt());
  // The injected rejection follows real native cleanup, so the test leaks no handle.
  await originalClose();
  reject(failure);
  assertStrictEquals(await assertRejects(() => halted), failure);
  assertStrictEquals(await assertRejects(() => Promise.resolve(closing)), failure);
  assertStrictEquals(await assertRejects(() => run(() => db.reopen())), failure);
  await Deno.remove(db.path!, { recursive: true });
});

Deno.test("db/core lmdber lifecycle - existing-only opening refuses missing storage, table creation and clearing", async () => {
  const headDirPath = await Deno.makeTempDir();
  try {
    const missing = new LMDBer();
    await assertRejects(
      () => run(() => missing.openExisting(`${headDirPath}/absent`)),
      Error,
      "Existing database not found",
    );
    assertEquals([...Deno.readDirSync(headDirPath)], []);
    const seed = new LMDBer({ headDirPath, name: "existing" });
    await run(() => seed.reopen());
    const path = seed.path!;
    seed.env!.removeSync(b("__version__"));
    seed.setVal(seed.openDB("original."), b("key"), b("value"));
    await run(() => seed.close());
    const before = await Deno.readFile(`${path}/data.mdb`);
    for (const readonly of [false, true]) {
      const db = new LMDBer({ readonly });
      await run(() => db.openExisting(path));
      try {
        assertEquals(db.getVer(), null);
        assertEquals(t(db.getVal(db.openDB("original."), b("key"))!), "value");
        assertThrows(() => db.openDB("new."), Error, "Database not found");
        await assertRejects(() => run(() => db.close(true)), Error, "cannot clear");
      } finally {
        await run(() => db.close());
      }
      assertEquals(await Deno.readFile(`${path}/data.mdb`), before);
    }
  } finally {
    await Deno.remove(headDirPath, { recursive: true });
  }
});
