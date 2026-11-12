/**
 * Cases the generic store contract cannot express, because they depend on how a real
 * IndexedDB engine behaves: failed batches, concurrent openers, and store size.
 * Observations go through `note` so the runner can print them per engine.
 */

import { b } from "cesr-ts";
import { assertEquals, assertInstanceOf, assertRejects, assertThrows } from "jsr:@std/assert";
import { run } from "npm:effection@^3.6.0";
import { indexedDbOpener, StoreLockHeldError } from "../../db-indexeddb.ts";
import { DatabaseOperationError } from "../../src/core/errors.ts";
import { IndexedDbPersistence } from "../../src/db/core/indexeddb-persistence.ts";
import { type Persistence, PersistenceQueue, WebDBer } from "../../src/db/core/webdber.ts";
import { note } from "./notes.ts";

const unique = (label: string) => `${label}-${crypto.randomUUID()}`;
const adapter = (name: string) => new IndexedDbPersistence({ tail: "db" }, { name });
const text = (bytes: Uint8Array | null) => bytes && new TextDecoder().decode(bytes);

async function open(name: string, persistence: Persistence = adapter(name)): Promise<WebDBer> {
  const store = new WebDBer({ name }, persistence, new PersistenceQueue());
  await run(() => store.reopen());
  return store;
}

const rowPut = (table: string) => ({ table, key: b("k"), value: b("v") });

/** A put to a table nobody created makes the adapter abort after earlier requests already ran. */
async function abortedWriteLeavesNothing(): Promise<void> {
  const persistence = adapter(unique("abort"));
  try {
    await persistence.meta();
    const batch = { tables: [{ name: "plain.", dupsort: false }], version: "1.0.0", deletes: [] };
    const error = await assertRejects(() =>
      persistence.write({ ...batch, puts: [rowPut("plain."), rowPut("nowhere.")] })
    );
    assertInstanceOf(error, DatabaseOperationError);
    assertEquals(
      await persistence.meta(),
      { version: null, tables: [] },
      "no table, version or row survives the abort",
    );
    await persistence.write({ ...batch, puts: [rowPut("plain.")] });
    assertEquals((await persistence.load("plain.")).length, 1, "the same adapter writes normally afterwards");
  } finally {
    await persistence.clear();
  }
}

/** Mirror of the Deno latch test: a poisoned commit fails, the store latches, earlier commits stay durable. */
async function failedBatchLatchesStore(): Promise<void> {
  const name = unique("latch");
  const real = adapter(name);
  let poison = false;
  const persistence: Persistence = {
    meta: () => real.meta(),
    load: (table) => real.load(table),
    write: (batch) => real.write(poison ? { ...batch, puts: [...batch.puts, rowPut("nowhere.")] } : batch),
    clear: () => real.clear(),
    close: () => real.close(),
  };
  const store = await open(name, persistence);
  const survivor = adapter(name);
  try {
    const first = store.openTable("first.");
    store.setVal(first, b("one"), b("1"));
    await run(() => store.flushed());

    poison = true;
    store.setVal(store.openTable("second."), b("two"), b("2"));
    store.setVer("9.9.9");
    assertInstanceOf(await assertRejects(() => run(() => store.flushed())), DatabaseOperationError);
    assertThrows(() => store.setVal(first, b("three"), b("3")), DatabaseOperationError);
    await assertRejects(() => run(() => store.close()), DatabaseOperationError);

    const meta = await survivor.meta();
    assertEquals(meta.tables.map(({ name }) => name), ["first."], "the failed commit left no table");
    assertEquals(meta.version, "1.0.0", "nor its version");
    assertEquals((await survivor.load("first.")).length, 1, "the earlier commit is durable");
  } finally {
    await real.close();
    await survivor.clear();
  }
}

/** Read `key` from a fresh opener's view of the database, then release it. */
async function durableValue(name: string, key: string): Promise<string | null> {
  const reader = await open(name);
  try {
    return text(reader.getVal(reader.openTable("t."), b(key)));
  } finally {
    await run(() => reader.close());
  }
}

/** A store from a fresh opener with the single-writer lock off, so one database can be opened twice. */
async function openUnlocked(name: string): Promise<WebDBer> {
  const store = indexedDbOpener({ unsafeSkipStoreLock: true }).create({ tail: "db" }, { name });
  await run(() => store.reopen());
  return store;
}

/**
 * Two openers on one database name in one page, through the `unsafeSkipStoreLock` opt-out: nothing
 * excludes the second opener, mirrors diverge, and the last flushed write wins. That is the hazard
 * the default lock guards. What is asserted holds in every engine; the rest is printed.
 */
async function twoOpenersSameName(): Promise<void> {
  const name = unique("two-openers");
  const first = await openUnlocked(name);
  const second = await openUnlocked(name);
  try {
    const t1 = first.openTable("t.");
    const t2 = second.openTable("t.");
    first.setVal(t1, b("only-first"), b("1"));
    await run(() => first.flushed());
    note(`second opener sees the first's flushed row without reopen: ${second.getVal(t2, b("only-first")) !== null}`);
    assertEquals(second.getVal(t2, b("only-first")), null, "mirrors are loaded at open and never refreshed");

    second.setVal(t2, b("only-second"), b("2"));
    first.setVal(t1, b("shared"), b("first"));
    second.setVal(t2, b("shared"), b("second"));
    await run(() => first.flushed());
    await run(() => second.flushed());
    const durable = [];
    for (const key of ["only-first", "only-second", "shared"]) durable.push(await durableValue(name, key));
    note(`durable after both flush (only-first, only-second, shared): ${JSON.stringify(durable)}`);
    assertEquals(durable, ["1", "2", "second"], "disjoint rows from both survive; the last flush wins a shared key");
    assertEquals(text(first.getVal(t1, b("shared"))), "first", "the first opener's mirror keeps its own value");

    // Delete the database while the second opener still holds a connection.
    await run(() => first.close(true));
    second.setVal(t2, b("after-delete"), b("x"));
    const outcome = await run(() => second.flushed()).then(
      () => "write succeeded",
      (error: Error) => `${error.name}: ${error.message}`,
    );
    note(`second opener's write after the first deleted the database: ${outcome}`);
    assertEquals(outcome.startsWith("DatabaseOperationError"), true, `a deleted database is not recreated: ${outcome}`);
  } finally {
    await run(() => second.close(true)).catch(() => undefined);
    await adapter(name).clear();
  }
}

/** With real Web Locks a bare opener refuses a second opener in the page until the first store closes. */
async function bareOpenerIsSingleWriter(): Promise<void> {
  const name = unique("opener-lock");
  const first = indexedDbOpener().create({ tail: "db" }, { name });
  await run(() => first.reopen());
  try {
    const second = indexedDbOpener().create({ tail: "db" }, { name });
    await assertRejects(() => run(() => second.reopen()), StoreLockHeldError);
    assertEquals(second.opened, false);
  } finally {
    await run(() => first.close(true));
  }
  const again = indexedDbOpener().create({ tail: "db" }, { name });
  await run(() => again.reopen());
  await run(() => again.close(true));
}

/** A few thousand rows through flush, close and reopen; the elapsed open time is the evidence. */
async function largeStoreRoundTrip(): Promise<void> {
  const name = unique("large");
  const plainRows = 3000;
  const dupKeys = 500;
  const dupsPerKey = 3;
  const value = (i: number) => Uint8Array.from({ length: 64 }, (_, j) => (i + j) & 0xff);
  const key = (i: number) => b(`key-${String(i).padStart(6, "0")}`);
  const first = await open(name);
  try {
    const plain = first.openTable("plain.");
    const dups = first.openTable("dups.", { dupsort: true });
    for (let i = 0; i < plainRows; i++) first.setVal(plain, key(i), value(i));
    for (let i = 0; i < dupKeys; i++) for (let d = 0; d < dupsPerKey; d++) first.addVal(dups, key(i), value(i + d));
    const writeStart = performance.now();
    await run(() => first.flushed());
    const writeMs = performance.now() - writeStart;
    await run(() => first.close());

    const openStart = performance.now();
    const second = await open(name);
    const openMs = performance.now() - openStart;
    note(
      `large store: ${plainRows} plain + ${dupKeys * dupsPerKey} dup rows; `
        + `flush ${writeMs.toFixed(0)} ms, reopen ${openMs.toFixed(0)} ms`,
    );
    try {
      const plainAgain = second.openTable("plain.");
      const dupsAgain = second.openTable("dups.", { dupsort: true });
      for (let i = 0; i < plainRows; i++) assertEquals(second.getVal(plainAgain, key(i)), value(i), `plain row ${i}`);
      for (let i = 0; i < dupKeys; i++) {
        const expected = Array.from({ length: dupsPerKey }, (_, d) => String(value(i + d)));
        assertEquals(second.cntVals(dupsAgain, key(i)), dupsPerKey, `dup count ${i}`);
        assertEquals(new Set(second.getVals(dupsAgain, key(i)).map(String)), new Set(expected), `dups ${i}`);
      }
    } finally {
      await run(() => second.close(true));
    }
  } finally {
    await adapter(name).clear();
  }
}

/** Register the engine-sensitive cases. */
export function registerEngineCases(): void {
  Deno.test("engine: an aborted batch applies nothing to real IndexedDB", abortedWriteLeavesNothing);
  Deno.test("engine: a failed batch latches the store and leaves a durable prefix", failedBatchLatchesStore);
  Deno.test("engine: two openers on one database name diverge and the last flush wins", twoOpenersSameName);
  Deno.test("engine: a bare indexedDbOpener refuses a second opener on the same identity", bareOpenerIsSingleWriter);
  Deno.test("engine: a few thousand rows round-trip through flush, close and reopen", largeStoreRoundTrip);
}
