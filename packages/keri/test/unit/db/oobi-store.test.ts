import { call, run } from "effection";
import { assert, assertEquals, assertRejects, assertThrows } from "jsr:@std/assert";
import { b, t } from "../../../../cesr/mod.ts";
import { OobiRecord } from "../../../src/core/records.ts";
import { baserDefaults } from "../../../src/db/baser-defaults.ts";
import { LMDBer } from "../../../src/db/core/lmdber.ts";
import { PathManager } from "../../../src/db/core/path-manager.ts";
import { Komer } from "../../../src/db/koming.ts";
import { type OobiStore, openOobiStore } from "../../../src/db/oobi-store.ts";

const selected = "https://example.test/oobi/A%2fb?role=controller";
const retained = " https://example.test/oobi/A%2Fb?role=controller ";
const record = new OobiRecord({ date: "2026-10-20T00:00:00.000000+00:00" });

/** Build a small existing layout without unrelated Baser startup effects. */
async function seed(headDirPath: string, name: string, pending = true): Promise<string> {
  return await run(function*() {
    const db = new LMDBer({ headDirPath, name }, baserDefaults());
    yield* db.reopen();
    try {
      db.setVer("python-layout-marker");
      for (const subkey of ["woobi.", "coobi.", "roobi.", ...(pending ? ["oobis."] : [])]) {
        const rows = new Komer(db, { subkey, recordClass: OobiRecord });
        rows.pin(selected, record);
        rows.pin(retained, record);
      }
      return db.path!;
    } finally {
      yield* db.close();
    }
  });
}

/** Read exact rows and root metadata through a single non-creating owner. */
async function snapshot(path: string): Promise<[string, string][]> {
  return await run(function*() {
    const db = new LMDBer({ readonly: true });
    yield* db.openExisting(path);
    try {
      const rows: [string, string][] = [];
      for (const { key, value } of db.env!.getRange()) {
        assert(key instanceof Uint8Array);
        const name = t(key);
        // Deleting a pending row legitimately changes this table's page/count
        // descriptor. All other root metadata must remain byte-for-byte equal.
        rows.push([name, name === "oobis." ? "<pending table>" : t(value)]);
      }
      for (const name of ["oobis.", "woobi.", "coobi.", "roobi."]) {
        if (db.env!.getBinary(b(name)) === undefined) continue;
        for (const { key, value } of db.openDB(name).getRange()) {
          rows.push([`${name}:${t(key)}`, t(value)]);
        }
      }
      return rows;
    } finally {
      yield* db.close();
    }
  });
}

Deno.test("db/oobi-store - missing target or table fails without creation or version initialization", async () => {
  const headDirPath = await Deno.makeTempDir();
  try {
    for (const readonly of [true, false]) {
      await assertRejects(
        () =>
          run(function*() {
            yield* openOobiStore({ headDirPath, name: "missing", readonly });
          }),
        Error,
        "existing directory",
      );
    }
    assertEquals([...Deno.readDirSync(headDirPath)], []);

    const emptyPath = `${headDirPath}/keri/db/empty`;
    await Deno.mkdir(emptyPath, { recursive: true });
    await assertRejects(
      () =>
        run(function*() {
          yield* openOobiStore({ headDirPath, name: "empty", readonly: false });
        }),
      Error,
      "Existing database not found",
    );
    assertEquals([...Deno.readDirSync(emptyPath)], []);

    const path = await seed(headDirPath, "no-pending-table", false);
    const before = await snapshot(path);
    const bytes = await Deno.readFile(`${path}/data.mdb`);
    for (const readonly of [true, false]) {
      await assertRejects(
        () =>
          run(function*() {
            yield* openOobiStore({ headDirPath, name: "no-pending-table", readonly });
          }),
        Error,
        "Database not found",
      );
      assertEquals(await snapshot(path), before);
      assertEquals(await Deno.readFile(`${path}/data.mdb`), bytes);
    }
  } finally {
    await Deno.remove(headDirPath, { recursive: true });
  }
});

Deno.test("db/oobi-store - preview cannot write and apply removes only exact pending keys", async () => {
  const headDirPath = await Deno.makeTempDir();
  try {
    const path = await seed(headDirPath, "pending.test");
    const before = await snapshot(path);
    const bytes = await Deno.readFile(`${path}/data.mdb`);
    let closed: OobiStore | undefined;
    await run(function*() {
      const store = yield* openOobiStore({ headDirPath, name: "pending.test" });
      closed = store;
      assertEquals(store.path, path);
      assertEquals(store.get(selected)?.asDict(), record.asDict());
      assertEquals(store.get("https://example.test/oobi/A%2Fb?role=controller"), null);
      assertThrows(() => store.rem(selected));
    });
    assertThrows(() => closed!.get(selected));
    assertEquals(await snapshot(path), before);
    assertEquals(await Deno.readFile(`${path}/data.mdb`), bytes);

    await run(function*() {
      const store = yield* openOobiStore({ headDirPath, name: "pending.test", readonly: false });
      assertEquals(store.rem(selected), true);
      assertEquals(store.rem(selected), false);
      assertEquals(store.get(selected), null);
      assertEquals(store.get(retained)?.asDict(), record.asDict());
    });
    assertEquals(await snapshot(path), before.filter(([key]) => key !== `oobis.:${selected}`));
    assertEquals([...Deno.readDirSync(headDirPath)].map((entry) => entry.name), ["keri"]);
    assertEquals([...Deno.readDirSync(path)].map((entry) => entry.name).sort(), ["data.mdb", "lock.mdb"]);
  } finally {
    await Deno.remove(headDirPath, { recursive: true });
  }
});

Deno.test("db/oobi-store - existing root stays unstamped and cannot gain tables or be cleared", async () => {
  const headDirPath = await Deno.makeTempDir();
  try {
    const path = await seed(headDirPath, "unstamped");
    await run(function*() {
      const db = new LMDBer();
      yield* db.openExisting(path);
      db.env!.removeSync(b("__version__"));
      yield* db.close();
    });
    await run(function*() {
      const store = yield* openOobiStore({ headDirPath, name: "unstamped", readonly: false });
      assert(store.get(selected));
    });
    await run(function*() {
      const db = new LMDBer();
      yield* db.openExisting(path);
      try {
        assertEquals(db.getVer(), null);
        assertThrows(() => db.openDB("new-table."), Error, "Database not found");
        yield* call(() => assertRejects(() => run(() => db.close(true)), Error, "cannot clear"));
      } finally {
        yield* db.close();
      }
    });
    assert((await Deno.stat(`${path}/data.mdb`)).isFile);
  } finally {
    await Deno.remove(headDirPath, { recursive: true });
  }
});

Deno.test("db/oobi-store - conventional home layouts work but explicit heads never fall back", async () => {
  const home = await Deno.makeTempDir();
  const previous = Deno.env.get("HOME");
  Deno.env.set("HOME", home);
  try {
    for (const compat of [false, true]) {
      const name = crypto.randomUUID();
      const tailDirPath = compat ? ".keri/db" : ".tufa/db";
      const path = await run(function*() {
        const db = new LMDBer({ headDirPath: home, name }, { tailDirPath });
        yield* db.reopen();
        try {
          new Komer(db, { subkey: "oobis.", recordClass: OobiRecord }).pin(selected, record);
          return db.path!;
        } finally {
          yield* db.close();
        }
      });
      await run(function*() {
        assertEquals((yield* openOobiStore({ name, compat })).path, path);
      });
      await assertRejects(
        () =>
          run(function*() {
            yield* openOobiStore({ name, compat, headDirPath: `${home}/missing` });
          }),
        Error,
        "found 0",
      );
      const primary = await seed(home, name);
      const paths = new PathManager({ name, headDirPath: home }, baserDefaults(compat));
      await assertRejects(() => run(() => paths.existingDirectoryPath()), Error, "found 2");
      assertEquals(await run(() => paths.existingDirectoryPath(home)), primary);
    }
  } finally {
    if (previous === undefined) Deno.env.delete("HOME");
    else Deno.env.set("HOME", previous);
    await Deno.remove(home, { recursive: true });
  }
});
