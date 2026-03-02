import { run } from "effection";
import { assert, assertEquals } from "jsr:@std/assert";
import { clearDatabaserDir, openLMDB } from "../../../../src/db/core/lmdber.ts";

Deno.test("db/core lmdber - openLMDB alias opens an LMDBer", async () => {
  await run(function* () {
    const name = `open-lmdb-${crypto.randomUUID()}`;
    const lmdber = yield* openLMDB({ name, temp: true });
    try {
      assert(lmdber.opened);
      assert(lmdber.env !== null);
      assertEquals(lmdber.temp, true);
    } finally {
      yield* lmdber.close(true);
    }
  });
});

Deno.test("db/core lmdber - clearDatabaserDir removes directories idempotently", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "clear-databaser-" });
  await Deno.writeTextFile(`${tempDir}/sample.txt`, "x");

  clearDatabaserDir(tempDir);

  let existsAfterClear = true;
  try {
    await Deno.stat(tempDir);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      existsAfterClear = false;
    } else {
      throw error;
    }
  }
  assertEquals(existsAfterClear, false);

  // Should not throw when path is already absent.
  clearDatabaserDir(tempDir);
});
