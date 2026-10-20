import { run } from "effection";
import { assertEquals, assertRejects, assertStrictEquals, assertStringIncludes } from "jsr:@std/assert";
import { t } from "../../../../cesr/mod.ts";
import { oobiCleanCommand } from "../../../src/app/cli/oobi-clean.ts";
import { DatabaseOperationError } from "../../../src/core/errors.ts";
import { OobiRecord } from "../../../src/core/records.ts";
import { LMDBer } from "../../../src/db/core/lmdber.ts";
import { Komer } from "../../../src/db/koming.ts";
import { openOobiStore } from "../../../src/db/oobi-store.ts";
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

/** Populate only the pending table and adjacent protected tables, without keys/config. */
async function seed(headDirPath: string): Promise<string> {
  return await run(function*() {
    const db = new LMDBer({ headDirPath, name: "offline" });
    yield* db.reopen();
    try {
      for (const subkey of ["oobis.", "woobi.", "coobi.", "roobi."]) {
        const table = new Komer(db, { subkey, recordClass: OobiRecord });
        for (const key of keys) table.pin(key, new OobiRecord({ date: "2026-10-20T00:00:00Z" }));
      }
      return db.path!;
    } finally {
      yield* db.close();
    }
  });
}

Deno.test("oobi clean CLI - preview, all-key preflight, exact apply and no unrelated startup", async () => {
  const headDirPath = await Deno.makeTempDir();
  try {
    const path = await seed(headDirPath);
    const keyFile = `${headDirPath}/keys.json`;
    const args = ["oobi", "clean", "--name", "offline", "--head-dir", headDirPath, "--key-file", keyFile];
    await Deno.writeTextFile(keyFile, JSON.stringify([first, first, second]));
    const before = await Deno.readFile(`${path}/data.mdb`);
    const preview = await command(["--loglevel", "debug", ...args]);
    assertEquals(preview.code, 0, preview.stderr);
    assertEquals(JSON.parse(preview.stdout), {
      path,
      mode: "preview",
      selectedCount: 2,
      entries: [{ key: first, present: true }, { key: second, present: true }],
      missing: [],
      deletedCount: 0,
      deleted: [],
      remaining: [first, second],
    });
    assertStringIncludes(preview.stderr, "Opening LMDB");
    assertEquals(await Deno.readFile(`${path}/data.mdb`), before);

    await Deno.writeTextFile(keyFile, JSON.stringify([first, "missing"]));
    for (const flags of [[], ["--apply"]]) {
      const missing = await command([...args, ...flags]);
      assertEquals(missing.code, 1);
      assertStringIncludes(missing.stderr, "Pending OOBI keys not found");
      assertEquals(JSON.parse(missing.stdout).deleted, []);
      assertEquals(JSON.parse(missing.stdout).missing, ["missing"]);
      assertEquals(await Deno.readFile(`${path}/data.mdb`), before);
    }

    await Deno.writeTextFile(keyFile, JSON.stringify([first, first, second]));
    const applied = await command([...args, "--apply"]);
    assertEquals(applied.code, 0, applied.stderr);
    assertEquals(JSON.parse(applied.stdout), {
      path,
      mode: "apply",
      selectedCount: 2,
      entries: [{ key: first, present: true }, { key: second, present: true }],
      missing: [],
      deletedCount: 2,
      deleted: [first, second],
      remaining: [],
    });
    await run(function*() {
      const db = new LMDBer({ readonly: true });
      yield* db.openExisting(path);
      try {
        const pending = new Komer(db, { subkey: "oobis.", recordClass: OobiRecord });
        assertEquals(pending.get(first), null);
        assertEquals(pending.get(second), null);
        assertEquals(pending.get(third)?.date, "2026-10-20T00:00:00Z");
        for (const subkey of ["woobi.", "coobi.", "roobi."]) {
          const table = new Komer(db, { subkey, recordClass: OobiRecord });
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
    assertStringIncludes(missing.stderr, "existing directory");
    assertEquals([...Deno.readDirSync(headDirPath)].map((entry) => entry.name), ["keys.json"]);
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
        const store = yield* openOobiStore({ headDirPath, name: "offline" });
        assertEquals(keys.map((key) => store.get(key) !== null), [false, true, true]);
      });
    } finally {
      Komer.prototype.rem = originalRem;
      harness.restoreOutput();
      await Deno.remove(headDirPath, { recursive: true });
    }
  });
}
