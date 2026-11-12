import { b } from "cesr-ts";
import { assertEquals, assertInstanceOf, assertRejects } from "jsr:@std/assert";
import { run } from "npm:effection@^3.6.0";
import { IDBFactory, IDBKeyRange } from "npm:fake-indexeddb@6.2.5";
import {
  indexedDbOpener,
  IndexedDbPersistence,
  StoreLockHeldError,
  storeLockKey,
  type StoreLockManager,
  StoreLockUnsupportedError,
} from "../../../db-indexeddb.ts";
import type { WebDBer } from "../../../src/db/core/webdber.ts";

const keyRange = IDBKeyRange as unknown as typeof globalThis.IDBKeyRange;

/** A single-process lock manager honouring exclusive + ifAvailable; `log` records grants and releases. */
function fakeLocks(log: string[] = []): StoreLockManager & { held: Set<string> } {
  const held = new Set<string>();
  return {
    held,
    async request(name, _options, callback) {
      if (held.has(name)) return await callback(null);
      held.add(name);
      log.push("lock");
      try {
        return await callback({});
      } finally {
        held.delete(name);
        log.push("unlock");
      }
    },
  };
}

/** Create and open a store of one family through an opener. */
async function open(opener: ReturnType<typeof indexedDbOpener>, tail: string): Promise<WebDBer> {
  const store = opener.create({ tail }, { name: "wallet" });
  assertEquals(await run(() => store.reopen()), true);
  return store;
}

Deno.test("indexedDbOpener persists per family across a close and a fresh opener", async () => {
  const factory = new IDBFactory() as unknown as IDBFactory;
  const locks = fakeLocks();
  const first = indexedDbOpener({ factory, keyRange, locks });
  const db = await open(first, "db");
  const keeper = await open(first, "keeper");
  db.setVal(db.openTable("evts."), b("k"), b("db-value"));
  keeper.setVal(keeper.openTable("evts."), b("k"), b("keeper-value"));
  await run(() => db.flushed());
  await run(() => db.close());
  await run(() => keeper.close());

  assertEquals(locks.held.size, 0);
  const second = indexedDbOpener({ factory, keyRange, locks });
  const reopenedDb = await open(second, "db");
  const reopenedKeeper = await open(second, "keeper");
  assertEquals(reopenedDb.getVal(reopenedDb.openTable("evts."), b("k")), b("db-value"));
  assertEquals(reopenedKeeper.getVal(reopenedKeeper.openTable("evts."), b("k")), b("keeper-value"));
  await run(() => reopenedDb.close());
  await run(() => reopenedKeeper.close());
});

Deno.test("indexedDbOpener builds an IndexedDbPersistence per family and identity", () => {
  const opener = indexedDbOpener({ factory: new IDBFactory() as unknown as IDBFactory, keyRange });
  assertInstanceOf(opener.persistenceFor({ tail: "db" }, { name: "x" }), IndexedDbPersistence);
});

const identityKey = storeLockKey({ name: "wallet" });

/** An IDBFactory that records when a database is first opened, and can be made to fail doing so. */
function loggedFactory(log: string[], failOpen = false): IDBFactory {
  return new class extends IDBFactory {
    override open(name: string, version?: number) {
      log.push("load");
      if (failOpen) throw new Error("open failed");
      return super.open(name, version);
    }
  }() as unknown as IDBFactory;
}

Deno.test("the first reopen takes the lock before anything loads; families share it; the last close releases it", async () => {
  const log: string[] = [];
  const locks = fakeLocks(log);
  const opener = indexedDbOpener({ factory: loggedFactory(log), keyRange, locks });
  const db = await open(opener, "db");
  assertEquals(log.slice(0, 2), ["lock", "load"]);
  assertEquals([...locks.held], [identityKey]);
  const keeper = await open(opener, "keeper");
  assertEquals(log.filter((entry) => entry === "lock").length, 1, "the second family reuses the lock");

  await run(() => db.close());
  assertEquals(locks.held.size, 1, "one family is still open");
  await run(() => keeper.close());
  assertEquals(locks.held.size, 0);
  await run(() => keeper.close());
  assertEquals(log.filter((entry) => entry === "unlock").length, 1, "closing again releases nothing twice");
});

Deno.test("a failed first reopen releases the lock", async () => {
  const locks = fakeLocks();
  const opener = indexedDbOpener({ factory: loggedFactory([], true), keyRange, locks });
  const store = opener.create({ tail: "db" }, { name: "wallet" });
  await assertRejects(() => run(() => store.reopen()), Error, "open failed");
  assertEquals(locks.held.size, 0);
});

Deno.test("close then reopen in one page re-acquires, and a close that fails still releases", async () => {
  const locks = fakeLocks();
  const opener = indexedDbOpener({ factory: new IDBFactory() as unknown as IDBFactory, keyRange, locks });
  const store = await open(opener, "db");
  assertEquals(await run(() => store.reopen()), true, "reopening an open store keeps its lock");
  assertEquals(locks.held.size, 1);

  opener.queue.enqueue(() => Promise.reject(new Error("write lost")));
  await assertRejects(() => run(() => store.close()), Error, "write lost");
  assertEquals(locks.held.size, 0, "the lock is released although close failed");

  const next = indexedDbOpener({ factory: new IDBFactory() as unknown as IDBFactory, keyRange, locks });
  const reopened = await open(next, "db");
  await run(() => reopened.close());
});

Deno.test("a second opener on the same identity is refused until the first closes; temp is a distinct identity", async () => {
  const factory = new IDBFactory() as unknown as IDBFactory;
  const locks = fakeLocks();
  const first = await open(indexedDbOpener({ factory, keyRange, locks }), "db");
  const refused = indexedDbOpener({ factory, keyRange, locks }).create({ tail: "db" }, { name: "wallet" });
  const error = await assertRejects(() => run(() => refused.reopen()), StoreLockHeldError);
  assertEquals(error.key, identityKey);

  const temp = indexedDbOpener({ factory, keyRange, locks }).create({ tail: "db" }, { name: "wallet", temp: true });
  assertEquals(await run(() => temp.reopen()), true);
  assertEquals(locks.held.has(storeLockKey({ name: "wallet", temp: true })), true);
  await run(() => temp.close(true));

  await run(() => first.close());
  const after = await open(indexedDbOpener({ factory, keyRange, locks }), "db");
  await run(() => after.close());
});

Deno.test("unsafeSkipStoreLock opens the same identity twice and takes no lock", async () => {
  const factory = new IDBFactory() as unknown as IDBFactory;
  const locks = fakeLocks();
  const options = { factory, keyRange, locks, unsafeSkipStoreLock: true };
  const first = await open(indexedDbOpener(options), "db");
  const second = await open(indexedDbOpener(options), "db");
  assertEquals(locks.held.size, 0);
  await run(() => first.close());
  await run(() => second.close());
});

Deno.test("an engine without Web Locks refuses to open, and nothing runs unlocked", async () => {
  const opener = indexedDbOpener({ factory: new IDBFactory() as unknown as IDBFactory, keyRange, locks: null });
  const store = opener.create({ tail: "db" }, { name: "wallet" });
  await assertRejects(() => run(() => store.reopen()), StoreLockUnsupportedError);
  assertEquals(store.opened, false);
});
