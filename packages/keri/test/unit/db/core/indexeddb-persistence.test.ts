import { b, t } from "cesr-ts";
import { assertEquals, assertInstanceOf, assertRejects, assertThrows } from "jsr:@std/assert";
import { run } from "npm:effection@^3.6.0";
import { IDBFactory, IDBKeyRange } from "npm:fake-indexeddb@6.2.5";
import { DatabaseOperationError } from "../../../../src/core/errors.ts";
import type { TableEntry } from "../../../../src/db/core/dber.ts";
import { IndexedDbPersistence } from "../../../../src/db/core/indexeddb-persistence.ts";
import {
  type PersistedMeta,
  type Persistence,
  type PersistenceBatch,
  PersistenceQueue,
  WebDBer,
} from "../../../../src/db/core/webdber.ts";
import { storeContract, wrapperContract } from "../store-contract.ts";

const keyRange = IDBKeyRange as unknown as typeof globalThis.IDBKeyRange;
const newFactory = () => new IDBFactory() as unknown as IDBFactory;
const adapter = (factory: IDBFactory, name = "web", tail = "db", temp = false) =>
  new IndexedDbPersistence({ tail }, { name, temp }, factory, keyRange);

async function open(
  persistence: Persistence,
  queue = new PersistenceQueue(),
  name = "web",
): Promise<WebDBer> {
  const store = new WebDBer({ name }, persistence, queue);
  assertEquals(await run(() => store.reopen()), true);
  return store;
}

const dump = (store: WebDBer, names: string[]) =>
  names.flatMap((name) => [...store.scan(store.openTable(name))].map(({ key, value }) => [name, [...key], [...value]]));

/** Wraps a DOM object so its calls stay bound to the real one, with chosen properties replaced. */
function spy<T extends object>(target: T, replace: (prop: string | symbol, real: T) => unknown): T {
  return new Proxy(target, {
    get(real, prop) {
      const replaced = replace(prop, real);
      if (replaced !== undefined) return replaced;
      const value = Reflect.get(real, prop, real);
      return typeof value === "function" ? value.bind(real) : value;
    },
    set(real, prop, value) {
      return Reflect.set(real, prop, value, real);
    },
  });
}

/** What the adapter did to a factory: ordered events, and the options of every transaction. */
interface Trace {
  events: string[];
  transactions: { stores: string | string[]; mode: string; options: unknown }[];
}

/** A factory whose transactions, requests and their `success`/`complete` events are logged in order. */
function traced(real: IDBFactory, label = "db", events: string[] = []): { factory: IDBFactory; trace: Trace } {
  const trace: Trace = { events, transactions: [] };
  const spyTransaction = (transaction: IDBTransaction, id: number) => {
    transaction.addEventListener("complete", () => trace.events.push(`${label}#${id} complete`));
    transaction.addEventListener("abort", () => trace.events.push(`${label}#${id} abort`));
    const spyStore = (store: IDBObjectStore) =>
      spy(store, (prop, realStore) => {
        if (prop !== "put" && prop !== "delete") return undefined;
        return (...args: unknown[]) => {
          const request = (realStore[prop] as (...a: unknown[]) => IDBRequest)(...args);
          request.addEventListener("success", () => trace.events.push(`${label}#${id} ${prop} success`));
          return request;
        };
      });
    return spy(
      transaction,
      (prop, realTransaction) =>
        prop === "objectStore" ? (name: string) => spyStore(realTransaction.objectStore(name)) : undefined,
    );
  };
  const spyDatabase = (db: IDBDatabase) =>
    spy(
      db,
      (prop, realDb) =>
        prop === "transaction"
          ? (stores: string | string[], mode: IDBTransactionMode, options?: unknown) => {
            const id = trace.transactions.length;
            trace.transactions.push({ stores, mode, options });
            trace.events.push(`${label}#${id} begin ${mode}`);
            const transaction = (realDb.transaction as (...a: unknown[]) => IDBTransaction)(stores, mode, options);
            return spyTransaction(transaction, id);
          }
          : undefined,
    );
  const factory = spy(
    real,
    (prop, realFactory) =>
      prop === "open"
        ? (name: string, version?: number) =>
          spy(realFactory.open(name, version), (p, request) => p === "result" ? spyDatabase(request.result) : undefined)
        : undefined,
  );
  return { factory, trace };
}

const storeOf = (factory: IDBFactory) => {
  const store = new WebDBer({ name: "contract" }, adapter(factory, "contract"), new PersistenceQueue());
  return run(() => store.reopen()).then(() => store);
};
storeContract(() => storeOf(newFactory()), { name: "WebDBer over IndexedDB" });
wrapperContract(() => storeOf(newFactory()), { name: "WebDBer over IndexedDB" });

Deno.test("IndexedDbPersistence reopens byte-identical after a real close and a fresh adapter", async () => {
  const factory = newFactory();
  const store = await open(adapter(factory));
  const plain = store.openTable("plain.");
  const dups = store.openTable("dups.", { dupsort: true });
  store.openTable("unwritten.", { dupsort: true });
  for (const key of [[0xff], [0x80], [0x7f], [0x01], [0xff, 0x01], [0x00, 0xfe]]) {
    store.setVal(plain, new Uint8Array(key), new Uint8Array([0xff, 0x80, 0x00]));
  }
  store.setVal(plain, b("blank"), new Uint8Array());
  for (const value of [[0xff], [0x10], [0x80], [0x00, 0x90]]) store.addVal(dups, b("k"), new Uint8Array(value));
  store.addVal(dups, b("j"), b("first"));
  store.setVer("2.5.0");
  const names = ["plain.", "dups.", "unwritten."];
  const before = dump(store, names);
  await run(() => store.close());

  const reopened = await open(adapter(factory));
  assertEquals(dump(reopened, names), before);
  assertEquals(reopened.getVer(), "2.5.0");
  assertEquals(reopened.hasTable("unwritten."), true, "an empty table persists");
  const unwritten = reopened.openTable("unwritten.");
  reopened.addVal(unwritten, b("k"), b("one"));
  reopened.addVal(unwritten, b("k"), b("two"));
  assertEquals(reopened.cntVals(unwritten, b("k")), 2, "its dupsort flag persisted too");
  assertEquals(reopened.getVal(reopened.openTable("plain."), b("blank")), new Uint8Array());
  await run(() => reopened.close());
});

Deno.test("IndexedDbPersistence load returns only that table's rows as caller-owned copies", async () => {
  const factory = newFactory();
  const store = await open(adapter(factory));
  store.setVal(store.openTable("a"), b("k"), b("a-value"));
  store.setVal(store.openTable("ab"), b("k"), b("ab-value"));
  store.addVal(store.openTable("a.dups", { dupsort: true }), b("k"), b("d"));
  await run(() => store.close());

  const persistence = adapter(factory);
  await persistence.meta();
  const rows: TableEntry[] = await persistence.load("a");
  assertEquals(rows.map(({ key, value }) => `${t(key)}=${t(value)}`), ["k=a-value"]);
  assertInstanceOf(rows[0].key, Uint8Array);
  rows[0].value.fill(0);
  assertEquals((await persistence.load("a"))[0].value, b("a-value"), "mutating a result never reaches the store");
  await persistence.close();
});

Deno.test("IndexedDbPersistence write is one atomic transaction that leaves nothing when it aborts", async () => {
  const factory = newFactory();
  const persistence = adapter(factory);
  await persistence.meta();
  const batch = (puts: PersistenceBatch["puts"]): PersistenceBatch => ({
    tables: [{ name: "plain.", dupsort: false }],
    version: "1.0.0",
    puts,
    deletes: [],
  });
  const put = (table: string) => ({ table, key: b("k"), value: b("v") });

  // The second put names a table nobody created, so the transaction aborts after earlier requests ran.
  const failure = await assertRejects(() => persistence.write(batch([put("plain."), put("nowhere.")])));
  assertInstanceOf(failure, DatabaseOperationError);
  assertEquals(await persistence.meta(), { version: null, tables: [] } satisfies PersistedMeta);
  await persistence.write(batch([put("plain.")]));
  assertEquals((await persistence.load("plain.")).length, 1);
  await persistence.close();
});

Deno.test("IndexedDbPersistence write rejects and applies nothing when a request throws mid-batch", async () => {
  const factory = newFactory();
  const persistence = adapter(factory);
  await persistence.meta();
  await persistence.write({ tables: [{ name: "t.", dupsort: false }], puts: [], deletes: [] });
  // A malformed row throws while the transaction is open, after the table creation was requested.
  const bad = { table: "t.", key: { buffer: [] } as unknown as Uint8Array, value: b("v") };
  const error = await assertRejects(() => persistence.write({ tables: [], puts: [bad], deletes: [] }));
  assertInstanceOf(error, Error);
  assertEquals((await persistence.load("t.")).length, 0);
  await persistence.close();
});

Deno.test("a failed batch latches the queue and the durable state is a prefix of the commits", async () => {
  const factory = newFactory();
  const real = adapter(factory);
  let poison = false;
  const persistence: Persistence = {
    meta: () => real.meta(),
    load: (table) => real.load(table),
    write: (batch) =>
      real.write(
        poison ? { ...batch, puts: [...batch.puts, { table: "nowhere.", key: b("k"), value: b("v") }] } : batch,
      ),
    clear: () => real.clear(),
    close: () => real.close(),
  };
  const store = await open(persistence);
  const first = store.openTable("first.");
  store.setVal(first, b("one"), b("1"));
  await run(() => store.flushed());

  poison = true;
  const second = store.openTable("second.");
  store.setVal(second, b("two"), b("2"));
  store.setVer("9.9.9");
  const failure = await assertRejects(() => run(() => store.flushed()));
  assertInstanceOf(failure, DatabaseOperationError);
  assertThrows(() => store.setVal(first, b("three"), b("3")), DatabaseOperationError);
  await assertRejects(() => run(() => store.close()), DatabaseOperationError);

  const survivor = await open(adapter(factory));
  assertEquals(dump(survivor, ["first."]).length, 1, "the earlier commit is durable");
  assertEquals(survivor.hasTable("second."), false, "the failed commit left no table");
  assertEquals(survivor.getVer(), "1.0.0", "nor its version");
  await run(() => survivor.close());
});

Deno.test("write resolves only after the transaction completes, never on a request's success", async () => {
  const { factory, trace } = traced(newFactory());
  const persistence = adapter(factory);
  await persistence.meta();
  trace.events.length = 0;
  const writing = persistence.write({
    tables: [{ name: "plain.", dupsort: false }],
    version: "1.0.0",
    puts: [{ table: "plain.", key: b("k"), value: b("v") }, { table: "plain.", key: b("l"), value: b("w") }],
    deletes: [{ table: "plain.", key: b("gone") }],
  });
  writing.then(() => trace.events.push("write resolved"));
  await writing;
  await Promise.resolve();
  const events = trace.events.map((event) => event.replace(/#\d+/, ""));
  assertEquals(events.at(-1), "write resolved");
  assertEquals(events.at(-2), "db complete");
  assertEquals(events.filter((event) => event.endsWith("success")).length, 5, "all requests succeed first");
  const lastSuccess = events.findLastIndex((event) => event.endsWith("success"));
  assertEquals(events.lastIndexOf("db complete") > lastSuccess, true);
  await persistence.close();
});

Deno.test("meta and load resolve only after their read transaction completes", async () => {
  const { factory, trace } = traced(newFactory());
  const persistence = adapter(factory);
  trace.events.length = 0;
  await persistence.meta().then(() => trace.events.push("meta resolved"));
  await persistence.load("plain.").then(() => trace.events.push("load resolved"));
  await Promise.resolve();
  const events = trace.events.map((event) => event.replace(/#\d+/, ""));
  assertEquals(events.filter((event) => event === "db complete").length, 2);
  assertEquals(events.indexOf("meta resolved") > events.indexOf("db complete"), true, "meta waited for complete");
  assertEquals(events.at(-2), "db complete", "load waited for complete");
  assertEquals(events.at(-1), "load resolved");
  await persistence.close();
});

Deno.test("every write is one readwrite transaction that requests strict durability", async () => {
  const { factory, trace } = traced(newFactory());
  const store = await open(adapter(factory));
  const plain = store.openTable("plain.");
  const dups = store.openTable("dups.", { dupsort: true });
  await run(() => store.flushed());
  trace.transactions.length = 0;
  store.transaction(() => {
    store.setVal(plain, b("k"), b("v"));
    store.addVal(dups, b("k"), b("d"));
    store.setVer("3.0.0");
  });
  await run(() => store.flushed());
  store.transaction(() => {
    store.delVal(plain, b("k"));
    store.setVal(plain, b("m"), b("n"));
  });
  await run(() => store.flushed());
  await run(() => store.close());

  const writes = trace.transactions.filter(({ mode }) => mode === "readwrite");
  assertEquals(writes.length, 2, "a commit touching two tables and the version is a single transaction");
  for (const write of writes) assertEquals(write.options, { durability: "strict" });
});

Deno.test("two stores on one queue persist in commit order through real transactions", async () => {
  const factory = newFactory();
  const events: string[] = [];
  const one = traced(factory, "one", events);
  const two = traced(factory, "two", events);
  const queue = new PersistenceQueue();
  const baser = await open(adapter(one.factory, "baser"), queue, "baser");
  const keeper = await open(adapter(two.factory, "keeper"), queue, "keeper");
  const a = baser.openTable("a.");
  const k = keeper.openTable("k.");
  await run(() => keeper.flushed());
  events.length = 0;

  baser.setVal(a, b("1"), b("first"));
  keeper.setVal(k, b("2"), b("second"));
  baser.setVal(a, b("3"), b("third"));
  keeper.setVal(k, b("4"), b("fourth"));
  await run(() => keeper.flushed());

  // Each commit's transaction completes before the next begins, alternating as committed.
  const phases = events.filter((event) => /begin|complete/.test(event)).map((event) => event.replace(/#\d+/, ""));
  assertEquals(phases, [
    "one begin readwrite",
    "one complete",
    "two begin readwrite",
    "two complete",
    "one begin readwrite",
    "one complete",
    "two begin readwrite",
    "two complete",
  ]);
  await run(() => baser.close());
  await run(() => keeper.close());

  const reopened = await open(adapter(factory, "baser"));
  assertEquals(dump(reopened, ["a."]).length, 2);
  await run(() => reopened.close());
});

Deno.test("close releases the connection and a later meta reconnects", async () => {
  const factory = newFactory();
  const persistence = adapter(factory);
  await persistence.meta();
  await persistence.write({ tables: [{ name: "t.", dupsort: true }], version: "1.0.0", puts: [], deletes: [] });
  await persistence.close();
  await assertRejects(() => persistence.load("t."), DatabaseOperationError, "not connected");
  assertEquals(await persistence.meta(), { version: "1.0.0", tables: [{ name: "t.", dupsort: true }] });
  await persistence.close();
  await persistence.close();
});

Deno.test("clear deletes the database and a fresh adapter sees an empty store", async () => {
  const factory = newFactory();
  const store = await open(adapter(factory));
  store.setVal(store.openTable("plain."), b("k"), b("v"));
  await run(() => store.close(true));
  assertEquals((await factory.databases()).length, 0);
  const fresh = adapter(factory);
  assertEquals(await fresh.meta(), { version: null, tables: [] });
  await fresh.close();
});

Deno.test("clear rejects instead of hanging when a foreign connection blocks the delete", async () => {
  const factory = newFactory();
  const persistence = adapter(factory);
  await persistence.meta();
  const [{ name }] = await factory.databases();
  const foreign = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(name!);
    request.onsuccess = () => resolve(request.result); // deliberately ignores versionchange
    request.onerror = () => reject(request.error);
  });
  const error = await assertRejects(() => persistence.clear(), DatabaseOperationError, "another connection");
  assertInstanceOf(error, DatabaseOperationError);
  foreign.close();
});

Deno.test("another context's delete closes our connection and the next write fails instead of recreating", async () => {
  const factory = newFactory();
  const first = adapter(factory);
  const second = adapter(factory);
  await first.meta();
  await second.meta();
  await first.write({ tables: [{ name: "t.", dupsort: false }], puts: [], deletes: [] });
  await second.clear(); // would block forever if `first` ignored versionchange
  await assertRejects(
    () => first.write({ tables: [], puts: [{ table: "t.", key: b("k"), value: b("v") }], deletes: [] }),
    DatabaseOperationError,
    "versionchange",
  );
  assertEquals(await first.meta(), { version: null, tables: [] }, "a new open reconnects to the cleared store");
  await first.close();
});

Deno.test("stores of one identity keep separate databases per family and temp flag", async () => {
  const factory = newFactory();
  const batch: PersistenceBatch = { tables: [{ name: "t", dupsort: false }], version: "1.0.0", puts: [], deletes: [] };
  const baser = adapter(factory, "shared", "db");
  const keeper = adapter(factory, "shared", "ks");
  const temp = adapter(factory, "shared", "db", true);
  for (const persistence of [baser, keeper, temp]) await persistence.meta();
  await baser.write(batch);
  assertEquals((await keeper.meta()).tables, []);
  assertEquals((await temp.meta()).version, null);

  await temp.write(batch);
  await temp.clear();
  assertEquals((await baser.meta()).version, "1.0.0");
  await keeper.close();
  await baser.close();
});
