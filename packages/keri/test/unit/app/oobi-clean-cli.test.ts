import { run } from "effection";
import { assertEquals, assertRejects, assertStrictEquals, assertStringIncludes } from "jsr:@std/assert";
import { t } from "../../../../cesr/mod.ts";
import { oobiCleanCommand } from "../../../src/app/cli/oobi-clean.ts";
import { DatabaseOperationError } from "../../../src/core/errors.ts";
import { HabitatRecord, OobiRecord } from "../../../src/core/records.ts";
import { Baser, createBaser } from "../../../src/db/basing.ts";
import { LMDBer } from "../../../src/db/core/lmdber.ts";
import { Komer } from "../../../src/db/koming.ts";
import { CLITestHarness } from "../../../test/utils.ts";

const first = "https://example.test/oobi/A%2fb";
const second = " https://example.test/oobi/A%2Fb ";
const third = "tcp://example.test:5631/🧪";
const keys = [first, second, third];

/** Execute the actual CLI, retaining its separate machine output and diagnostics. */
async function command(args: string[]) {
  const out = await new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", "--unstable-ffi", "packages/tufa/mod.ts", ...args],
    cwd: new URL("../../../../../", import.meta.url),
    stdout: "piped",
    stderr: "piped",
  }).output();
  return { code: out.code, stdout: t(out.stdout), stderr: t(out.stderr) };
}

/** Populate an ordinary Baser pending table and its adjacent protected tables. */
async function seed(headDirPath: string): Promise<string> {
  return await run(function*() {
    const db = yield* createBaser({ headDirPath, name: "offline" });
    try {
      for (const table of [db.oobis, db.woobi, db.coobi, db.roobi]) {
        for (const key of keys) table.pin(key, new OobiRecord({ date: "2026-10-20T00:00:00Z" }));
      }
      return db.path!;
    } finally {
      yield* db.close();
    }
  });
}

Deno.test("oobi clean CLI - ordinary Baser preview, all-key preflight and exact pending selection", async () => {
  const headDirPath = await Deno.makeTempDir();
  try {
    const path = await seed(headDirPath);
    const keyFile = `${headDirPath}/keys.json`;
    const args = ["oobi", "clean", "--name", "offline", "--head-dir", headDirPath, "--key-file", keyFile];
    await Deno.writeTextFile(keyFile, JSON.stringify([first, first, second]));
    const preview = await command(["--loglevel", "debug", ...args]);
    assertEquals(preview.code, 0, preview.stderr);
    assertEquals(JSON.parse(preview.stdout), {
      path,
      mode: "preview",
      status: "complete",
      selectedCount: 2,
      entries: [{ key: first, present: true }, { key: second, present: true }],
      missing: [],
      deletedCount: 0,
      deleted: [],
      remaining: [first, second],
    });
    assertStringIncludes(preview.stderr, "Opening LMDB");

    await Deno.writeTextFile(keyFile, JSON.stringify([first, "missing"]));
    for (const flags of [[], ["--apply"]]) {
      const missing = await command([...args, ...flags]);
      assertEquals(missing.code, 1);
      assertStringIncludes(missing.stderr, "Pending OOBI keys not found");
      assertEquals(JSON.parse(missing.stdout).deleted, []);
      assertEquals(JSON.parse(missing.stdout).missing, ["missing"]);
    }

    await Deno.writeTextFile(keyFile, JSON.stringify([first, first, second]));
    const applied = await command([...args, "--apply"]);
    assertEquals(applied.code, 0, applied.stderr);
    assertEquals(JSON.parse(applied.stdout), {
      path,
      mode: "apply",
      status: "complete",
      selectedCount: 2,
      entries: [{ key: first, present: true }, { key: second, present: true }],
      missing: [],
      deletedCount: 2,
      deleted: [first, second],
      remaining: [],
    });
    await run(function*() {
      const db = yield* createBaser({ headDirPath, name: "offline" });
      try {
        const pending = db.oobis;
        assertEquals(pending.sep, ">");
        assertEquals([...pending.getTopItemIter()].map(([key]) => key), [[third]]);
        assertEquals(pending.get(first), null);
        assertEquals(pending.get(second), null);
        assertEquals(pending.get(third)?.date, "2026-10-20T00:00:00Z");
        for (const table of [db.woobi, db.coobi, db.roobi]) {
          for (const key of keys) assertEquals(table.get(key)?.date, "2026-10-20T00:00:00Z");
        }
      } finally {
        yield* db.close();
      }
    });
    assertEquals([...Deno.readDirSync(headDirPath)].map((entry) => entry.name).sort(), ["keri", "keys.json"]);
    assertEquals([...Deno.readDirSync(`${headDirPath}/keri`)].map((entry) => entry.name), ["db"]);
    assertEquals([...Deno.readDirSync(path)].map((entry) => entry.name).sort(), ["data.mdb", "lock.mdb"]);
  } finally {
    await Deno.remove(headDirPath, { recursive: true });
  }
});

Deno.test("oobi clean CLI - invalid key files and missing targets create no database", async () => {
  const headDirPath = await Deno.makeTempDir();
  try {
    const keyFile = `${headDirPath}/keys.json`;
    const args = ["oobi", "clean", "--name", "missing", "--head-dir", headDirPath, "--key-file", keyFile, "--apply"];
    for (const text of ["{", "null", "[]", "\"key\"", "[\"valid\", 7]", "[\"\"]", "[\"\\ud800\"]"]) {
      await Deno.writeTextFile(keyFile, text);
      const result = await command(args);
      assertEquals(result.code, 1, text);
      assertStringIncludes(result.stderr.toLowerCase(), "key file");
      assertEquals(result.stdout, "");
      assertEquals([...Deno.readDirSync(headDirPath)].map((entry) => entry.name), ["keys.json"]);
    }
    await Deno.writeTextFile(keyFile, JSON.stringify([first]));
    const missing = await command(args);
    assertEquals(missing.code, 1);
    assertStringIncludes(missing.stderr, "Existing database not found");
    await assertRejects(() => Deno.stat(`${headDirPath}/keri/db/missing/data.mdb`), Deno.errors.NotFound);
    const help = await command(["oobi", "clean", "--help"]);
    assertEquals(help.code, 0);
    assertStringIncludes(help.stdout, "Stop and back up the service first");
    assertEquals(help.stdout.includes("passcode"), false);
  } finally {
    await Deno.remove(headDirPath, { recursive: true });
  }
});

for (const failureMode of ["false", "throw"]) {
  Deno.test(`oobi clean CLI - ${failureMode} removal reports committed and remaining keys`, async () => {
    const headDirPath = await Deno.makeTempDir();
    const originalRem = Komer.prototype.rem;
    const failure = new Error("native removal failed");
    const harness = new CLITestHarness();
    try {
      const path = await seed(headDirPath);
      const keyFile = `${headDirPath}/keys.json`;
      await Deno.writeTextFile(keyFile, JSON.stringify(keys));
      Komer.prototype.rem = function(key) {
        if (key === second) {
          if (failureMode === "throw") throw failure;
          return false;
        }
        return originalRem.call(this, key);
      };
      harness.captureOutput();
      const error = await assertRejects(
        () =>
          run(() =>
            oobiCleanCommand({
              name: "offline",
              headDirPath,
              keyFile,
              apply: true,
            })
          ),
        DatabaseOperationError,
        "after deleting 1 of 3",
      );
      if (failureMode === "throw") assertStrictEquals(error.cause, failure);
      assertEquals(JSON.parse(harness.getOutput().join("\n")), {
        path,
        mode: "apply",
        status: "failed",
        selectedCount: 3,
        entries: keys.map((key) => ({ key, present: true })),
        missing: [],
        deletedCount: 1,
        deleted: [first],
        remaining: [second, third],
      });
      Komer.prototype.rem = originalRem;
      harness.restoreOutput();
      await run(function*() {
        const db = yield* createBaser({ headDirPath, name: "offline" });
        try {
          assertEquals(keys.map((key) => db.oobis.get(key) !== null), [false, true, true]);
        } finally {
          yield* db.close();
        }
      });
    } finally {
      Komer.prototype.rem = originalRem;
      harness.restoreOutput();
      await Deno.remove(headDirPath, { recursive: true });
    }
  });
}

for (const failRemoval of [false, true]) {
  Deno.test(`oobi clean CLI - shutdown failure after ${failRemoval ? "partial" : "all"} deletions reports overall failure`, async () => {
    const headDirPath = await Deno.makeTempDir();
    const harness = new CLITestHarness();
    const originalOpen = Baser.prototype.reopen;
    const originalRem = Komer.prototype.rem;
    const closeFailure = new Error("native close failed after row operations");
    const removalFailure = new Error("row removal failed");
    try {
      const path = await seed(headDirPath);
      const keyFile = `${headDirPath}/keys.json`;
      await Deno.writeTextFile(keyFile, JSON.stringify(keys));
      Baser.prototype.reopen = function*(options) {
        const opened = yield* originalOpen.call(this, options);
        const native = this.env!;
        const close = native.close.bind(native);
        native.close = () => {
          assertEquals(harness.getOutput(), []); // No final result before closure.
          return close().then(() => {
            throw closeFailure;
          });
        };
        return opened;
      };
      if (failRemoval) {
        Komer.prototype.rem = function(key) {
          if (key === second) throw removalFailure;
          return originalRem.call(this, key);
        };
      }
      harness.captureOutput();
      const error = await assertRejects(() =>
        run(() => oobiCleanCommand({ name: "offline", headDirPath, keyFile, apply: true }))
      );
      if (failRemoval) {
        assertEquals(error instanceof AggregateError, true);
        const failures = (error as AggregateError).errors;
        assertStrictEquals(failures[0].cause, removalFailure);
        assertStrictEquals(failures[1], closeFailure);
      } else assertStrictEquals(error, closeFailure);
      const report = JSON.parse(harness.getOutput().join("\n"));
      assertEquals(report.status, "failed");
      assertEquals(report.deleted, failRemoval ? [first] : keys);
      assertEquals(report.remaining, failRemoval ? [second, third] : []);
      Baser.prototype.reopen = originalOpen;
      Komer.prototype.rem = originalRem;
      harness.restoreOutput();
      await run(function*() {
        const db = yield* createBaser({ headDirPath, name: "offline" });
        try {
          assertEquals(db.path, path);
          assertEquals(
            keys.map((key) => db.oobis.get(key) !== null),
            failRemoval ? [false, true, true] : [false, false, false],
          );
        } finally {
          yield* db.close();
        }
      });
    } finally {
      Baser.prototype.reopen = originalOpen;
      Komer.prototype.rem = originalRem;
      harness.restoreOutput();
      await Deno.remove(headDirPath, { recursive: true });
    }
  });
}

Deno.test("oobi clean CLI - preview accepts ordinary schema initialization and stale habitat cleanup", async () => {
  const headDirPath = await Deno.makeTempDir();
  try {
    const path = await run(function*() {
      const db = new LMDBer({ headDirPath, name: "offline" });
      yield* db.reopen();
      try {
        new Komer(db, { subkey: "oobis.", sep: ">", recordClass: OobiRecord }).pin(
          first,
          new OobiRecord({ date: "2026-10-20T00:00:00Z" }),
        );
        new Komer(db, { subkey: "habs.", recordClass: HabitatRecord }).pin(
          "stale",
          new HabitatRecord({ hid: "missing-state", name: "stale" }),
        );
        return db.path!;
      } finally {
        yield* db.close();
      }
    });
    const keyFile = `${headDirPath}/keys.json`;
    await Deno.writeTextFile(keyFile, JSON.stringify([first]));
    const preview = await command([
      "oobi",
      "clean",
      "--name",
      "offline",
      "--head-dir",
      headDirPath,
      "--key-file",
      keyFile,
    ]);
    assertEquals(preview.code, 0, preview.stderr);
    assertEquals(JSON.parse(preview.stdout).status, "complete");
    // Inspect without another Baser reload: the command itself removed this row.
    await run(function*() {
      const db = new LMDBer();
      yield* db.openExisting(path);
      try {
        assertEquals(new Komer(db, { subkey: "habs.", recordClass: HabitatRecord }).get("stale"), null);
        assertEquals(
          new Komer(db, { subkey: "oobis.", sep: ">", recordClass: OobiRecord }).get(first)?.date,
          "2026-10-20T00:00:00Z",
        );
        db.openDB("stts."); // Ordinary startup created this canonical table.
      } finally {
        yield* db.close();
      }
    });
  } finally {
    await Deno.remove(headDirPath, { recursive: true });
  }
});
