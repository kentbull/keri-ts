import { b } from "cesr-ts";
import { assertEquals, assertInstanceOf } from "jsr:@std/assert";
import { run } from "npm:effection@^3.6.0";
import { IDBFactory, IDBKeyRange } from "npm:fake-indexeddb@6.2.5";
import { indexedDbOpener, IndexedDbPersistence } from "../../../db-indexeddb.ts";
import type { WebDBer } from "../../../src/db/core/webdber.ts";

const keyRange = IDBKeyRange as unknown as typeof globalThis.IDBKeyRange;

/** Create and open a store of one family through an opener. */
async function open(opener: ReturnType<typeof indexedDbOpener>, tail: string): Promise<WebDBer> {
  const store = opener.create({ tail }, { name: "wallet" });
  assertEquals(await run(() => store.reopen()), true);
  return store;
}

Deno.test("indexedDbOpener persists per family across a close and a fresh opener", async () => {
  const factory = new IDBFactory() as unknown as IDBFactory;
  const first = indexedDbOpener({ factory, keyRange });
  const db = await open(first, "db");
  const keeper = await open(first, "keeper");
  db.setVal(db.openTable("evts."), b("k"), b("db-value"));
  keeper.setVal(keeper.openTable("evts."), b("k"), b("keeper-value"));
  await run(() => db.flushed());
  await run(() => db.close());
  await run(() => keeper.close());

  const second = indexedDbOpener({ factory, keyRange });
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
