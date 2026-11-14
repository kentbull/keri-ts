import { b } from "cesr-ts";
import { assertEquals } from "jsr:@std/assert";
import { run } from "npm:effection@^3.6.0";
import { RegBaser } from "../../../src/acdc/regbasing.ts";
import { Baser } from "../../../src/db/basing.ts";
import type { DBer, StoreIdentity, Table } from "../../../src/db/core/dber.ts";
import { LmdbStoreOpener } from "../../../src/db/core/lmdb-opener.ts";
import { MemStoreOpener } from "../../../src/db/core/memstore.ts";
import { openOwner, type StoreFamily, type StoreOpener, type StoreOwner } from "../../../src/db/core/store-owner.ts";
import { Keeper } from "../../../src/db/keeping.ts";
import { Mailboxer } from "../../../src/db/mailbox/mailboxing.ts";
import { Noter } from "../../../src/db/noting.ts";
import { Reger } from "../../../src/db/reger.ts";

/** Every owner binds its tables through `StoreOwner.reopen`, so each must group them. */
const owners: [string, StoreFamily, (store: DBer) => StoreOwner][] = [
  ["Baser", Baser.Family, (store) => new Baser(store)],
  ["Keeper", Keeper.Family, (store) => new Keeper(store)],
  ["Reger", Reger.Family, (store) => new Reger(store)],
  ["Noter", Noter.Family, (store) => new Noter(store)],
  ["Mailboxer", Mailboxer.Family, (store) => new Mailboxer(store)],
  ["RegBaser", RegBaser.Family, (store) => new RegBaser(store)],
];

interface Opened {
  name: string;
  dupsort: boolean;
  table: Table;
  /** Index of the outermost `transaction` that was active, or null outside any. */
  txn: number | null;
}

/** Records every table binding, with the outermost transaction that held it, through the public store seam. */
function watch(store: DBer): Opened[] {
  const opened: Opened[] = [];
  let depth = 0, txns = 0, current: number | null = null;
  const transaction = store.transaction.bind(store);
  store.transaction = <T>(fn: () => T): T => {
    if (depth++ === 0) current = txns++;
    try {
      return transaction(fn);
    } finally {
      if (--depth === 0) current = null;
    }
  };
  const openTable = store.openTable.bind(store);
  store.openTable = (name, options) => {
    const table = openTable(name, options);
    opened.push({ name, dupsort: options?.dupsort ?? false, table, txn: current });
    return table;
  };
  return opened;
}

const backends: [string, () => StoreOpener][] = [
  ["MemStore", () => new MemStoreOpener()],
  ["LMDB", () => new LmdbStoreOpener()],
];

for (const [backend, makeOpener] of backends) {
  for (const [label, family, make] of owners) {
    Deno.test(`db/table-open-transaction - ${label} opens all tables in one write transaction (${backend})`, async () => {
      await run(function*() {
        const store = makeOpener().create(family, { name: crypto.randomUUID(), temp: true });
        const opened = watch(store);
        const owner = yield* openOwner(make(store), label);
        try {
          assertEquals(opened.length > 1, true, "owner binds several tables");
          assertEquals(
            opened.filter(({ txn }) => txn === null).map(({ name }) => name),
            [],
            "no table opens outside the transaction",
          );
          assertEquals(new Set(opened.map(({ txn }) => txn)).size, 1, "one transaction holds every table open");
        } finally {
          yield* owner.close(true);
        }
      });
    });
  }
}

for (const [label, family, make] of owners) {
  Deno.test(`db/table-open-transaction - ${label} keeps its tables and rows across close and reopen (LMDB)`, async () => {
    const headDirPath = Deno.makeTempDirSync({ prefix: "table-open-txn-" });
    const identity: StoreIdentity = { name: crypto.randomUUID() };
    const opener = new LmdbStoreOpener({ headDirPath });
    try {
      await run(function*() {
        const first = opener.create(family, identity);
        const created = watch(first);
        const owner = yield* openOwner(make(first), label, identity);
        for (const { table, dupsort, name } of created) {
          // Baser parses every `habs.` row when it reopens; a probe row would not be a hab record.
          if (name === "habs.") continue;
          if (dupsort) first.addVal(table, b("k"), b(`v-${name}`));
          else first.setVal(table, b("k"), b(`v-${name}`));
        }
        yield* owner.close();

        const second = opener.create(family, identity);
        const reopened = watch(second);
        const again = yield* openOwner(make(second), label, identity);
        try {
          assertEquals(reopened.map(({ name }) => name), created.map(({ name }) => name), "same tables");
          assertEquals(new Set(reopened.map(({ txn }) => txn)).size, 1, "reopen binds in one transaction too");
          assertEquals(reopened.some(({ txn }) => txn === null), false);
          for (const { name, table, dupsort } of reopened) {
            assertEquals(second.hasTable(name), true);
            if (name === "habs.") continue;
            const rows = dupsort ? second.getVals(table, b("k")) : [second.getVal(table, b("k"))];
            assertEquals(rows.map((row) => new TextDecoder().decode(row!)), [`v-${name}`], `row in ${name}`);
          }
        } finally {
          yield* again.close(true);
        }
      });
    } finally {
      Deno.removeSync(headDirPath, { recursive: true });
    }
  });
}
