import { b, t } from "cesr-ts";
import { assertEquals, assertInstanceOf, assertStrictEquals, assertThrows } from "jsr:@std/assert";
import { run } from "npm:effection@^3.6.0";
import { DatabaseKeyError, DatabaseNotOpenError, DatabaseOperationError } from "../../../../src/core/errors.ts";
import type { Table, TableEntry } from "../../../../src/db/core/dber.ts";
import { MemStore, MemStoreOpener } from "../../../../src/db/core/memstore.ts";

const MAX = 1978;
const bytes = (length: number) => new Uint8Array(length).fill(0x61);

async function open(options: ConstructorParameters<typeof MemStore>[0] = {}): Promise<MemStore> {
  const store = new MemStore(options);
  assertEquals(await run(() => store.reopen()), true);
  return store;
}

const pairs = (entries: Iterable<TableEntry>) => [...entries].map(({ key, value }) => `${t(key)}=${t(value)}`);
const keys = (rows: Iterable<Uint8Array>) => [...rows].map((row) => t(row));

/** Seed `a=1 a=2 a=3 b=1 b=2 c=1` in a dupsort table and `a b c` in a plain one. */
function seeded(store: MemStore): { dups: Table; plain: Table } {
  const dups = store.openTable("dups.", { dupsort: true });
  const plain = store.openTable("plain.");
  for (const [key, val] of [["a", "1"], ["a", "2"], ["a", "3"], ["b", "1"], ["b", "2"], ["c", "1"]]) {
    store.addVal(dups, b(key), b(val));
  }
  for (const key of ["a", "b", "c"]) {
    store.setVal(plain, b(key), b(`${key}v`));
  }
  return { dups, plain };
}

Deno.test("MemStore orders keys by unsigned bytes, including above 0x7f", async () => {
  const store = await open();
  const table = store.openTable("t.");
  for (const key of [[0xff], [0x80], [0x7f], [0x00], [0x7f, 0x00], [0xff, 0x01]]) {
    store.setVal(table, new Uint8Array(key), b("v"));
  }
  assertEquals(
    [...store.scan(table)].map((entry) => [...entry.key]),
    [[0x00], [0x7f], [0x7f, 0x00], [0x80], [0xff], [0xff, 0x01]],
  );
  assertEquals([...store.scanKeys(table, { reverse: true, limit: 1 })].map((key) => [...key]), [[0xff, 0x01]]);
});

Deno.test("MemStore orders duplicate values bytewise and identifies rows by pair", async () => {
  const store = await open();
  const dups = store.openTable("d.", { dupsort: true });
  for (const val of [[0xff], [0x10], [0x80], [0x10]]) {
    store.setVal(dups, b("k"), new Uint8Array(val));
  }
  assertEquals(store.getVals(dups, b("k")).map((val) => [...val]), [[0x10], [0x80], [0xff]]);
  assertEquals(store.cntVals(dups, b("k")), 3);
  assertEquals(store.cnt(dups), 3);
  assertEquals([...store.getVal(dups, b("k"))!], [0x10]);

  assertEquals(store.addVal(dups, b("k"), new Uint8Array([0x80])), false);
  assertEquals(store.putVal(dups, b("k"), b("other")), false);
  assertEquals(store.putVals(dups, b("k"), [new Uint8Array([0x80]), new Uint8Array([0x90])]), false);
  assertEquals(store.cntVals(dups, b("k")), 4);
  assertEquals(store.delVal(dups, b("k"), new Uint8Array([0x90])), true);
  assertEquals(store.delVal(dups, b("k"), new Uint8Array([0x90])), false);
  assertEquals(store.delVal(dups, b("k")), true);
  assertEquals(store.cnt(dups), 0);
});

Deno.test("MemStore seekVal finds the first duplicate not below a value within one key", async () => {
  const store = await open();
  const { dups, plain } = seeded(store);
  assertEquals(t(store.seekVal(dups, b("a"))!), "1");
  assertEquals(t(store.seekVal(dups, b("a"), b("15"))!), "2");
  assertEquals(t(store.seekVal(dups, b("a"), new Uint8Array(0))!), "1");
  assertEquals(store.seekVal(dups, b("a"), b("4")), null);
  assertEquals(store.seekVal(dups, b("absent")), null);
  assertEquals(store.seekVal(dups, new Uint8Array(0)), null);
  assertEquals(store.seekVal(dups, bytes(MAX + 1)), null);
  assertEquals(t(store.seekVal(plain, b("a"))!), "av");
  assertThrows(() => store.seekVal(plain, b("a"), b("x")), DatabaseOperationError);
  assertThrows(() => store.cntVals(plain, b("a")), DatabaseOperationError);
  assertEquals(store.cntVals(plain, b("absent")), 0);
});

const scanCases: [string, Parameters<MemStore["scan"]>[1], string, string][] = [
  ["all", {}, "a1 a2 a3 b1 b2 c1", "a b c"],
  ["reverse", { reverse: true }, "c1 b2 b1 a3 a2 a1", "c b a"],
  ["start", { start: b("b") }, "b1 b2 c1", "b c"],
  ["exclusive start skips the key", { start: b("b"), exclusiveStart: true }, "c1", "c"],
  ["reverse start", { start: b("b"), reverse: true }, "b2 b1 a3 a2 a1", "b a"],
  ["reverse exclusive", { start: b("b"), reverse: true, exclusiveStart: true }, "a3 a2 a1", "a"],
  ["absent start", { start: b("bb") }, "c1", "c"],
  ["absent start exclusive", { start: b("bb"), exclusiveStart: true }, "c1", "c"],
  ["reverse absent start", { start: b("bb"), reverse: true }, "b2 b1 a3 a2 a1", "b a"],
  ["reverse absent exclusive", { start: b("bb"), reverse: true, exclusiveStart: true }, "b2 b1 a3 a2 a1", "b a"],
  ["reverse past end", { start: b("z"), reverse: true }, "c1 b2 b1 a3 a2 a1", "c b a"],
  ["reverse before first", { start: b("0"), reverse: true }, "", ""],
  ["end exclusive", { start: b("a"), end: b("b") }, "a1 a2 a3", "a"],
  ["reverse end exclusive", { start: b("c"), end: b("a"), reverse: true }, "c1 b2 b1", "c b"],
  ["limit counts rows or keys", { limit: 2 }, "a1 a2", "a b"],
  ["reverse limit", { reverse: true, limit: 2 }, "c1 b2", "c b"],
  ["zero limit", { limit: 0 }, "", ""],
  ["negative limit", { limit: -1 }, "", ""],
  ["limit with exclusive", { start: b("a"), exclusiveStart: true, limit: 1 }, "b1", "b"],
  ["empty start is absent", { start: new Uint8Array(0), exclusiveStart: true }, "a1 a2 a3 b1 b2 c1", "a b c"],
  ["empty end is absent", { end: new Uint8Array(0) }, "a1 a2 a3 b1 b2 c1", "a b c"],
  ["empty reverse start is absent", { start: new Uint8Array(0), reverse: true }, "c1 b2 b1 a3 a2 a1", "c b a"],
  ["inverted forward range", { start: b("c"), end: b("a") }, "", ""],
  ["inverted reverse range", { start: b("a"), end: b("c"), reverse: true }, "", ""],
];

for (const [label, options, expectedEntries, expectedKeys] of scanCases) {
  Deno.test(`MemStore dupsort scan and scanKeys: ${label}`, async () => {
    const store = await open();
    const { dups } = seeded(store);
    assertEquals(
      [...store.scan(dups, options)].map(({ key, value }) => `${t(key)}${t(value)}`).join(" "),
      expectedEntries,
    );
    assertEquals(keys(store.scanKeys(dups, options)).join(" "), expectedKeys);
  });
}

Deno.test("MemStore scan bounds are not validated and compare as bytes", async () => {
  const store = await open();
  const { plain } = seeded(store);
  assertEquals(keys(store.scanKeys(plain, { start: bytes(3000) })), ["b", "c"]);
  assertEquals(keys(store.scanKeys(plain, { start: bytes(3000), reverse: true })), ["a"]);
});

Deno.test("MemStore refuses and absorbs out-of-range keys and values as the contract says", async () => {
  const store = await open();
  const plain = store.openTable("p.");
  const dups = store.openTable("d.", { dupsort: true });
  const empty = new Uint8Array(0);
  const long = bytes(MAX + 1);

  for (const key of [empty, long]) {
    assertThrows(() => store.putVal(plain, key, b("v")), DatabaseKeyError);
    assertThrows(() => store.setVal(plain, key, b("v")), DatabaseKeyError);
    assertThrows(() => store.putVals(dups, key, [b("v")]), DatabaseKeyError);
    assertThrows(() => store.addVal(dups, key, b("v")), DatabaseKeyError);
    assertThrows(() => store.putIoDupVals(dups, key, [b("v")]), DatabaseKeyError);
  }
  assertThrows(() => store.putIoSetVals(plain, long, [b("v")]), DatabaseKeyError);
  assertEquals(store.putIoSetVals(plain, empty, [b("v")]), false, "the family's own guard answers first");
  assertEquals(store.putVal(plain, bytes(MAX), b("v")), true);
  assertEquals(t(store.getVal(plain, bytes(MAX))!), "v");
  assertEquals(store.delVal(plain, bytes(MAX)), true);

  assertThrows(() => store.getVal(plain, empty), DatabaseKeyError);
  assertThrows(() => store.delVal(plain, empty), DatabaseKeyError);
  assertThrows(() => store.delVal(dups, empty, b("v")), DatabaseKeyError);
  assertThrows(() => store.delVals(dups, empty), DatabaseKeyError);
  assertEquals(store.getVal(plain, long), null);
  assertEquals(store.delVal(plain, long), false);
  assertEquals(store.delVal(dups, long, b("v")), false);
  assertEquals(store.delVals(dups, long), false);
  for (const key of [empty, long]) {
    assertEquals(store.getVals(dups, key), []);
    assertEquals(store.getValLast(dups, key), null);
    assertEquals([...store.getValsIter(dups, key)], []);
    assertEquals(store.cntVals(dups, key), 0);
  }

  assertEquals(store.setVal(dups, b("big"), bytes(MAX)), true);
  assertThrows(() => store.setVal(dups, b("big"), long), DatabaseKeyError);
  assertThrows(() => store.addVal(dups, b("big2"), long), DatabaseKeyError);
  assertThrows(() => store.putVal(dups, b("big2"), long), DatabaseKeyError);
  assertThrows(() => store.delVal(dups, b("big"), long), DatabaseKeyError);
  assertEquals(store.putVal(dups, b("big"), long), false, "an existing key is reported before the value is checked");
  assertEquals(store.setVal(plain, b("big"), bytes(5000)), true, "only dupsort values are limited");

  assertEquals(store.putVal(plain, b("e"), empty), true);
  assertEquals(store.getVal(plain, b("e")), empty);
  assertEquals(store.putVal(plain, b("e"), b("x")), false);
  assertEquals(store.addVal(dups, b("e"), null), true);
  assertEquals(store.addVal(dups, b("e"), b("a")), true);
  assertEquals(keys(store.getVals(dups, b("e"))), ["", "a"]);
  assertEquals(store.delVal(dups, b("e"), empty), true);
  assertEquals(keys(store.getVals(dups, b("e"))), ["a"]);
});

Deno.test("MemStore copies bytes on the way in and on the way out", async () => {
  const store = await open();
  const plain = store.openTable("p.");
  const dups = store.openTable("d.", { dupsort: true });

  const key = b("key");
  const val = b("val");
  store.setVal(plain, key, val);
  key[0] = 0x7a;
  val[0] = 0x7a;
  assertEquals(t(store.getVal(plain, b("key"))!), "val");

  const read = store.getVal(plain, b("key"))!;
  read[0] = 0x7a;
  assertEquals(t(store.getVal(plain, b("key"))!), "val");

  for (const entry of store.scan(plain)) {
    entry.key[0] = 0x7a;
    entry.value[0] = 0x7a;
  }
  for (const scanned of store.scanKeys(plain)) {
    scanned[0] = 0x7a;
  }
  for (const [itemKey, itemVal] of store.getTopItemIter(plain)) {
    itemKey[0] = 0x7a;
    itemVal[0] = 0x7a;
  }
  assertEquals(pairs(store.scan(plain)), ["key=val"]);

  const dup = b("dup");
  store.addVal(dups, b("k"), dup);
  dup[0] = 0x7a;
  const [first] = store.getVals(dups, b("k"));
  first[0] = 0x7a;
  store.getValLast(dups, b("k"))![0] = 0x7a;
  store.seekVal(dups, b("k"))![0] = 0x7a;
  for (const value of store.getValsIter(dups, b("k"))) {
    value[0] = 0x7a;
  }
  assertEquals(keys(store.getVals(dups, b("k"))), ["dup"]);
  assertStrictEquals(store.getVal(dups, b("k")) === store.getVal(dups, b("k")), false);
});

Deno.test("MemStore nested rollback undoes only the savepoint and leaves the outer open", async () => {
  const store = await open();
  const { plain, dups } = seeded(store);
  const inner = new Error("inner");
  store.transaction(() => {
    store.setVal(plain, b("outer"), b("1"));
    let caught: unknown;
    try {
      store.transaction(() => {
        assertEquals(store.inWriteTransaction, true);
        store.setVal(plain, b("inner"), b("1"));
        store.setVal(plain, b("a"), b("changed"));
        store.delVal(plain, b("b"));
        store.addVal(dups, b("a"), b("9"));
        store.delVals(dups, b("b"));
        store.delTop(dups, b("c"));
        throw inner;
      });
    } catch (error) {
      caught = error;
    }
    assertStrictEquals(caught, inner);
    assertEquals(store.inWriteTransaction, true);
    assertEquals(store.getVal(plain, b("inner")), null);
    assertEquals(t(store.getVal(plain, b("a"))!), "av");
    assertEquals(t(store.getVal(plain, b("b"))!), "bv");
    assertEquals(t(store.getVal(plain, b("outer"))!), "1");
    assertEquals(pairs(store.scan(dups)), ["a=1", "a=2", "a=3", "b=1", "b=2", "c=1"]);
    store.setVal(plain, b("outer2"), b("1"));
  });
  assertEquals(store.inWriteTransaction, false);
  assertEquals(keys(store.scanKeys(plain)), ["a", "b", "c", "outer", "outer2"]);
});

Deno.test("MemStore outer rollback restores every row exactly, including committed nested work", async () => {
  const store = await open();
  const { plain, dups } = seeded(store);
  const before = [...pairs(store.scan(plain)), ...pairs(store.scan(dups))];
  store.setVer("2.0.0");
  const failure = new Error("outer");
  const thrown = assertThrows(() =>
    store.transaction(() => {
      store.setVal(plain, b("a"), b("changed"));
      store.transaction(() => {
        store.delVal(plain, b("b"));
        store.setVal(plain, b("aa"), b("new"));
        store.delTop(dups);
        store.putIoSetVals(plain, b("io"), [b("x"), b("y")]);
      });
      store.setVer("3.0.0");
      store.openTable("created-then-lost.");
      throw failure;
    })
  );
  assertStrictEquals(thrown, failure);
  assertEquals([...pairs(store.scan(plain)), ...pairs(store.scan(dups))], before);
  assertEquals(store.getVer(), "2.0.0");
  assertEquals(store.hasTable("created-then-lost."), false);
  assertEquals(store.inWriteTransaction, false);
});

Deno.test("MemStore rollback is exact across randomized nested writes", async () => {
  const store = await open();
  const { dups, plain } = seeded(store);
  let seed = 0x2f6e2b1;
  const random = (limit: number) => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed % limit;
  };
  const alphabet = "abcd";
  const anyKey = () => b(alphabet[random(4)] + (random(2) ? alphabet[random(4)] : ""));
  const snapshot = () => [...pairs(store.scan(plain)), "|", ...pairs(store.scan(dups))];
  const mutate = () => {
    for (let count = random(12); count > 0; count--) {
      const table = random(2) ? plain : dups;
      const key = anyKey();
      [
        () => store.setVal(table, key, anyKey()),
        () => store.putVal(table, key, anyKey()),
        () => store.delVal(table, key),
        () => store.delVal(table, key, anyKey()),
        () => store.delTop(table, b(alphabet[random(4)])),
        () => store.addVal(table, key, anyKey()),
      ][random(6)]();
    }
  };
  const abort = Symbol("abort");
  for (let round = 0; round < 200; round++) {
    const atStart = snapshot();
    try {
      store.transaction(() => {
        mutate();
        const beforeNested = snapshot();
        try {
          store.transaction(() => {
            mutate();
            throw abort;
          });
        } catch (error) {
          assertStrictEquals(error, abort);
        }
        assertEquals(snapshot(), beforeNested);
        mutate();
        throw abort;
      });
    } catch (error) {
      assertStrictEquals(error, abort);
    }
    assertEquals(snapshot(), atStart, `round ${round}`);
    if (round % 20 === 0) {
      store.transaction(mutate);
    }
  }
});

Deno.test("MemStore rejects a thenable result and rolls it back", async () => {
  const store = await open();
  const plain = store.openTable("p.");
  const version = store.writeVersion;
  assertThrows(
    () =>
      store.transaction(() => {
        store.setVal(plain, b("k"), b("v"));
        return Promise.resolve();
      }),
    DatabaseOperationError,
    "synchronous",
  );
  assertEquals(store.getVal(plain, b("k")), null);
  assertEquals(store.writeVersion, version);
  assertEquals(store.inWriteTransaction, false);
});

Deno.test("MemStore rolls back a throw and rethrows the original value, leaving failed primitives harmless", async () => {
  const store = await open();
  const plain = store.openTable("p.");
  assertEquals(
    assertThrows(() =>
      store.transaction(() => {
        throw "not an error";
      })
    ),
    "not an error",
  );
  assertEquals(store.inWriteTransaction, false);

  store.transaction(() => {
    store.setVal(plain, b("before"), b("1"));
    assertThrows(() => store.setVal(plain, bytes(MAX + 1), b("v")), DatabaseKeyError);
    store.setVal(plain, b("after"), b("1"));
  });
  assertEquals(keys(store.scanKeys(plain)), ["after", "before"]);
});

Deno.test("MemStore writeVersion advances only for an outermost commit that wrote rows", async () => {
  const store = await open();
  const plain = store.openTable("p.");
  const dups = store.openTable("d.", { dupsort: true });
  const advances = (fn: () => unknown): boolean => {
    const before = store.writeVersion;
    fn();
    return store.writeVersion > before;
  };
  const rollback = (fn: () => void) => {
    try {
      store.transaction(() => {
        fn();
        throw new Error("rollback");
      });
    } catch { /* expected */ }
  };

  assertEquals(advances(() => store.putVal(plain, b("k"), b("v"))), true);
  assertEquals(advances(() => store.putVal(plain, b("k"), b("w"))), false);
  assertEquals(advances(() => store.setVal(plain, b("k"), b("v"))), true);
  assertEquals(advances(() => store.delVal(plain, b("absent"))), false);
  assertEquals(advances(() => store.delVal(plain, b("k"))), true);
  assertEquals(advances(() => store.addVal(dups, b("k"), b("1"))), true);
  assertEquals(advances(() => store.addVal(dups, b("k"), b("1"))), false);
  assertEquals(advances(() => store.setVal(dups, b("k"), b("1"))), false);
  assertEquals(advances(() => store.delVals(dups, b("k"))), true);
  assertEquals(advances(() => store.delVals(dups, b("k"))), false);
  assertEquals(advances(() => store.delTop(plain, b("zz"))), false);
  assertEquals(advances(() => store.setVer("9")), true);
  assertEquals(advances(() => store.transaction(() => 1)), false);
  assertEquals(advances(() => store.transaction(() => store.getVal(plain, b("k")))), false);
  assertEquals(advances(() => store.transaction(() => store.putVal(plain, b("absent-noop"), b("v")))), true);
  assertEquals(advances(() => store.transaction(() => store.putVal(plain, b("absent-noop"), b("v")))), false);
  assertEquals(advances(() => store.openTable("new.")), false);
  assertEquals(advances(() => store.transaction(() => store.openTable("new2."))), false);
  assertEquals(advances(() => rollback(() => store.setVal(plain, b("r"), b("1")))), false);

  assertEquals(
    advances(() =>
      store.transaction(() => {
        try {
          store.transaction(() => {
            store.setVal(plain, b("r"), b("1"));
            throw new Error("inner");
          });
        } catch { /* expected */ }
      })
    ),
    false,
    "a nested rollback that leaves nothing is an empty commit",
  );

  const outer = store.writeVersion;
  store.transaction(() => {
    store.transaction(() => store.setVal(plain, b("n"), b("1")));
    assertEquals(store.writeVersion, outer, "nested commits do not publish");
    store.setVal(plain, b("n2"), b("1"));
    assertEquals(store.writeVersion, outer);
  });
  assertEquals(store.writeVersion, outer + 1, "one outermost commit publishes once");
  assertEquals(
    advances(() =>
      store.transaction(() => {
        store.setVal(plain, b("t"), b("1"));
        store.delVal(plain, b("t"));
      })
    ),
    true,
  );
});

Deno.test("MemStore scans keep their position while rows change", async () => {
  const store = await open();
  const plain = store.openTable("p.");
  const dups = store.openTable("d.", { dupsort: true });
  const refill = () => {
    store.delTop(plain);
    for (const key of "abcde") store.setVal(plain, b(key), b(key));
  };

  refill();
  const forward: string[] = [];
  for (const entry of store.scan(plain)) {
    forward.push(t(entry.key));
    if (t(entry.key) === "b") {
      store.delVal(plain, b("b"));
      store.delVal(plain, b("d"));
      store.setVal(plain, b("cc"), b("x"));
      store.setVal(plain, b("a0"), b("behind"));
    }
  }
  assertEquals(forward, ["a", "b", "c", "cc", "e"]);

  refill();
  const reverse = store.transaction(() => {
    const seen: string[] = [];
    for (const key of store.scanKeys(plain, { reverse: true })) {
      seen.push(t(key));
      if (t(key) === "d") {
        store.delVal(plain, b("d"));
        store.delVal(plain, b("b"));
        store.setVal(plain, b("bb"), b("x"));
      }
    }
    return seen;
  });
  assertEquals(reverse, ["e", "d", "c", "bb", "a"]);

  for (const [key, val] of [["a", "1"], ["a", "2"], ["a", "3"], ["b", "1"]]) store.addVal(dups, b(key), b(val));
  const entries: string[] = [];
  for (const entry of store.scan(dups)) {
    entries.push(`${t(entry.key)}${t(entry.value)}`);
    if (entries.length === 2) {
      store.delVal(dups, b("a"), b("2"));
      store.addVal(dups, b("a"), b("0"));
    }
  }
  assertEquals(entries, ["a1", "a2", "a3", "b1"]);

  const iterator = store.scan(plain)[Symbol.iterator]();
  iterator.next();
  try {
    store.transaction(() => {
      store.delTop(plain, b("b"));
      throw new Error("rollback");
    });
  } catch { /* expected */ }
  const rest: string[] = [];
  for (let step = iterator.next(); !step.done; step = iterator.next()) {
    rest.push(t(step.value.key));
  }
  assertEquals(rest, ["bb", "c", "e"], "the iterator resumes after a rollback without skipping or repeating");
});

Deno.test("MemStore tables need no declaration and fix dupsort at creation", async () => {
  const store = await open();
  assertEquals(store.hasTable("t."), false, "hasTable never creates");
  assertEquals(store.hasTable("t."), false);
  const table = store.openTable("t.", { dupsort: true });
  assertEquals(store.hasTable("t."), true);
  assertStrictEquals(store.openTable("t."), table);
  store.setVal(table, b("k"), b("1"));
  store.setVal(store.openTable("t."), b("k"), b("2"));
  assertEquals(keys(store.getVals(table, b("k"))), ["1", "2"]);
  assertThrows(() => store.openTable(""), DatabaseKeyError);
  assertThrows(() => store.hasTable(""), DatabaseKeyError);

  assertEquals(store.getVer(), "1.0.0");
  assertEquals(t(store.getVal(table, b("k"))!), "1");
});

Deno.test("MemStore refuses a table created in a rolled-back transaction until it is opened again", async () => {
  const store = await open();
  let lost: Table | undefined;
  try {
    store.transaction(() => {
      lost = store.openTable("lost.");
      store.setVal(lost, b("k"), b("v"));
      throw new Error("rollback");
    });
  } catch { /* expected */ }
  assertEquals(store.hasTable("lost."), false);
  assertThrows(() => store.getVal(lost!, b("k")), DatabaseOperationError);
  const fresh = store.openTable("lost.");
  assertEquals(store.getVal(fresh, b("k")), null);
});

Deno.test("MemStore round-trips the inherited IoSet family", async () => {
  const store = await open();
  const table = store.openTable("io.");
  assertEquals(store.putIoSetVals(table, b("k"), [b("z"), b("a"), b("z")]), true);
  assertEquals(store.putIoSetVals(table, b("k"), [b("a")]), false);
  assertEquals(store.addIoSetVal(table, b("k"), b("m")), true);
  assertEquals(store.addIoSetVal(table, b("k"), b("m")), false);
  assertEquals([...store.getIoSetItemIter(table, b("k"))].map(([, val]) => t(val)), ["z", "a", "m"]);
  assertEquals(t(store.getIoSetLastItem(table, b("k"))![1]), "m");
  assertEquals(store.cntIoSet(table, b("k")), 3);
  assertEquals(store.remIoSetVal(table, b("k"), b("a")), true);
  assertEquals([...store.getIoSetItemIter(table, b("k"))].map(([, val]) => t(val)), ["z", "m"]);
  assertEquals(store.pinIoSetVals(table, b("k"), [b("q")]), true);
  assertEquals([...store.getIoSetItemIter(table, b("k"))].map(([, val]) => t(val)), ["q"]);
  assertEquals(store.remIoSet(table, b("k")), true);
  assertEquals(store.cntIoSet(table, b("k")), 0);
});

Deno.test("MemStore round-trips the inherited IoDup and ordinal families", async () => {
  const store = await open();
  const table = store.openTable("dup.", { dupsort: true });
  assertEquals(store.putIoDupVals(table, b("k"), [b("z"), b("a"), b("z")]), true);
  assertEquals(store.putIoDupVals(table, b("k"), [b("a")]), false);
  assertEquals(store.addIoDupVal(table, b("k"), b("m")), true);
  assertEquals(keys(store.getIoDupVals(table, b("k"))), ["z", "a", "m"], "insertion order, not value order");
  assertEquals(t(store.getIoDupValLast(table, b("k"))!), "m");
  assertEquals(store.cntIoDups(table, b("k")), 3);
  assertEquals(store.delIoDupVal(table, b("k"), b("a")), true);
  assertEquals(keys(store.getIoDupVals(table, b("k"))), ["z", "m"]);
  assertEquals(store.delIoDupVals(table, b("k")), true);

  const ordered = store.openTable("on.");
  assertEquals(store.appendOnVal(ordered, b("k"), b("one")), 0);
  assertEquals(store.appendOnVal(ordered, b("k"), b("two")), 1);
  assertEquals(t(store.getOnVal(ordered, b("k"), 1)!), "two");
  assertEquals(store.cntOnAll(ordered, b("k")), 2);
  assertEquals(store.remOnAll(ordered, b("k")), true);
  assertEquals(store.cnt(ordered), 0);
});

Deno.test("MemStore branch helpers follow key prefixes", async () => {
  const store = await open();
  const { dups, plain } = seeded(store);
  store.setVal(plain, b("ab"), b("abv"));
  store.setVal(plain, b("abc"), b("abcv"));
  assertEquals(store.cntTop(plain, b("ab")), 2);
  assertEquals(store.cntTop(plain), 5);
  assertEquals(store.cntAll(plain), 5);
  assertEquals([...store.getTopItemIter(plain, b("ab"))].map(([key, val]) => [t(key), t(val)]), [["ab", "abv"], [
    "abc",
    "abcv",
  ]]);
  assertEquals([...store.getTopItemIter(dups, b("b"))].length, 2);
  assertEquals(store.delTop(plain, b("ab")), true);
  assertEquals(store.delTop(plain, b("ab")), false);
  assertEquals(keys(store.scanKeys(plain)), ["a", "b", "c"]);
  assertEquals(store.delTop(dups), true);
  assertEquals(store.cnt(dups), 0);
});

Deno.test("MemStore refuses a closed store with DatabaseNotOpenError", async () => {
  const store = await open();
  const { plain, dups } = seeded(store);
  const iterator = store.scan(plain)[Symbol.iterator]();
  iterator.next();
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
    ["open scan", () => iterator.next()],
    ["writeVersion", () => store.writeVersion],
    ["inWriteTransaction", () => store.inWriteTransaction],
    ["refreshRead", () => store.refreshRead()],
    ["getVer", () => store.getVer()],
    ["setVer", () => store.setVer("1")],
    ["cnt", () => store.cnt(plain)],
    ["cntAll", () => store.cntAll(plain)],
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
  for (const [label, refuse] of refusals) {
    assertInstanceOf(assertThrows(refuse, label), DatabaseNotOpenError, label);
  }
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

Deno.test("MemStore keeps contents across close and reopen on one instance until cleared", async () => {
  const store = await open({ name: "n", base: "b" });
  assertEquals([store.name, store.base, store.temp, store.readonly], ["n", "b", false, false]);
  const stale = store.openTable("t.");
  store.setVal(stale, b("k"), b("v"));
  store.setVer("7.7.7");
  await run(function*() {
    yield* store.flushed();
  });

  await run(() => store.close());
  assertEquals(await run(() => store.reopen()), true);
  assertThrows(() => store.getVal(stale, b("k")), DatabaseOperationError, "not valid");
  const rebound = store.openTable("t.");
  assertEquals(t(store.getVal(rebound, b("k"))!), "v");
  assertEquals(store.getVer(), "7.7.7");
  assertEquals(store.hasTable("t."), true);
  assertEquals(store.inWriteTransaction, false);

  await run(() => store.close(true));
  assertEquals(await run(() => store.reopen()), true);
  assertEquals(store.hasTable("t."), false);
  assertEquals(store.getVer(), "1.0.0");

  store.setVal(store.openTable("again."), b("k"), b("v"));
  assertEquals(await run(() => store.reopen({ clear: true })), true);
  assertEquals(store.hasTable("again."), false);
  assertEquals(store.getVer(), "1.0.0");
});

Deno.test("MemStore temp stores follow the same close rule and restamp their version", async () => {
  const store = await open({ temp: true });
  assertEquals(store.temp, true);
  store.setVal(store.openTable("t."), b("k"), b("v"));
  store.setVer("7.7.7");
  await run(() => store.close());
  assertEquals(await run(() => store.reopen()), true);
  assertEquals(t(store.getVal(store.openTable("t."), b("k"))!), "v");
  assertEquals(store.getVer(), "1.0.0");
  await run(() => store.close(true));
  assertEquals(await run(() => store.reopen()), true);
  assertEquals(store.hasTable("t."), false);
});

Deno.test("MemStore readonly refuses writes, serves reads, and cannot create tables", async () => {
  const store = await open();
  const table = store.openTable("t.");
  const dups = store.openTable("d.", { dupsort: true });
  store.setVal(table, b("k"), b("v"));
  store.addVal(dups, b("k"), b("1"));
  await run(() => store.close());
  assertEquals(await run(() => store.reopen({ readonly: true })), true);
  assertEquals(store.readonly, true);

  const reader = store.openTable("t.");
  const dupsReader = store.openTable("d.");
  assertEquals(t(store.getVal(reader, b("k"))!), "v");
  assertEquals(keys(store.getVals(dupsReader, b("k"))), ["1"]);
  assertEquals(store.getVer(), "1.0.0");
  assertEquals(store.hasTable("absent."), false);
  assertEquals(store.openTable("absent.") === undefined, true, "an absent table yields no usable handle");
  assertThrows(() => store.getVal(undefined as unknown as Table, b("k")), DatabaseOperationError);
  assertEquals(store.hasTable("absent."), false);

  for (
    const write of [
      () => store.setVal(reader, b("k"), b("x")),
      () => store.putVal(reader, b("z"), b("x")),
      () => store.delVal(reader, b("k")),
      () => store.addVal(dupsReader, b("k"), b("2")),
      () => store.delVals(dupsReader, b("k")),
      () => store.delTop(reader),
      () => store.setVer("9"),
      () => store.transaction(() => 1),
    ]
  ) {
    assertThrows(write, DatabaseOperationError, "read-only");
  }
  assertEquals(store.delTop(reader, b("zzz")), false, "nothing to delete means no write was attempted");
  assertEquals(store.inWriteTransaction, false);

  await run(() => store.close());
  assertEquals(await run(() => store.reopen({ readonly: false })), true);
  assertEquals(store.readonly, false);
  store.setVal(store.openTable("t."), b("k"), b("x"));
});

Deno.test("MemStore readonly open of never-created contents fails like a missing database", async () => {
  const store = new MemStore({ readonly: true });
  assertEquals(await run(() => store.reopen()), false);
  assertEquals(store.opened, false);
  assertThrows(() => store.hasTable("t."), DatabaseNotOpenError);
});

Deno.test("MemStoreOpener creates closed, independent stores", async () => {
  const opener = new MemStoreOpener();
  const first = opener.create({ tail: "db" }, { name: "shared" });
  const second = opener.create({ tail: "db" }, { name: "shared" });
  assertEquals(first.opened, false);
  await run(() => first.reopen());
  await run(() => second.reopen());
  first.setVal(first.openTable("t."), b("k"), b("v"));
  assertEquals(second.hasTable("t."), false);
});
