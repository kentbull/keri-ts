import { b, bytesHex, t } from "cesr-ts";
import { assertEquals, assertInstanceOf, assertRejects, assertStrictEquals, assertThrows } from "jsr:@std/assert";
import { run } from "npm:effection@^3.6.0";
import { DatabaseOperationError, PersistenceLatchedError, PersistenceReadError } from "../../../../src/core/errors.ts";
import type { Table, TableEntry } from "../../../../src/db/core/dber.ts";
import {
  type PersistedMeta,
  type Persistence,
  type PersistenceBatch,
  PersistenceQueue,
  WebDBer,
  WebStoreOpener,
} from "../../../../src/db/core/webdber.ts";
import { storeContract, wrapperContract } from "../store-contract.ts";

interface FakeTable {
  dupsort: boolean;
  rows: Map<string, TableEntry>;
}

/** Applies batches to plain maps, recording them, with a holdable and failable `write`. */
class FakePersistence implements Persistence {
  version: string | null = null;
  tables = new Map<string, FakeTable>();
  /** Every batch `write` was asked to apply, in arrival order, including a failed one. */
  batches: PersistenceBatch[] = [];
  closes = 0;
  clears = 0;
  /** Thrown by the next `failures` writes, each of which then applies nothing. */
  #failure: unknown = undefined;
  #failures = 0;
  #hold: Promise<void> | null = null;

  constructor(readonly starts: string[] = [], readonly label = "store") {}

  /** Make the next `times` writes throw `error`; by default every later write does. */
  fail(error: unknown, times = Number.POSITIVE_INFINITY): void {
    this.#failure = error;
    this.#failures = times;
  }

  /** Make writes wait until the returned function is called. */
  hold(): () => void {
    let release!: () => void;
    this.#hold = new Promise((resolve) => release = resolve);
    return () => {
      this.#hold = null;
      release();
    };
  }

  meta(): Promise<PersistedMeta> {
    return Promise.resolve({
      version: this.version,
      tables: [...this.tables].map(([name, { dupsort }]) => ({ name, dupsort })),
    });
  }

  /** Reversed, because an adapter owes no particular order. */
  load(table: string): Promise<TableEntry[]> {
    return Promise.resolve([...this.tables.get(table)!.rows.values()].reverse());
  }

  async write(batch: PersistenceBatch): Promise<void> {
    this.batches.push(batch);
    this.starts.push(`${this.label}:${this.batches.length}`);
    const held = this.#hold;
    if (held) await held;
    if (this.#failures > 0) {
      this.#failures -= 1;
      throw this.#failure;
    }
    for (const { name, dupsort } of batch.tables) this.tables.set(name, { dupsort, rows: new Map() });
    if (batch.version !== undefined) this.version = batch.version;
    const id = (table: string, key: Uint8Array, value: Uint8Array) =>
      this.tables.get(table)!.dupsort ? `${bytesHex(key)}/${bytesHex(value)}` : bytesHex(key);
    for (const { table, key, value } of batch.puts) {
      this.tables.get(table)!.rows.set(id(table, key, value), { key, value });
    }
    for (const { table, key, value } of batch.deletes) {
      this.tables.get(table)!.rows.delete(id(table, key, value ?? new Uint8Array()));
    }
  }

  clear(): Promise<void> {
    this.clears += 1;
    this.tables = new Map();
    this.version = null;
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.closes += 1;
    return Promise.resolve();
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
/** Three immediate retries, so a test that latches does not wait out the real schedule. */
const QUICK = [0, 0, 0];
const quickQueue = () => new PersistenceQueue(QUICK);

/** `error` is the latch report, carrying `failure` as its cause. */
function assertLatched(error: unknown, failure: unknown): void {
  assertInstanceOf(error, PersistenceLatchedError);
  assertStrictEquals(error.cause, failure);
}
const flush = (store: WebDBer) => run(() => store.flushed());

async function open(persistence = new FakePersistence(), queue = quickQueue()): Promise<WebDBer> {
  const store = new WebDBer({ name: "web" }, persistence, queue);
  assertEquals(await run(() => store.reopen()), true);
  return store;
}

/** A store whose opening version batch has already been persisted and forgotten. */
async function settled(persistence = new FakePersistence(), queue = quickQueue()): Promise<WebDBer> {
  const store = await open(persistence, queue);
  await flush(store);
  persistence.batches.length = 0;
  return store;
}

/** A batch rendered with its rows sorted, since an adapter's result cannot depend on their order. */
function view(batch: PersistenceBatch) {
  return {
    tables: batch.tables.map(({ name, dupsort }) => `${name}${dupsort ? " dupsort" : ""}`),
    version: batch.version,
    puts: batch.puts.map(({ table, key, value }) => `${table} ${t(key)}=${t(value)}`).sort(),
    deletes: batch.deletes.map(({ table, key, value }) => `${table} ${t(key)}${value ? `=${t(value)}` : ""}`).sort(),
  };
}

const empty = { tables: [], version: undefined, puts: [], deletes: [] };
const pairs = (rows: Iterable<TableEntry>) => [...rows].map(({ key, value }) => `${t(key)}=${t(value)}`);

function dump(store: WebDBer, names: string[]): [string, number[], number[]][] {
  return names.flatMap((name) =>
    [...store.scan(store.openTable(name))].map(({ key, value }): [string, number[], number[]] => [name, [...key], [
      ...value,
    ]])
  );
}

/** A store with one plain and one dupsort table whose creation is already persisted. */
async function withTables(): Promise<{ store: WebDBer; persistence: FakePersistence; plain: Table; dups: Table }> {
  const persistence = new FakePersistence();
  const store = await open(persistence);
  const plain = store.openTable("plain.");
  const dups = store.openTable("dups.", { dupsort: true });
  await flush(store);
  persistence.batches.length = 0;
  return { store, persistence, plain, dups };
}

const backend = {
  name: "WebDBer",
};
const contractStore = () => open(new FakePersistence());
storeContract(contractStore, backend);
wrapperContract(contractStore, backend);

Deno.test("WebDBer reopen loads a byte-identical mirror, including dupsort rows and the version", async () => {
  const persistence = new FakePersistence();
  const store = await open(persistence);
  const plain = store.openTable("plain.");
  const dups = store.openTable("dups.", { dupsort: true });
  store.openTable("unwritten.", { dupsort: true });
  for (const key of [[0xff], [0x80], [0x7f], [0x01], [0xff, 0x01]]) store.setVal(plain, new Uint8Array(key), b("v"));
  store.setVal(plain, b("blank"), new Uint8Array());
  for (const value of [[0xff], [0x10], [0x80]]) store.addVal(dups, b("k"), new Uint8Array(value));
  store.addVal(dups, b("j"), b("first"));
  store.setVer("2.5.0");
  const names = ["plain.", "dups.", "unwritten."];
  const before = dump(store, names);
  await run(() => store.close());

  const reopened = await open(persistence);
  assertEquals(dump(reopened, names), before);
  assertEquals(reopened.getVer(), "2.5.0");
  assertEquals(reopened.getVals(reopened.openTable("dups."), b("k")).map((value) => [...value]), [
    [0x10],
    [0x80],
    [0xff],
  ]);
  assertEquals(reopened.hasTable("unwritten."), true, "an empty table persists");
  reopened.addVal(reopened.openTable("unwritten."), b("k"), b("one"));
  reopened.addVal(reopened.openTable("unwritten."), b("k"), b("two"));
  assertEquals(reopened.cntVals(reopened.openTable("unwritten."), b("k")), 2, "its dupsort flag persisted too");
});

Deno.test("WebDBer writes the version marker of a new store in its first batch", async () => {
  const persistence = new FakePersistence();
  const store = await open(persistence);
  await flush(store);
  assertEquals(persistence.batches.map(view), [{ ...empty, version: "1.0.0" }]);
  assertEquals(persistence.version, "1.0.0");
  await run(() => store.close());
  const reopened = await settled(persistence);
  assertEquals(persistence.batches, [], "reopening an existing store rewrites nothing");
  assertEquals(reopened.getVer(), "1.0.0");
});

Deno.test("WebDBer reopen joins queued commits before loading", async () => {
  const { store, persistence, plain } = await withTables();
  const release = persistence.hold();
  store.setVal(plain, b("k"), b("v"));
  const reopening = run(() => store.reopen());
  await tick();
  assertEquals(store.opened, false);
  release();
  assertEquals(await reopening, true);
  assertEquals(pairs(store.scan(store.openTable("plain."))), ["k=v"]);
});

Deno.test("WebDBer batch: plain put, overwrite and delete carry exactly that commit", async () => {
  const { store, persistence, plain } = await withTables();
  store.setVal(plain, b("a"), b("1"));
  store.setVal(plain, b("a"), b("2"));
  store.setVal(plain, b("b"), b("1"));
  store.delVal(plain, b("a"));
  await flush(store);
  assertEquals(persistence.batches.map(view), [
    { ...empty, puts: ["plain. a=1"] },
    { ...empty, puts: ["plain. a=2"] },
    { ...empty, puts: ["plain. b=1"] },
    { ...empty, deletes: ["plain. a"] },
  ]);
  assertEquals([...persistence.tables.get("plain.")!.rows.values()].map(({ key }) => t(key)), ["b"]);
});

Deno.test("WebDBer batch: dupsort rows carry their (key, value) identity", async () => {
  const { store, persistence, dups } = await withTables();
  store.transaction(() => {
    store.addVal(dups, b("k"), b("1"));
    store.addVal(dups, b("k"), b("2"));
    store.addVal(dups, b("j"), b("9"));
  });
  store.delVal(dups, b("k"), b("1"));
  store.delVals(dups, b("j"));
  await flush(store);
  assertEquals(persistence.batches.map(view), [
    { ...empty, puts: ["dups. j=9", "dups. k=1", "dups. k=2"] },
    { ...empty, deletes: ["dups. k=1"] },
    { ...empty, deletes: ["dups. j=9"] },
  ]);
  assertEquals(persistence.tables.get("dups.")!.rows.size, 1);
});

Deno.test("WebDBer batch: a commit carries its net effect", async () => {
  const { store, persistence, plain, dups } = await withTables();
  store.setVal(plain, b("keep"), b("old"));
  store.setVal(plain, b("gone"), b("old"));
  store.addVal(dups, b("k"), b("stay"));
  await flush(store);
  persistence.batches.length = 0;

  store.transaction(() => {
    store.setVal(plain, b("keep"), b("mid"));
    store.setVal(plain, b("keep"), b("new"));
    store.setVal(plain, b("fleeting"), b("x"));
    store.delVal(plain, b("fleeting"));
    store.delVal(plain, b("gone"));
    store.addVal(dups, b("k"), b("new"));
    store.delVal(dups, b("k"), b("stay"));
    store.addVal(dups, b("k"), b("stay"));
  });
  await flush(store);
  assertEquals(persistence.batches.map(view), [{
    ...empty,
    puts: ["dups. k=new", "plain. keep=new"],
    deletes: ["plain. gone"],
  }]);
});

Deno.test("WebDBer enqueues nothing for a commit whose rows end where they began", async () => {
  const { store, persistence, plain, dups } = await withTables();
  store.setVal(plain, b("a"), b("1"));
  await flush(store);
  persistence.batches.length = 0;
  store.setVal(plain, b("a"), b("1"));
  store.transaction(() => {
    store.setVal(plain, b("a"), b("2"));
    store.setVal(plain, b("a"), b("1"));
    store.addVal(dups, b("k"), b("v"));
    store.delVal(dups, b("k"), b("v"));
  });
  store.transaction(() => store.getVal(plain, b("a")));
  await flush(store);
  assertEquals(persistence.batches, []);
});

Deno.test("WebDBer enqueues nothing for a rolled-back transaction", async () => {
  const { store, persistence, plain, dups } = await withTables();
  store.setVal(plain, b("a"), b("1"));
  await flush(store);
  persistence.batches.length = 0;
  assertThrows(() =>
    store.transaction(() => {
      store.setVal(plain, b("a"), b("changed"));
      store.addVal(dups, b("k"), b("v"));
      store.transaction(() => store.setVal(plain, b("nested"), b("v")));
      store.setVer("9.9.9");
      throw new Error("rollback");
    })
  );
  await flush(store);
  assertEquals(persistence.batches, []);
  assertEquals(store.getVer(), "1.0.0");
});

Deno.test("WebDBer batch: a savepoint rollback removes only the undone writes", async () => {
  const { store, persistence, plain, dups } = await withTables();
  store.setVal(plain, b("a"), b("1"));
  store.addVal(dups, b("k"), b("v"));
  await flush(store);
  persistence.batches.length = 0;
  store.transaction(() => {
    store.setVal(plain, b("outer"), b("1"));
    store.transaction(() => store.setVal(plain, b("kept"), b("1")));
    assertThrows(() =>
      store.transaction(() => {
        store.setVal(plain, b("a"), b("undone"));
        store.delVals(dups, b("k"));
        store.setVal(plain, b("undone"), b("1"));
        store.setVer("9.9.9");
        throw new Error("savepoint");
      })
    );
    store.setVal(plain, b("after"), b("1"));
  });
  await flush(store);
  assertEquals(persistence.batches.map(view), [{
    ...empty,
    puts: ["plain. after=1", "plain. kept=1", "plain. outer=1"],
  }]);
});

Deno.test("WebDBer enqueues one write per outermost commit", async () => {
  const { store, persistence, plain } = await withTables();
  store.transaction(() => {
    store.setVal(plain, b("a"), b("1"));
    store.transaction(() => {
      store.setVal(plain, b("b"), b("1"));
      store.transaction(() => store.setVal(plain, b("c"), b("1")));
    });
  });
  assertEquals(persistence.batches, [], "write-behind: nothing is written before the commit returns");
  store.transaction(() => store.setVal(plain, b("d"), b("1")));
  store.setVal(plain, b("e"), b("1"));
  await flush(store);
  assertEquals(persistence.batches.map(view).map(({ puts }) => puts), [
    ["plain. a=1", "plain. b=1", "plain. c=1"],
    ["plain. d=1"],
    ["plain. e=1"],
  ]);
});

Deno.test("WebDBer carries a new table in the first batch, and in none after a rollback", async () => {
  const persistence = new FakePersistence();
  const store = await settled(persistence);
  assertThrows(() =>
    store.transaction(() => {
      store.setVal(store.openTable("rolledback.", { dupsort: true }), b("k"), b("v"));
      throw new Error("rollback");
    })
  );
  const plain = store.openTable("plain.");
  store.openTable("dups.", { dupsort: true });
  store.setVal(plain, b("a"), b("1"));
  store.setVal(plain, b("b"), b("1"));
  await flush(store);
  assertEquals(persistence.batches.map(view), [
    { ...empty, tables: ["plain.", "dups. dupsort"], puts: ["plain. a=1"] },
    { ...empty, puts: ["plain. b=1"] },
  ]);
  assertEquals(store.hasTable("rolledback."), false);
});

Deno.test("WebDBer flushed persists a table no commit carried, once", async () => {
  const persistence = new FakePersistence();
  const store = await settled(persistence);
  store.openTable("empty.", { dupsort: true });
  await flush(store);
  await flush(store);
  assertEquals(persistence.batches.map(view), [{ ...empty, tables: ["empty. dupsort"] }]);
});

Deno.test("WebDBer gives the adapter bytes that never alias the mirror", async () => {
  const { store, persistence, plain } = await withTables();
  store.setVal(plain, b("k"), b("v"));
  await flush(store);
  const [{ key, value }] = persistence.batches[0].puts;
  key[0] = value[0] = 0x7a;
  assertEquals(pairs(store.scan(plain)), ["k=v"]);
});

Deno.test("WebDBer applies batches of every store on one queue in global commit order", async () => {
  const starts: string[] = [];
  const queue = new PersistenceQueue();
  const first = new FakePersistence(starts, "keeper");
  const second = new FakePersistence(starts, "baser");
  const keeper = await settled(first, queue);
  const baser = await settled(second, queue);
  const [keys, events] = [keeper.openTable("keys."), baser.openTable("events.")];
  await flush(keeper);
  await flush(baser);
  starts.length = 0;
  const [releaseFirst, releaseSecond] = [first.hold(), second.hold()];

  keeper.setVal(keys, b("k"), b("1"));
  baser.setVal(events, b("e"), b("1"));
  keeper.setVal(keys, b("k"), b("2"));
  await tick();
  assertEquals(starts, ["keeper:2"], "the later store waits for the earlier commit to be durable");
  releaseFirst();
  await tick();
  assertEquals(starts, ["keeper:2", "baser:2"]);
  releaseSecond();
  await run(() => queue.flushed());
  assertEquals(starts, ["keeper:2", "baser:2", "keeper:3"]);
});

Deno.test("the queue latches after the retry budget and refuses new commits with PersistenceLatchedError", async () => {
  const starts: string[] = [];
  const queue = quickQueue();
  const first = new FakePersistence(starts, "keeper");
  const second = new FakePersistence(starts, "baser");
  const keeper = await settled(first, queue);
  const baser = await settled(second, queue);
  const [keys, events] = [keeper.openTable("keys."), baser.openTable("events.")];
  await flush(keeper);
  await flush(baser);
  starts.length = 0;

  const failure = new Error("quota exceeded");
  first.fail(failure);
  keeper.setVal(keys, b("k"), b("lost"));
  baser.setVal(events, b("e"), b("after the gap"));
  for (const store of [keeper, baser]) {
    assertLatched(await assertRejects(() => flush(store)), failure);
  }
  assertEquals(queue.status(), "latched");
  assertEquals(starts, ["keeper:2", "keeper:3", "keeper:4", "keeper:5"], "one attempt plus three retries");
  assertEquals(
    first.batches.slice(1).every((batch) => batch === first.batches[1]),
    true,
    "every attempt is that batch",
  );
  assertEquals(second.tables.get("events.")!.rows.size, 0, "the batch after the failure never reached persistence");

  assertEquals(t(keeper.getVal(keys, b("k"))!), "lost", "the unpersisted commit stays readable");
  assertEquals(t(baser.getVal(events, b("e"))!), "after the gap", "reads continue on every store");
  assertLatched(assertThrows(() => keeper.setVal(keys, b("k"), b("refused"))), failure);
  assertThrows(() => baser.transaction(() => 1), PersistenceLatchedError);
  assertThrows(() => keeper.openTable("new."), PersistenceLatchedError);
  assertThrows(() => queue.assertHealthy(), PersistenceLatchedError);
  assertEquals(t(keeper.getVal(keys, b("k"))!), "lost", "a refused write leaves the mirror unchanged");
  assertEquals(keeper.openTable("keys.") === keys, true, "an existing table still binds for reads");
  assertEquals(await queue.read(() => Promise.resolve("durable prefix")), "durable prefix", "a read still runs");
  assertEquals(starts.length, 4);
});

Deno.test("a failed batch is retried in place and later batches wait", async () => {
  const starts: string[] = [];
  const queue = quickQueue();
  const first = new FakePersistence(starts, "keeper");
  const second = new FakePersistence(starts, "baser");
  const keeper = await settled(first, queue);
  const baser = await settled(second, queue);
  const [keys, events] = [keeper.openTable("keys."), baser.openTable("events.")];
  await flush(keeper);
  await flush(baser);
  starts.length = 0;

  first.fail(new Error("transaction aborted"), 2);
  keeper.setVal(keys, b("k"), b("1"));
  baser.setVal(events, b("e"), b("1"));
  await run(() => queue.flushed());
  assertEquals(starts, ["keeper:2", "keeper:3", "keeper:4", "baser:2"], "the baser batch waits behind every retry");
  assertEquals(pairs(first.tables.get("keys.")!.rows.values()), ["k=1"]);
  assertEquals(pairs(second.tables.get("events.")!.rows.values()), ["e=1"]);
});

Deno.test("a batch that succeeds on retry leaves the queue healthy", async () => {
  const { store, persistence, plain } = await withTables();
  persistence.fail(new Error("transaction aborted"), 1);
  store.setVal(plain, b("k"), b("v"));
  await flush(store);
  assertEquals(store.getVal(plain, b("k")) !== null, true);
  assertEquals(persistence.batches.length, 2, "the failed attempt and its successful retry");
  assertEquals(pairs(persistence.tables.get("plain.")!.rows.values()), ["k=v"]);
  store.setVal(plain, b("next"), b("v"));
  await flush(store);
  assertEquals(persistence.tables.get("plain.")!.rows.size, 2, "later commits persist as usual");
  await run(() => store.close());
});

Deno.test("read runs after earlier commits and returns its value", async () => {
  const queue = quickQueue();
  const persistence = new FakePersistence();
  const store = await settled(persistence, queue);
  const table = store.openTable("t.");
  const release = persistence.hold();
  store.setVal(table, b("k"), b("v"));
  const log: string[] = [];
  const reading = queue.read(() => {
    log.push("read");
    return Promise.resolve(pairs(persistence.tables.get("t.")!.rows.values()));
  });
  queue.enqueue(() => Promise.resolve(void log.push("later")));
  await tick();
  assertEquals(log, [], "the read waits for the earlier commit");
  release();
  assertEquals(await reading, ["k=v"], "the read sees the earlier commit durable");
  await run(() => queue.flushed());
  assertEquals(log, ["read", "later"], "a task enqueued after the read runs after it");
  await run(() => store.close());
});

Deno.test("a throwing read rejects its caller and does not latch", async () => {
  const queue = quickQueue();
  const cause = new Error("read failed");
  let calls = 0;
  const error = await assertRejects(() =>
    queue.read(() => {
      calls += 1;
      return Promise.reject(cause);
    }), PersistenceReadError);
  assertStrictEquals(error.cause, cause);
  assertEquals(calls, 1, "a read is not retried");
  assertEquals(queue.status(), "healthy");
  queue.assertHealthy();
  let ran = false;
  queue.enqueue(() => Promise.resolve(void (ran = true)));
  await run(() => queue.flushed());
  assertEquals(ran, true);
});

Deno.test("status reports healthy, retrying and latched", async () => {
  const queue = quickQueue();
  assertEquals(queue.status(), "healthy");
  let attempts = 0;
  let release!: () => void;
  const retried = new Promise<void>((resolve) => release = resolve);
  queue.enqueue(() => ++attempts === 1 ? Promise.reject(new Error("aborted")) : retried);
  while (attempts < 2) await tick();
  assertEquals(queue.status(), "retrying");
  queue.assertHealthy();
  release();
  await run(() => queue.flushed());
  assertEquals(queue.status(), "healthy");

  const failure = new Error("gone");
  queue.enqueue(() => Promise.reject(failure));
  assertLatched(await assertRejects(() => run(() => queue.flushed())), failure);
  assertEquals(queue.status(), "latched");
});

Deno.test("release still runs after a latch", async () => {
  const queue = quickQueue();
  const failure = new Error("gone");
  const log: string[] = [];
  queue.enqueue(() => Promise.reject(failure));
  queue.enqueue(() => Promise.resolve(void log.push("skipped")));
  queue.release(() => Promise.resolve(void log.push("released")));
  queue.release(() => Promise.reject(new Error("close failed too")));
  assertLatched(await assertRejects(() => run(() => queue.flushed())), failure);
  assertEquals(log, ["released"]);
});

Deno.test("WebDBer close reports a latched failure, does not clear, and refuses reuse", async () => {
  const queue = quickQueue();
  const persistence = new FakePersistence();
  const store = await settled(persistence, queue);
  const failure = new Error("write failed");
  persistence.fail(failure);
  const table = store.openTable("t.");
  store.setVal(table, b("k"), b("v"));

  assertLatched(await assertRejects(() => run(() => store.close(true))), failure);
  assertEquals(persistence.clears, 0, "a failed store is not deleted");
  assertEquals(persistence.closes, 1, "its connection is still released");
  assertEquals(store.opened, false);
  assertLatched(await assertRejects(() => run(() => store.close())), failure);
  assertLatched(await assertRejects(() => run(() => store.reopen())), failure);
  assertEquals(store.opened, false);
});

Deno.test("WebDBer recovers its durable prefix through a new queue", async () => {
  const persistence = new FakePersistence();
  const store = await settled(persistence);
  const table = store.openTable("t.");
  store.setVal(table, b("durable"), b("1"));
  await flush(store);
  persistence.fail(new Error("write failed"));
  store.setVal(table, b("lost"), b("1"));
  store.setVal(table, b("skipped"), b("1"));
  await assertRejects(() => flush(store));

  const recovered = await open(persistence);
  assertEquals(pairs(recovered.scan(recovered.openTable("t."))), ["durable=1"]);
});

Deno.test("WebDBer flushed waits for an in-flight slow write", async () => {
  const { store, persistence, plain } = await withTables();
  const release = persistence.hold();
  store.setVal(plain, b("k"), b("v"));
  let done = false;
  const waiting = flush(store).then(() => done = true);
  await tick();
  assertEquals(done, false);
  assertEquals(persistence.tables.get("plain.")!.rows.size, 0);
  release();
  await waiting;
  assertEquals(persistence.tables.get("plain.")!.rows.size, 1);
});

Deno.test("WebDBer flushed covers only commits made before the call", async () => {
  const { store, persistence, plain } = await withTables();
  const release = persistence.hold();
  store.setVal(plain, b("first"), b("v"));
  const waiting = flush(store);
  store.setVal(plain, b("second"), b("v"));
  await tick();
  assertEquals(persistence.batches.length, 1, "the write behind it has not started");
  release();
  await waiting;
  await flush(store);
  assertEquals(persistence.batches.length, 2);
});

Deno.test("WebDBer halting a flushed waiter cancels only the wait", async () => {
  const { store, persistence, plain } = await withTables();
  const release = persistence.hold();
  store.setVal(plain, b("k"), b("v"));
  const waiter = run(() => store.flushed());
  await tick();
  await waiter.halt();
  assertEquals(persistence.batches.length, 1, "the write is still in flight");
  release();
  await flush(store);
  assertEquals(persistence.tables.get("plain.")!.rows.size, 1);
});

Deno.test("WebDBer close drains the queue, and refuses commits from then on", async () => {
  const { store, persistence, plain } = await withTables();
  const release = persistence.hold();
  store.setVal(plain, b("k"), b("v"));
  let done = false;
  const closing = run(() => store.close()).then(() => done = true);
  await tick();
  assertEquals(done, false, "close waits for the in-flight write");
  assertEquals(store.opened, false, "the mirror stops accepting work before the join");
  release();
  await closing;
  assertEquals(persistence.closes, 1);
  assertEquals(persistence.tables.get("plain.")!.rows.size, 1);
});

Deno.test("WebDBer close joins the queue even when cancelled", async () => {
  const { store, persistence, plain } = await withTables();
  const release = persistence.hold();
  store.setVal(plain, b("k"), b("v"));
  const closing = run(() => store.close());
  await tick();
  let halted = false;
  const halting = closing.halt().then(() => halted = true);
  await tick();
  assertEquals(halted, false, "a cancelled close is still waiting for the write");
  release();
  await halting;
  assertEquals(persistence.tables.get("plain.")!.rows.size, 1);
});

Deno.test("WebDBer close reports a failure even when cancelled", async () => {
  const { store, persistence, plain } = await withTables();
  const failure = new Error("write failed");
  const release = persistence.hold();
  persistence.fail(failure);
  store.setVal(plain, b("k"), b("v"));
  const closing = run(() => store.close());
  await tick();
  const halting = Promise.resolve(closing.halt());
  await tick();
  release();
  assertLatched(await assertRejects(() => halting), failure);
});

Deno.test("WebDBer close(true) drains, then deletes what was persisted", async () => {
  const { store, persistence, plain } = await withTables();
  const release = persistence.hold();
  store.setVal(plain, b("k"), b("v"));
  const closing = run(() => store.close(true));
  await tick();
  assertEquals(persistence.clears, 0, "clear waits behind the queued batch");
  release();
  await closing;
  assertEquals([persistence.clears, persistence.closes, persistence.tables.size, persistence.version], [1, 1, 0, null]);

  const reopened = await open(persistence);
  assertEquals(reopened.hasTable("plain."), false);
  assertEquals(reopened.getVer(), "1.0.0");
});

Deno.test("WebDBer close(true) of a closed store still deletes what was persisted", async () => {
  const { store, persistence, plain } = await withTables();
  store.setVal(plain, b("k"), b("v"));
  await run(() => store.close());
  assertEquals(persistence.tables.size, 2);
  await run(() => store.close(true));
  assertEquals([persistence.clears, persistence.closes, persistence.tables.size], [1, 1, 0]);
});

Deno.test("WebDBer reopen({ clear: true }) starts from nothing", async () => {
  const { store, persistence, plain } = await withTables();
  store.setVal(plain, b("k"), b("v"));
  assertEquals(await run(() => store.reopen({ clear: true })), true);
  assertEquals(store.hasTable("plain."), false);
  await flush(store);
  assertEquals([persistence.clears, persistence.tables.size, persistence.version], [1, 0, "1.0.0"]);
});

Deno.test("WebDBer readonly opens a snapshot, refuses writes and persists nothing", async () => {
  const persistence = new FakePersistence();
  const absent = new WebDBer({ readonly: true }, persistence, new PersistenceQueue());
  assertEquals(await run(() => absent.reopen()), false, "a readonly open of nothing persisted reports false");
  await run(() => absent.close());

  const writer = await open(persistence);
  writer.setVal(writer.openTable("t."), b("k"), b("v"));
  await run(() => writer.close());
  persistence.batches.length = 0;

  const reader = new WebDBer({ readonly: true }, persistence, new PersistenceQueue());
  assertEquals(await run(() => reader.reopen()), true);
  const table = reader.openTable("t.");
  assertEquals(pairs(reader.scan(table)), ["k=v"]);
  assertEquals(reader.openTable("absent."), undefined);
  assertThrows(() => reader.setVal(table, b("k"), b("w")), DatabaseOperationError);
  await run(() => reader.flushed());
  await run(() => reader.close());
  assertEquals(persistence.batches, []);
});

Deno.test("WebDBer refuses a persisted table that repeats a row", async () => {
  const persistence = new FakePersistence();
  persistence.tables.set("t.", { dupsort: false, rows: new Map() });
  persistence.load = () => Promise.resolve([{ key: b("k"), value: b("1") }, { key: b("k"), value: b("2") }]);
  await assertRejects(
    () => run(() => new WebDBer({}, persistence, new PersistenceQueue()).reopen()),
    DatabaseOperationError,
    "repeats a row",
  );
});

Deno.test("WebStoreOpener binds one queue to every store it creates", async () => {
  const adapters = new Map<string, FakePersistence>();
  const opener = new WebStoreOpener((family) => {
    const adapter = new FakePersistence();
    adapters.set(family.tail, adapter);
    return adapter;
  });
  const keeper = opener.create({ tail: "ks" }, { name: "wallet" });
  const baser = opener.create({ tail: "db" }, { name: "wallet" });
  await run(() => keeper.reopen());
  await run(() => baser.reopen());
  assertEquals([keeper.name, baser.name], ["wallet", "wallet"]);

  const failure = new Error("write failed");
  adapters.get("ks")!.fail(failure);
  keeper.setVal(keeper.openTable("k."), b("k"), b("v"));
  assertLatched(await assertRejects(() => run(() => opener.queue.flushed())), failure);
  assertThrows(() => baser.transaction(() => 1), PersistenceLatchedError);
  await assertRejects(() => run(() => baser.close()));
  await assertRejects(() => run(() => keeper.close()));
});
