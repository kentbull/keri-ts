import { b, bytesHex, t } from "cesr-ts";
import { assertEquals, assertInstanceOf, assertRejects, assertThrows } from "jsr:@std/assert";
import { run } from "npm:effection@^3.6.0";
import { IDBFactory } from "npm:fake-indexeddb@6.2.5";
import { DatabaseOperationError, MissingDurableStateError } from "../../../../src/core/errors.ts";
import { IndexedDbPersistence } from "../../../../src/db/core/indexeddb-persistence.ts";
import {
  type Persistence,
  type PersistenceBatch,
  PersistenceQueue,
  WebDBer,
} from "../../../../src/db/core/webdber.ts";
import { storeContract, wrapperContract } from "../store-contract.ts";

const newFactory = () => new IDBFactory() as unknown as IDBFactory;
const adapter = (factory: IDBFactory, name = "web", tail = "db", temp = false) =>
  new IndexedDbPersistence({ tail }, { name, temp }, factory);

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

Deno.test("IndexedDbPersistence open returns each table's own rows as caller-owned copies", async () => {
  const factory = newFactory();
  const store = await open(adapter(factory));
  store.setVal(store.openTable("a"), b("k"), b("a-value"));
  store.setVal(store.openTable("ab"), b("k"), b("ab-value"));
  store.setVal(store.openTable("a.b"), b("k"), b("a.b-value"));
  store.addVal(store.openTable("a.dups", { dupsort: true }), b("k"), b("d"));
  await run(() => store.close());

  const persistence = adapter(factory);
  const persisted = await persistence.open();
  const rowsOf = (name: string) =>
    persisted.tables.find((table) => table.name === name)!.rows.map(({ key, value }) => `${t(key)}=${t(value)}`);
  assertEquals(rowsOf("a"), ["k=a-value"], "table a does not absorb a.b or ab");
  assertEquals(rowsOf("ab"), ["k=ab-value"]);
  assertEquals(rowsOf("a.b"), ["k=a.b-value"], "a table name may contain a dot");
  assertEquals(rowsOf("a.dups"), ["k=d"]);
  const [row] = persisted.tables.find((table) => table.name === "a")!.rows;
  assertInstanceOf(row.key, Uint8Array);
  row.value.fill(0);
  const again = await persistence.open();
  assertEquals(again.tables.find((table) => table.name === "a")!.rows[0].value, b("a-value"));
  await persistence.close();
});

/** The raw `rows` records of the database `adapter` wrote, bypassing the adapter. */
async function rawRows(
  factory: IDBFactory,
): Promise<Array<[IDBValidKey, { t: string; k: ArrayBuffer; v: ArrayBuffer }]>> {
  const [{ name }] = await factory.databases();
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(name!);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    const store = db.transaction("rows", "readonly").objectStore("rows");
    const [keys, values] = await Promise.all([
      new Promise<IDBValidKey[]>((resolve) => {
        const request = store.getAllKeys();
        request.onsuccess = () => resolve(request.result);
      }),
      new Promise<Array<{ t: string; k: ArrayBuffer; v: ArrayBuffer }>>((resolve) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
      }),
    ]);
    return keys.map((key, index) => [key, values[index]]);
  } finally {
    db.close();
  }
}

Deno.test("IndexedDbPersistence stores each row under a plain string id and a self-describing record", async () => {
  const factory = newFactory();
  const persistence = adapter(factory);
  await persistence.open();
  const key = new Uint8Array([0xff, 0x00, 0x7f]);
  await persistence.write({
    tables: [{ name: "a.b", dupsort: false }, { name: "d.", dupsort: true }],
    puts: [
      { table: "a.b", key, value: b("v") },
      { table: "d.", key, value: b("one") },
      { table: "d.", key, value: b("two") },
    ],
    deletes: [],
  });
  const rows = await rawRows(factory);
  assertEquals(
    rows.map(([id]) => id).sort(),
    [
      `ff007f..a.b`,
      `ff007f.${bytesHex(b("one"))}.d.`,
      `ff007f.${bytesHex(b("two"))}.d.`,
    ].sort(),
  );
  const plain = rows.find(([id]) => id === "ff007f..a.b")![1];
  assertEquals(plain.t, "a.b");
  assertEquals([...new Uint8Array(plain.k)], [...key]);
  assertEquals(t(new Uint8Array(plain.v)), "v");
  await persistence.close();
});

Deno.test("IndexedDbPersistence overwrites a plain key, keeps distinct duplicates and deletes exactly", async () => {
  const factory = newFactory();
  const persistence = adapter(factory);
  await persistence.open();
  const put = (table: string, value: string) => ({ table, key: b("k"), value: b(value) });
  await persistence.write({
    tables: [{ name: "p", dupsort: false }, { name: "d", dupsort: true }],
    puts: [put("p", "first"), put("d", "x"), put("d", "y"), put("d", "z")],
    deletes: [],
  });
  await persistence.write({
    tables: [],
    puts: [put("p", "second")],
    deletes: [{ table: "d", key: b("k"), value: b("y") }],
  });
  const persisted = await persistence.open();
  const values = (name: string) =>
    persisted.tables.find((table) => table.name === name)!.rows.map(({ value }) => t(value)).sort();
  assertEquals(values("p"), ["second"], "a put on the same identity overwrites");
  assertEquals(values("d"), ["x", "z"], "each duplicate has its own row and only the named one is deleted");
  await persistence.close();
});

Deno.test("IndexedDbPersistence open refuses a row whose table has no record", async () => {
  const factory = newFactory();
  const persistence = adapter(factory);
  await persistence.open();
  await persistence.write({ tables: [{ name: "t.", dupsort: false }], puts: [], deletes: [] });
  const [{ name }] = await factory.databases();
  const db = await new Promise<IDBDatabase>((resolve) => {
    const request = factory.open(name!);
    request.onsuccess = () => resolve(request.result);
  });
  await new Promise<void>((resolve) => {
    const transaction = db.transaction("rows", "readwrite");
    transaction.objectStore("rows").put({ t: "orphan.", k: new ArrayBuffer(1), v: new ArrayBuffer(1) }, "00..orphan.");
    transaction.oncomplete = () => resolve();
  });
  db.close();
  await assertRejects(() => persistence.open(), MissingDurableStateError, "orphan.");
  await persistence.close();
});

Deno.test("IndexedDbPersistence upgrading a format 1 database wipes it", async () => {
  const factory = newFactory();
  const place = JSON.stringify(["", "web", "db", "durable"]);
  const legacy = await new Promise<IDBDatabase>((resolve) => {
    const request = factory.open(`keri-ts:${place}`, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("rows");
      request.result.createObjectStore("meta");
    };
    request.onsuccess = () => resolve(request.result);
  });
  await new Promise<void>((resolve) => {
    const transaction = legacy.transaction(["rows", "meta"], "readwrite");
    transaction.objectStore("rows").put(new ArrayBuffer(1), ["old.", new ArrayBuffer(1), new ArrayBuffer(0)]);
    transaction.objectStore("meta").put(false, "table:old.");
    transaction.objectStore("meta").put("1.0.0", "version");
    transaction.oncomplete = () => resolve();
  });
  legacy.close();

  const persistence = adapter(factory);
  assertEquals(await persistence.open(), { version: null, tables: [] });
  await persistence.write({
    tables: [{ name: "new.", dupsort: false }],
    puts: [{ table: "new.", key: b("k"), value: b("v") }],
    deletes: [],
  });
  assertEquals((await rawRows(factory)).length, 1, "only the new format's row exists");
  await persistence.close();
});

Deno.test("IndexedDbPersistence open rejects instead of hanging when an old connection blocks the upgrade", async () => {
  const factory = newFactory();
  const place = JSON.stringify(["", "web", "db", "durable"]);
  const legacy = await new Promise<IDBDatabase>((resolve) => {
    const request = factory.open(`keri-ts:${place}`, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("rows");
      request.result.createObjectStore("meta");
    };
    request.onsuccess = () => resolve(request.result); // ignores versionchange, so it blocks the upgrade
  });
  let late!: Promise<void>;
  const watched = spy(factory, (prop, real) =>
    prop === "open"
      ? (name: string, version?: number) => {
        const request = real.open(name, version);
        late = new Promise((resolve) => request.addEventListener("success", () => resolve()));
        return request;
      }
      : undefined);
  await assertRejects(() => adapter(watched).open(), DatabaseOperationError, "blocks its upgrade");
  legacy.close();
  // The upgrade request is still pending; its late connection must be closed, so a delete is not blocked.
  await late;
  await adapter(factory).clear();
});

Deno.test("IndexedDbPersistence marks itself lost with a named error when the browser closes the connection", async () => {
  const connections: IDBDatabase[] = [];
  const real = newFactory();
  const factory = spy(real, (prop, target) =>
    prop === "open"
      ? (name: string, version?: number) => {
        const request = target.open(name, version);
        request.addEventListener("success", () => connections.push(request.result));
        return request;
      }
      : undefined);
  const persistence = adapter(factory);
  await persistence.open();
  connections[0].onclose?.(new Event("close"));
  await assertRejects(
    () => persistence.write({ tables: [], puts: [], deletes: [] }),
    DatabaseOperationError,
    "closed abnormally",
  );
  assertEquals((await persistence.open()).tables, [], "a new open reconnects");
  await persistence.close();
});

Deno.test("IndexedDbPersistence write is one atomic transaction that leaves nothing when it aborts", async () => {
  const factory = newFactory();
  const persistence = adapter(factory);
  await persistence.open();
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
  assertEquals(await persistence.open(), { version: null, tables: [] });
  await persistence.write(batch([put("plain.")]));
  assertEquals((await persistence.open()).tables[0].rows.length, 1);
  await persistence.close();
});

Deno.test("IndexedDbPersistence write rejects and applies nothing when a request throws mid-batch", async () => {
  const factory = newFactory();
  const persistence = adapter(factory);
  await persistence.open();
  await persistence.write({ tables: [{ name: "t.", dupsort: false }], puts: [], deletes: [] });
  // A malformed row throws while the transaction is open, after the table creation was requested.
  const bad = { table: "t.", key: { buffer: [] } as unknown as Uint8Array, value: b("v") };
  const error = await assertRejects(() => persistence.write({ tables: [], puts: [bad], deletes: [] }));
  assertInstanceOf(error, Error);
  assertEquals((await persistence.open()).tables[0].rows.length, 0);
  await persistence.close();
});

Deno.test("a failed batch latches the queue and the durable state is a prefix of the commits", async () => {
  const factory = newFactory();
  const real = adapter(factory);
  let poison = false;
  const persistence: Persistence = {
    open: () => real.open(),
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
  await persistence.open();
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

Deno.test("open resolves only after its read transaction completes", async () => {
  const { factory, trace } = traced(newFactory());
  const persistence = adapter(factory);
  trace.events.length = 0;
  await persistence.open().then(() => trace.events.push("open resolved"));
  await Promise.resolve();
  const events = trace.events.map((event) => event.replace(/#\d+/, ""));
  assertEquals(events.filter((event) => event === "db complete").length, 1, "one transaction reads rows and meta");
  assertEquals(events.at(-2), "db complete");
  assertEquals(events.at(-1), "open resolved");
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

Deno.test("close releases the connection and a later open reconnects", async () => {
  const factory = newFactory();
  const persistence = adapter(factory);
  await persistence.open();
  await persistence.write({ tables: [{ name: "t.", dupsort: true }], version: "1.0.0", puts: [], deletes: [] });
  await persistence.close();
  await assertRejects(
    () => persistence.write({ tables: [], puts: [], deletes: [] }),
    DatabaseOperationError,
    "not connected",
  );
  assertEquals(await persistence.open(), { version: "1.0.0", tables: [{ name: "t.", dupsort: true, rows: [] }] });
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
  assertEquals(await fresh.open(), { version: null, tables: [] });
  await fresh.close();
});

Deno.test("clear rejects instead of hanging when a foreign connection blocks the delete", async () => {
  const factory = newFactory();
  const persistence = adapter(factory);
  await persistence.open();
  const [{ name }] = await factory.databases();
  const foreign = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(name!);
    request.onsuccess = () => resolve(request.result); // deliberately ignores versionchange
    request.onerror = () => reject(request.error);
  });
  await assertRejects(() => persistence.clear(), DatabaseOperationError, "another connection");
  foreign.close();
});

Deno.test("another context's delete closes our connection and the next write fails instead of recreating", async () => {
  const factory = newFactory();
  const first = adapter(factory);
  const second = adapter(factory);
  await first.open();
  await second.open();
  await first.write({ tables: [{ name: "t.", dupsort: false }], puts: [], deletes: [] });
  await second.clear(); // would block forever if `first` ignored versionchange
  await assertRejects(
    () => first.write({ tables: [], puts: [{ table: "t.", key: b("k"), value: b("v") }], deletes: [] }),
    DatabaseOperationError,
    "versionchange",
  );
  assertEquals(await first.open(), { version: null, tables: [] }, "a new open reconnects to the cleared store");
  await first.close();
});

Deno.test("stores of one identity keep separate databases per family and temp flag", async () => {
  const factory = newFactory();
  const batch: PersistenceBatch = { tables: [{ name: "t", dupsort: false }], version: "1.0.0", puts: [], deletes: [] };
  const baser = adapter(factory, "shared", "db");
  const keeper = adapter(factory, "shared", "ks");
  const temp = adapter(factory, "shared", "db", true);
  for (const persistence of [baser, keeper, temp]) await persistence.open();
  await baser.write(batch);
  assertEquals((await keeper.open()).tables, []);
  assertEquals((await temp.open()).version, null);

  await temp.write(batch);
  await temp.clear();
  assertEquals((await baser.open()).version, "1.0.0");
  await keeper.close();
  await baser.close();
});
