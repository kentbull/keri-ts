// @file-test-lane db-fast

import { assertEquals } from "jsr:@std/assert";
import {
  readStoredLmdbMapSize,
  resolveLmdbMapSize,
} from "../../../../src/db/core/lmdber.ts";

Deno.test("db/core lmdber map size - resolve prefers option, then env aliases, then default", () => {
  assertEquals(
    resolveLmdbMapSize({
      optionMapSize: 111,
      envMapSize: "222",
      baserEnvMapSize: "333",
      defaultMapSize: 444,
      databaseExists: false,
    }),
    111,
  );
  assertEquals(
    resolveLmdbMapSize({
      envMapSize: "222",
      baserEnvMapSize: "333",
      defaultMapSize: 444,
      databaseExists: false,
    }),
    222,
  );
  assertEquals(
    resolveLmdbMapSize({
      baserEnvMapSize: "333",
      defaultMapSize: 444,
      databaseExists: false,
    }),
    333,
  );
  assertEquals(
    resolveLmdbMapSize({
      defaultMapSize: 444,
      databaseExists: false,
    }),
    444,
  );
});

Deno.test("db/core lmdber map size - existing DB raises to stored header map size", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lmdber-mapsize-" });
  const dataMdbPath = `${dir}/data.mdb`;
  try {
    const header = new Uint8Array(40);
    const view = new DataView(header.buffer);
    const stored = 10 * 1024 * 1024 * 1024;
    view.setBigUint64(32, BigInt(stored), true);
    await Deno.writeFile(dataMdbPath, header);

    assertEquals(readStoredLmdbMapSize(dataMdbPath), stored);
    // Default/configured 10 GiB matches a 10 GiB stored header; larger stored
    // sizes still win via Math.max in resolveLmdbMapSize.
    assertEquals(
      resolveLmdbMapSize({
        optionMapSize: 10 * 1024 * 1024 * 1024,
        defaultMapSize: 10 * 1024 * 1024 * 1024,
        dataMdbPath,
        databaseExists: true,
      }),
      stored,
    );
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => undefined);
  }
});

Deno.test("db/core lmdber map size - existing DB without readable header uses floor", () => {
  assertEquals(
    resolveLmdbMapSize({
      optionMapSize: 1024,
      defaultMapSize: 1024,
      dataMdbPath: "/tmp/does-not-exist-lmdber-mapsize.data.mdb",
      databaseExists: true,
    }),
    16 * 1024 * 1024 * 1024,
  );
});
