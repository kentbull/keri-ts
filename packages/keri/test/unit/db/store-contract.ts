/**
 * ADR-0015 store contract, run unchanged against every `DBer` backend.
 *
 * Assertions are the shared semantics; a backend difference is a failing test. Cases are
 * drawn from `core/memstore.test.ts` and `core/lmdber-*.test.ts`, which keep
 * their backend-specific checks (lifecycle, paths, map size, native handles).
 */

import { b, t } from "cesr-ts";
import { assertEquals, assertInstanceOf, assertStrictEquals, assertThrows } from "jsr:@std/assert";
import { run } from "npm:effection@^3.6.0";
import { DatabaseKeyError, DatabaseNotOpenError } from "../../../src/core/errors.ts";
import { RawRecord } from "../../../src/core/records.ts";
import { type DBer, MAX_KEY_BYTES, type ScanOptions, type Table, type TableEntry } from "../../../src/db/core/dber.ts";
import { DupKomer, Komer } from "../../../src/db/koming.ts";
import {
  BytesIoSetSuber,
  DupSuber,
  IoDupSuber,
  OnIoDupSuber,
  OnIoSetSuber,
  OnSuber,
  Suber,
} from "../../../src/db/subing.ts";

/** Builds a fresh, open, empty store. The contract closes it with `close(true)`. */
export type OpenStore = () => Promise<DBer>;

/** A backend under test; `name` labels its tests. */
export interface Backend {
  name: string;
}

const EMPTY = new Uint8Array(0);
const bytes = (length: number, fill = 0x61) => new Uint8Array(length).fill(fill);
const texts = (rows: Iterable<Uint8Array>) => [...rows].map((row) => t(row));
const pairs = (rows: Iterable<TableEntry>) => [...rows].map(({ key, value }) => `${t(key)}=${t(value)}`);

async function withStore(open: OpenStore, fn: (store: DBer) => void | Promise<void>): Promise<void> {
  const store = await open();
  try {
    await fn(store);
  } finally {
    await run(() => store.close(true));
  }
}

function refuses(fn: () => unknown, error: new(...args: never[]) => Error, label: string): void {
  assertInstanceOf(assertThrows(fn, label), error, label);
}

/** Seed `a=1 a=2 a=3 b=1 b=2 c=1` in a dupsort table and `a b c` (value `<key>v`) in a plain one. */
function seeded(store: DBer): { dups: Table; plain: Table } {
  const dups = store.openTable("dups.", { dupsort: true });
  const plain = store.openTable("plain.");
  for (const [key, val] of [["a", "1"], ["a", "2"], ["a", "3"], ["b", "1"], ["b", "2"], ["c", "1"]]) {
    store.addVal(dups, b(key), b(val));
  }
  for (const key of ["a", "b", "c"]) store.setVal(plain, b(key), b(`${key}v`));
  return { dups, plain };
}

/** `[label, options, dupsort entries, distinct keys]` over `seeded`; a plain table yields each key once. */
const scanCases: [string, ScanOptions, string, string][] = [
  ["all", {}, "a1 a2 a3 b1 b2 c1", "a b c"],
  ["reverse", { reverse: true }, "c1 b2 b1 a3 a2 a1", "c b a"],
  ["start", { start: b("b") }, "b1 b2 c1", "b c"],
  ["exclusive start skips every duplicate of the key", { start: b("b"), exclusiveStart: true }, "c1", "c"],
  ["reverse start", { start: b("b"), reverse: true }, "b2 b1 a3 a2 a1", "b a"],
  ["reverse exclusive", { start: b("b"), reverse: true, exclusiveStart: true }, "a3 a2 a1", "a"],
  ["absent start", { start: b("bb") }, "c1", "c"],
  [
    "reverse absent start seeks the greatest entry not above it",
    { start: b("bb"), reverse: true },
    "b2 b1 a3 a2 a1",
    "b a",
  ],
  ["reverse past end", { start: b("z"), reverse: true }, "c1 b2 b1 a3 a2 a1", "c b a"],
  ["reverse before first", { start: b("0"), reverse: true }, "", ""],
  ["end is exclusive", { start: b("a"), end: b("b") }, "a1 a2 a3", "a"],
  ["reverse end is the exclusive lower bound", { start: b("c"), end: b("a"), reverse: true }, "c1 b2 b1", "c b"],
  ["limit counts rows, or distinct keys", { limit: 2 }, "a1 a2", "a b"],
  ["reverse limit", { reverse: true, limit: 2 }, "c1 b2", "c b"],
  ["limit with exclusive start", { start: b("a"), exclusiveStart: true, limit: 1 }, "b1", "b"],
  ["zero limit", { limit: 0 }, "", ""],
  ["empty start is absent", { start: EMPTY, exclusiveStart: true }, "a1 a2 a3 b1 b2 c1", "a b c"],
  ["empty end is absent", { end: EMPTY }, "a1 a2 a3 b1 b2 c1", "a b c"],
  ["inverted range", { start: b("c"), end: b("a") }, "", ""],
];

/** Register the `DBer`-level contract for one backend. */
export function storeContract(open: OpenStore, backend: Backend): void {
  const test = (name: string, fn: (store: DBer) => void | Promise<void>) =>
    Deno.test(`store contract [${backend.name}]: ${name}`, () => withStore(open, fn));

  test("orders keys by unsigned bytes, including above 0x7f", (store) => {
    const table = store.openTable("t.");
    for (const key of [[0xff], [0x80], [0x7f], [0x01], [0x7f, 0x00], [0xff, 0x01]]) {
      store.setVal(table, new Uint8Array(key), b("v"));
    }
    const order = [[0x01], [0x7f], [0x7f, 0x00], [0x80], [0xff], [0xff, 0x01]];
    assertEquals([...store.scan(table)].map(({ key }) => [...key]), order);
    assertEquals([...store.scanKeys(table, { reverse: true })].map((key) => [...key]), order.toReversed());
  });

  test("orders duplicates bytewise and identifies a dupsort row by its pair", (store) => {
    const dups = store.openTable("d.", { dupsort: true });
    for (const val of [[0xff], [0x10], [0x80], [0x10]]) store.setVal(dups, b("k"), new Uint8Array(val));
    assertEquals(store.getVals(dups, b("k")).map((val) => [...val]), [[0x10], [0x80], [0xff]]);
    assertEquals([store.cntVals(dups, b("k")), store.cnt(dups)], [3, 3]);
    assertEquals([...store.getVal(dups, b("k"))!], [0x10]);
    assertEquals([...store.getValLast(dups, b("k"))!], [0xff]);

    assertEquals(store.addVal(dups, b("k"), new Uint8Array([0x80])), false);
    assertEquals(store.putVal(dups, b("k"), b("other")), false);
    assertEquals(store.putVals(dups, b("k"), [new Uint8Array([0x80]), new Uint8Array([0x90])]), false);
    assertEquals(store.cntVals(dups, b("k")), 4);
    assertEquals(store.delVal(dups, b("k"), new Uint8Array([0x90])), true);
    assertEquals(store.delVal(dups, b("k"), new Uint8Array([0x90])), false);
    assertEquals(store.delVal(dups, b("k")), true);
    assertEquals(store.cnt(dups), 0);
  });

  for (const [label, options, entries, keys] of scanCases) {
    test(`scan and scanKeys: ${label}`, (store) => {
      const { dups, plain } = seeded(store);
      const flat = (rows: Iterable<TableEntry>) => [...rows].map(({ key, value }) => t(key) + t(value)).join(" ");
      assertEquals(flat(store.scan(dups, options)), entries);
      assertEquals(texts(store.scanKeys(dups, options)).join(" "), keys);
      const plainKeys = keys ? keys.split(" ") : [];
      assertEquals(flat(store.scan(plain, options)), plainKeys.map((key) => `${key}${key}v`).join(" "));
      assertEquals(texts(store.scanKeys(plain, options)), plainKeys);
    });
  }

  test("scan bounds are unvalidated and compare as bytes, even over the key limit", (store) => {
    const { plain, dups } = seeded(store);
    const over = bytes(MAX_KEY_BYTES * 2);
    assertEquals(texts(store.scanKeys(plain, { start: over })), ["b", "c"]);
    assertEquals(texts(store.scanKeys(plain, { start: over, reverse: true })), ["a"]);
    assertEquals(texts(store.scanKeys(plain, { end: over })), ["a"]);
    assertEquals(texts(store.scanKeys(plain, { start: b("c"), end: over, reverse: true })), ["c", "b"]);
    assertEquals([...store.scan(dups, { end: over, limit: 2 })].length, 2);
    store.addVal(dups, b("k"), b("a"));
    store.addVal(dups, b("k"), b("b"));
    assertEquals(t(store.seekVal(dups, b("k"), over)!), "b");
    assertEquals(store.seekVal(dups, b("a"), over), null);
  });

  test("seekVal finds the first duplicate not below a value within one key", (store) => {
    const { dups } = seeded(store);
    assertEquals(t(store.seekVal(dups, b("a"))!), "1");
    assertEquals(t(store.seekVal(dups, b("a"), b("15"))!), "2");
    assertEquals(t(store.seekVal(dups, b("a"), EMPTY)!), "1");
    assertEquals(store.seekVal(dups, b("a"), b("4")), null);
    assertEquals(store.seekVal(dups, b("absent")), null);
    assertEquals(store.seekVal(dups, b("a0"), b("1")), null, "a neighbouring key's duplicates never answer");
  });

  test("writes reject an empty key and a key or dupsort value over 1,978 bytes", (store) => {
    const plain = store.openTable("p.");
    const dups = store.openTable("d.", { dupsort: true });
    const writes: [string, (key: Uint8Array) => unknown][] = [
      ["putVal", (key) => store.putVal(plain, key, b("v"))],
      ["setVal", (key) => store.setVal(plain, key, b("v"))],
      ["setVal dupsort", (key) => store.setVal(dups, key, b("v"))],
      ["putVals", (key) => store.putVals(dups, key, [b("v")])],
      ["addVal", (key) => store.addVal(dups, key, b("v"))],
      ["putIoDupVals", (key) => store.putIoDupVals(dups, key, [b("v")])],
    ];
    for (const [label, write] of writes) {
      for (const key of [EMPTY, bytes(MAX_KEY_BYTES + 1)]) {
        refuses(() => write(key), DatabaseKeyError, `${label} ${key.length}`);
      }
    }
    assertEquals(store.cnt(plain) + store.cnt(dups), 0);

    const edge = bytes(MAX_KEY_BYTES);
    for (const [label, write] of writes.slice(0, 5)) {
      assertEquals(typeof write(edge), "boolean", `${label} at the limit`);
    }
    assertEquals(t(store.getVal(plain, edge)!), "v");
    assertEquals(texts(store.getVals(dups, edge)), ["v"]);
    assertEquals(store.delVal(plain, edge), true);

    const long = bytes(MAX_KEY_BYTES + 1);
    assertEquals(store.setVal(dups, b("big"), edge), true);
    refuses(() => store.setVal(dups, b("big"), long), DatabaseKeyError, "setVal long dupsort value");
    refuses(() => store.addVal(dups, b("big2"), long), DatabaseKeyError, "addVal long dupsort value");
    refuses(() => store.putVal(dups, b("big2"), long), DatabaseKeyError, "putVal long dupsort value");
    refuses(() => store.delVal(dups, b("big"), long), DatabaseKeyError, "delVal long dupsort value");
    assertEquals(store.setVal(plain, b("big"), bytes(5000)), true, "only dupsort values are limited");
    assertEquals(store.getVal(plain, b("big"))!.length, 5000);

    // IoDup stores a 33-byte proem before the value, so the logical limit is smaller.
    const logical = MAX_KEY_BYTES - 33;
    assertEquals(store.putIoDupVals(dups, b("io"), [bytes(logical)]), true);
    refuses(() => store.putIoDupVals(dups, b("io"), [b("ok"), bytes(logical + 1)]), DatabaseKeyError, "IoDup value");
    assertEquals(store.cntIoDups(dups, b("io")), 1, "a refused call writes nothing");
  });

  test("point reads and deletes reject an empty key and report an over-long key as absent", (store) => {
    const plain = store.openTable("p.");
    const dups = store.openTable("d.", { dupsort: true });
    store.setVal(plain, b("first"), b("v"));
    store.addVal(dups, b("first"), b("v")); // a non-empty table: LMDB read an empty key as its first key
    const long = bytes(MAX_KEY_BYTES + 1);

    refuses(() => store.getVal(plain, EMPTY), DatabaseKeyError, "getVal");
    refuses(() => store.delVal(plain, EMPTY), DatabaseKeyError, "delVal");
    refuses(() => store.delVal(dups, EMPTY, b("v")), DatabaseKeyError, "delVal with value");
    refuses(() => store.delVals(dups, EMPTY), DatabaseKeyError, "delVals");
    assertEquals(store.getVal(plain, long), null);
    assertEquals(store.delVal(plain, long), false);
    assertEquals(store.delVal(dups, long, b("v")), false);
    assertEquals(store.delVals(dups, long), false);

    // The contract's "point reads" for duplicates: an empty or over-long key is absent, not an error.
    for (const key of [EMPTY, long]) {
      assertEquals(store.getVals(dups, key), []);
      assertEquals(store.getValLast(dups, key), null);
      assertEquals([...store.getValsIter(dups, key)], []);
      assertEquals(store.cntVals(dups, key), 0);
      assertEquals(store.seekVal(dups, key), null);
      assertEquals(store.seekVal(dups, key, b("a")), null);
    }
    assertEquals(store.cnt(plain) + store.cnt(dups), 2);
  });

  test("empty values are valid on plain tables only", (store) => {
    const plain = store.openTable("p.");
    const dups = store.openTable("d.", { dupsort: true });
    assertEquals(store.putVal(plain, b("e"), EMPTY), true);
    assertEquals(store.getVal(plain, b("e")), EMPTY);
    assertEquals(store.putVal(plain, b("e"), b("x")), false);

    // LMDB cannot hold an empty duplicate beside others, so no backend accepts one.
    store.addVal(dups, b("k"), b("a"));
    const empties: [string, () => unknown][] = [
      ["putVal", () => store.putVal(dups, b("new"), EMPTY)],
      ["setVal", () => store.setVal(dups, b("k"), EMPTY)],
      ["putVals", () => store.putVals(dups, b("k"), [b("b"), EMPTY])],
      ["addVal", () => store.addVal(dups, b("k"), EMPTY)],
    ];
    for (const [label, write] of empties) refuses(write, DatabaseKeyError, label);
    assertEquals(texts(store.getVals(dups, b("k"))), ["a"], "a refused write leaves the key untouched");
    assertEquals(store.getVals(dups, b("new")), []);
    assertEquals(store.delVal(dups, b("k"), EMPTY), false, "an empty duplicate is always absent");
    assertEquals(store.cnt(dups), 1);
    // IoDup stores a proem with the value, so an empty logical value is an ordinary row.
    assertEquals(store.addIoDupVal(dups, b("io"), EMPTY), true);
    assertEquals(store.addIoDupVal(dups, b("io"), b("a")), true);
    assertEquals(store.getIoDupVals(dups, b("io")), [EMPTY, b("a")]);
  });

  test("buffers are copied in and out and never alias the store", (store) => {
    const plain = store.openTable("p.");
    const dups = store.openTable("d.", { dupsort: true });
    const key = b("key");
    const val = b("val");
    store.setVal(plain, key, val);
    key[0] = val[0] = 0x7a;
    assertEquals(t(store.getVal(plain, b("key"))!), "val");
    const backing = b("xxkeyvalyy");
    store.setVal(plain, backing.subarray(2, 5), backing.subarray(5, 8));
    assertEquals(t(store.getVal(plain, b("key"))!), "val", "a view into a larger buffer is written as its own bytes");

    store.getVal(plain, b("key"))![0] = 0x7a;
    for (const entry of store.scan(plain)) entry.key[0] = entry.value[0] = 0x7a;
    for (const scanned of store.scanKeys(plain)) scanned[0] = 0x7a;
    for (const [itemKey, itemVal] of store.getTopItemIter(plain)) itemKey[0] = itemVal[0] = 0x7a;
    assertEquals(pairs(store.scan(plain)), ["key=val"]);

    const dup = b("dup");
    store.addVal(dups, b("k"), dup);
    dup[0] = 0x7a;
    store.getVals(dups, b("k"))[0][0] = 0x7a;
    store.getValLast(dups, b("k"))![0] = 0x7a;
    store.seekVal(dups, b("k"))![0] = 0x7a;
    for (const value of store.getValsIter(dups, b("k"))) value[0] = 0x7a;
    assertEquals(texts(store.getVals(dups, b("k"))), ["dup"]);
    assertStrictEquals(store.getVal(dups, b("k")) === store.getVal(dups, b("k")), false);
  });

  test("commit publishes, a throw rolls back and rethrows, and a writer sees its own writes", (store) => {
    const plain = store.openTable("p.");
    assertEquals(store.inWriteTransaction, false);
    assertEquals(
      store.transaction(() => {
        assertEquals(store.inWriteTransaction, true);
        store.setVal(plain, b("a"), b("1"));
        assertEquals(texts(store.scanKeys(plain)), ["a"], "a scan inside a writer sees its earlier writes");
        return "result";
      }),
      "result",
    );
    assertEquals(store.inWriteTransaction, false);

    for (const thrown of [new Error("boom"), "not an error"]) {
      assertStrictEquals(
        assertThrows(() =>
          store.transaction(() => {
            store.setVal(plain, b("b"), b("1"));
            store.delVal(plain, b("a"));
            throw thrown;
          })
        ),
        thrown,
      );
    }
    assertEquals(pairs(store.scan(plain)), ["a=1"]);
    assertEquals(store.inWriteTransaction, false);

    store.transaction(() => {
      store.setVal(plain, b("before"), b("1"));
      refuses(() => store.setVal(plain, bytes(MAX_KEY_BYTES + 1), b("v")), DatabaseKeyError, "bad key inside a writer");
      store.setVal(plain, b("after"), b("1"));
    });
    assertEquals(texts(store.scanKeys(plain)), ["a", "after", "before"], "a refused write does not poison the writer");
  });

  test("nested transactions are savepoints", (store) => {
    const { plain, dups } = seeded(store);
    const inner = new Error("inner");
    store.transaction(() => {
      store.setVal(plain, b("outer"), b("1"));
      assertStrictEquals(
        assertThrows(() =>
          store.transaction(() => {
            assertEquals(store.inWriteTransaction, true);
            store.setVal(plain, b("inner"), b("1"));
            store.setVal(plain, b("a"), b("changed"));
            store.delVal(plain, b("b"));
            store.addVal(dups, b("a"), b("9"));
            store.delVals(dups, b("b"));
            throw inner;
          })
        ),
        inner,
      );
      assertEquals(store.inWriteTransaction, true);
      assertEquals(store.getVal(plain, b("inner")), null);
      assertEquals(t(store.getVal(plain, b("a"))!), "av");
      assertEquals(t(store.getVal(plain, b("b"))!), "bv");
      assertEquals(pairs(store.scan(dups)), ["a=1", "a=2", "a=3", "b=1", "b=2", "c=1"]);
      store.setVal(plain, b("outer2"), b("1"));
    });
    assertEquals(texts(store.scanKeys(plain)), ["a", "b", "c", "outer", "outer2"]);
  });

  test("an outer rollback discards committed nested work", (store) => {
    const { plain, dups } = seeded(store);
    const before = [...pairs(store.scan(plain)), ...pairs(store.scan(dups))];
    store.setVer("2.0.0");
    const failure = new Error("outer");
    assertStrictEquals(
      assertThrows(() =>
        store.transaction(() => {
          store.setVal(plain, b("a"), b("changed"));
          store.transaction(() => {
            store.delVal(plain, b("b"));
            store.setVal(plain, b("aa"), b("new"));
            store.delTop(dups);
            store.putIoSetVals(plain, b("io"), [b("x"), b("y")]);
          });
          store.setVer("3.0.0");
          throw failure;
        })
      ),
      failure,
    );
    assertEquals([...pairs(store.scan(plain)), ...pairs(store.scan(dups))], before);
    assertEquals(store.getVer(), "2.0.0");
    assertEquals(store.inWriteTransaction, false);
  });

  test("writeVersion grows on a row-writing outermost commit and is steady otherwise", (store) => {
    // Only what ADR-0015 promises. Creating a table, or rewriting an identical dupsort pair with setVal,
    // advances it on LMDB and not on MemStore, so neither is asserted.
    const plain = store.openTable("p.");
    const dups = store.openTable("d.", { dupsort: true });
    const advances = (fn: () => unknown): boolean => {
      const before = store.writeVersion;
      try {
        fn();
      } catch { /* a rollback is the point */ }
      return store.writeVersion > before;
    };
    assertEquals(advances(() => store.putVal(plain, b("k"), b("v"))), true);
    assertEquals(advances(() => store.putVal(plain, b("k"), b("w"))), false);
    assertEquals(advances(() => store.setVal(plain, b("k"), b("w"))), true);
    assertEquals(advances(() => store.delVal(plain, b("absent"))), false);
    assertEquals(advances(() => store.addVal(dups, b("k"), b("1"))), true);
    assertEquals(advances(() => store.addVal(dups, b("k"), b("1"))), false);
    assertEquals(advances(() => store.delVals(dups, b("k"))), true);
    assertEquals(advances(() => store.delVals(dups, b("k"))), false);
    assertEquals(advances(() => store.transaction(() => 1)), false, "an empty commit");
    assertEquals(advances(() => store.transaction(() => store.getVal(plain, b("k")))), false);
    assertEquals(
      advances(() =>
        store.transaction(() => {
          store.setVal(plain, b("r"), b("1"));
          throw new Error("rollback");
        })
      ),
      false,
    );

    const outer = store.writeVersion;
    store.transaction(() => {
      store.transaction(() => store.setVal(plain, b("n"), b("1")));
      store.setVal(plain, b("n2"), b("1"));
      assertEquals(store.writeVersion, outer, "nested work publishes only with the outermost commit");
    });
    assertEquals(store.writeVersion > outer, true);
  });

  test("a closed store refuses every operation with DatabaseNotOpenError", async (store) => {
    const { plain, dups } = seeded(store);
    await run(() => store.close());
    assertEquals(store.opened, false);
    const refusals: [string, () => unknown][] = [
      ["openTable", () => store.openTable("p.")],
      ["hasTable", () => store.hasTable("p.")],
      ["getVal", () => store.getVal(plain, b("a"))],
      ["putVal", () => store.putVal(plain, b("a"), b("v"))],
      ["setVal", () => store.setVal(plain, b("a"), b("v"))],
      ["delVal", () => store.delVal(plain, b("a"))],
      ["transaction", () => store.transaction(() => 1)],
      ["scan", () => [...store.scan(plain)]],
      ["scanKeys", () => [...store.scanKeys(plain)]],
      ["writeVersion", () => store.writeVersion],
      ["inWriteTransaction", () => store.inWriteTransaction],
      ["refreshRead", () => store.refreshRead()],
      ["getVer", () => store.getVer()],
      ["setVer", () => store.setVer("1")],
      ["cnt", () => store.cnt(plain)],
      ["cntTop", () => store.cntTop(plain)],
      ["delTop", () => store.delTop(plain)],
      ["getTopItemIter", () => [...store.getTopItemIter(plain)]],
      ["putVals", () => store.putVals(dups, b("a"), [b("1")])],
      ["addVal", () => store.addVal(dups, b("a"), b("1"))],
      ["getVals", () => store.getVals(dups, b("a"))],
      ["getValLast", () => store.getValLast(dups, b("a"))],
      ["getValsIter", () => [...store.getValsIter(dups, b("a"))]],
      ["cntVals", () => store.cntVals(dups, b("a"))],
      ["delVals", () => store.delVals(dups, b("a"))],
      ["seekVal", () => store.seekVal(dups, b("a"))],
      ["inherited family", () => store.addIoSetVal(plain, b("a"), b("1"))],
    ];
    for (const [label, refuse] of refusals) refuses(refuse, DatabaseNotOpenError, label);
    let flushError: unknown;
    await run(function*() {
      try {
        yield* store.flushed();
      } catch (error) {
        flushError = error;
      }
    });
    assertInstanceOf(flushError, DatabaseNotOpenError);
    assertEquals(await run(() => store.close()), true, "repeated close is harmless");
  });

  test("ordinal and IoSet families round-trip", (store) => {
    const ordered = store.openTable("on.");
    assertEquals(store.appendOnVal(ordered, b("k"), b("one")), 0);
    assertEquals(store.appendOnVal(ordered, b("k"), b("two")), 1);
    assertEquals(store.putOnVal(ordered, b("k"), 5, b("five")), true);
    assertEquals(t(store.getOnVal(ordered, b("k"), 1)!), "two");
    assertEquals(store.cntOnAll(ordered, b("k")), 3);
    assertEquals(store.remOn(ordered, b("k"), 1), true);
    assertEquals(store.remOnAll(ordered, b("k")), true);
    assertEquals(store.cnt(ordered), 0);

    const table = store.openTable("io.");
    assertEquals(store.putIoSetVals(table, b("k"), [b("z"), b("a"), b("z")]), true);
    assertEquals(store.putIoSetVals(table, b("k"), [b("a")]), false);
    assertEquals(store.addIoSetVal(table, b("k"), b("m")), true);
    assertEquals(store.addIoSetVal(table, b("k"), b("m")), false);
    assertEquals([...store.getIoSetItemIter(table, b("k"))].map(([, val]) => t(val)), ["z", "a", "m"]);
    assertEquals(t(store.getIoSetLastItem(table, b("k"))![1]), "m");
    assertEquals(store.remIoSetVal(table, b("k"), b("a")), true);
    assertEquals(store.cntIoSet(table, b("k")), 2);
    assertEquals(store.pinIoSetVals(table, b("k"), [b("q")]), true);
    assertEquals([...store.getIoSetItemIter(table, b("k"))].map(([, val]) => t(val)), ["q"]);
    assertEquals(store.remIoSet(table, b("k")), true);
    assertEquals(store.cntIoSet(table, b("k")), 0);
    refuses(() => store.putIoSetVals(table, bytes(MAX_KEY_BYTES + 1), [b("v")]), DatabaseKeyError, "IoSet key");
  });

  test("IoDup keeps insertion order behind a hidden 33-byte proem", (store) => {
    const dups = store.openTable("dups.", { dupsort: true });
    const rawOrdinals = () => store.getVals(dups, b("journal")).map((raw) => Number.parseInt(t(raw.slice(0, 32)), 16));
    assertEquals(store.putIoDupVals(dups, b("journal"), [b("zebra"), b("apple")]), true);
    assertEquals(store.putIoDupVals(dups, b("journal"), [b("apple"), b("moon")]), true);
    assertEquals(store.putIoDupVals(dups, b("journal"), [b("zebra"), b("apple"), b("moon")]), false);
    assertEquals(texts(store.getIoDupVals(dups, b("journal"))), ["zebra", "apple", "moon"]);
    assertEquals(texts(store.getIoDupValsIter(dups, b("journal"))), ["zebra", "apple", "moon"]);
    assertEquals(rawOrdinals(), [0, 1, 2]);
    assertEquals(store.getVals(dups, b("journal")).map((raw) => [raw.length, t(raw.slice(32, 33))]), [
      [38, "."],
      [38, "."],
      [37, "."],
    ]);
    assertEquals(t(store.getIoDupValLast(dups, b("journal"))!), "moon");

    assertEquals(store.delIoDupVal(dups, b("journal"), b("apple")), true);
    assertEquals(store.addIoDupVal(dups, b("journal"), b("berry")), true);
    assertEquals(texts(store.getIoDupVals(dups, b("journal"))), ["zebra", "moon", "berry"]);
    assertEquals(rawOrdinals(), [0, 2, 3], "ordinals only advance, so a deleted slot is never reused");
    assertEquals(store.cntIoDups(dups, b("journal")), 3);

    store.putIoDupVals(dups, b("branch.alpha"), [b("zebra"), b("apple")]);
    store.putIoDupVals(dups, b("branch.beta"), [b("moon")]);
    assertEquals(
      [...store.getTopIoDupItemIter(dups, b("branch."))].map(([key, val]) => `${t(key)}=${t(val)}`),
      ["branch.alpha=zebra", "branch.alpha=apple", "branch.beta=moon"],
    );
    assertEquals(store.delIoDupVals(dups, b("branch.beta")), true);
    assertEquals(store.delIoDupVals(dups, b("branch.beta")), false);

    assertEquals(store.putOnIoDupVals(dups, b("ledger"), 0, [b("debit"), b("credit")]), true);
    assertEquals(store.addOnIoDupVal(dups, b("ledger"), 0, b("credit")), false);
    assertEquals(store.appendOnIoDupVal(dups, b("ledger"), b("archived")), 1);
    assertEquals(texts(store.getOnIoDupVals(dups, b("ledger"), 0)), ["debit", "credit"]);
    assertEquals(texts(store.getOnIoDupLastValIter(dups, b("ledger"))), ["credit", "archived"]);
  });
}

class PersonRecord extends RawRecord<{ first: string; last: string }> {
  declare first: string;
  declare last: string;
  constructor(data = { first: "", last: "" }) {
    super({ ...data });
  }
}

/** Register the `Suber`/`Komer` wrapper contract for one backend; each case mirrors `subing` or `koming` tests. */
export function wrapperContract(open: OpenStore, backend: Backend): void {
  const test = (name: string, fn: (store: DBer) => void) =>
    Deno.test(`wrapper contract [${backend.name}]: ${name}`, () => withStore(open, fn));

  test("Suber uses its separator and branch iteration", (store) => {
    const suber = new Suber(store, { subkey: "names.", sep: "^" });
    assertEquals(suber.put(["", "alice"], "EPrefix"), true);
    assertEquals(suber.put("^alice", "other"), false);
    assertEquals(suber.get("^alice"), "EPrefix");
    assertEquals([...suber.getTopItemIter("")], [[["", "alice"], "EPrefix"]]);
    assertEquals(suber.rem(["", "alice"]), true);
    assertEquals(suber.cnt(), 0);
  });

  test("OnSuber appends and iterates ordinals", (store) => {
    const suber = new OnSuber(store, { subkey: "logs." });
    assertEquals(suber.putOn("evt", 0, "alpha"), true);
    assertEquals(suber.appendOn("evt", "beta"), 1);
    assertEquals(suber.putOn("other", 0, "gamma"), true);
    assertEquals([...suber.getTopItemIter("evt")], [[["evt"], 0, "alpha"], [["evt"], 1, "beta"]]);
    assertEquals([...suber.getAllIter("evt", 1)], ["beta"]);
    assertEquals(suber.getOnItem("evt", 1), [["evt"], 1, "beta"]);
  });

  test("BytesIoSetSuber deduplicates in insertion order, including distinct bytes that decode alike", (store) => {
    const bytesSet = new BytesIoSetSuber(store, { subkey: "bytes." });
    const first = new Uint8Array([0xff]);
    const second = new Uint8Array([0xfe]);
    assertEquals(bytesSet.put("group", [first, second, first.slice()]), true);
    assertEquals(bytesSet.add("group", second.slice()), false);
    assertEquals(bytesSet.get("group"), [first, second]);
    assertEquals(bytesSet.getLast("group"), second);
    assertEquals(bytesSet.rem("group", first.slice()), true);
    assertEquals(bytesSet.get("group"), [second]);
  });

  test("DupSuber and IoDupSuber order duplicates by value and by insertion", (store) => {
    const dups = new DupSuber<string>(store, { subkey: "dups." });
    assertEquals(dups.put("k", ["bravo", "alpha"]), true);
    assertEquals(dups.add("k", "bravo"), false);
    assertEquals(dups.get("k"), ["alpha", "bravo"]);
    assertEquals(dups.rem("k", "alpha"), true);
    const iodups = new IoDupSuber<string>(store, { subkey: "iodups." });
    assertEquals(iodups.put("k", ["bravo", "alpha"]), true);
    assertEquals(iodups.get("k"), ["bravo", "alpha"]);
    assertEquals(iodups.getLast("k"), "alpha");
  });

  test("OnIoDupSuber and OnIoSetSuber keep ordinals and members apart", (store) => {
    const dups = new OnIoDupSuber<string>(store, { subkey: "ondups." });
    assertEquals(dups.put("ledger", 0, ["red", "blue"]), true);
    assertEquals(dups.putOn("ledger", 1, ["green"]), true);
    assertEquals(dups.put("other", 0, ["side"]), true);
    assertEquals([...dups.getAllIter("ledger", 0)], ["red", "blue", "green"]);
    assertEquals(dups.remOn("ledger", 0, "red"), true);
    assertEquals(dups.getOn("ledger", 0), ["blue"]);

    const sets = new OnIoSetSuber<string>(store, { subkey: "onsets." });
    assertEquals(sets.put("group", 0, ["a", "b"]), true);
    assertEquals(sets.add("group", 0, "b"), false);
    assertEquals(sets.putOn("group", 1, ["x", "y"]), true);
    assertEquals(sets.append("group", ["tail"]), 2);
    assertEquals(sets.get("group", 0), ["a", "b"]);
    assertEquals([...sets.getAllBackIter("group", 2)], ["tail", "y", "x", "b", "a"]);
    assertEquals(sets.rem("group", 0, "b"), true);
    assertEquals(sets.remAll("group", 1), true);
    assertEquals([...sets.getOnTopItemIter("group")], [[["group"], 0, "a"]]);
  });

  test("Komer and DupKomer round-trip records and branches", (store) => {
    const people = new Komer<PersonRecord>(store, { subkey: "people.", recordClass: PersonRecord });
    const sue = { first: "Susan", last: "Black" };
    const kip = { first: "Kip", last: "Thorne" };
    assertEquals(people.put(["team", "alpha"], sue), true);
    assertEquals(people.put(["team", "alpha"], kip), false);
    assertEquals(people.getDict(["team", "alpha"]), sue);
    assertEquals(people.pin(["team", "alpha"], kip), true);
    assertEquals(people.pin(["team", "beta"], sue), true);
    assertEquals(people.pin(["other", "gamma"], sue), true);
    assertEquals([...people.getTopItemIter("team", { topive: true })].map(([keys, rec]) => [keys, rec.first]), [
      [["team", "alpha"], "Kip"],
      [["team", "beta"], "Susan"],
    ]);
    assertEquals(people.trim("team", { topive: true }), true);
    assertEquals(people.get(["team", "alpha"]), null);
    assertEquals(people.cnt(), 1);

    const dups = new DupKomer<PersonRecord>(store, { subkey: "dups.", recordClass: PersonRecord });
    assertEquals(dups.put("team", [kip, sue]), true);
    assertEquals(dups.add("team", kip), false);
    assertEquals(dups.get("team").map((rec) => rec.first), ["Kip", "Susan"]);
    assertEquals(dups.rem("team", kip), true);
    assertEquals(dups.getLast("team")?.first, "Susan");
    assertEquals(dups.rem("team"), true);
    assertEquals(dups.get("team"), []);
  });
}
