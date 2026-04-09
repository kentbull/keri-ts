// @file-test-lane db-fast

import { run } from "effection";
import { assert, assertEquals, assertThrows } from "jsr:@std/assert";
import { b, t } from "../../../../../cesr/mod.ts";
import { DatabaseNotOpenError } from "../../../../src/core/errors.ts";
import { LMDBer } from "../../../../src/db/core/lmdber.ts";

Deno.test("db/core lmdber lifecycle - reopen preserves data and close clears env state", async () => {
  await run(function*() {
    const lmdber = new LMDBer({
      name: `lifecycle-${crypto.randomUUID()}`,
      temp: true,
    });

    assertEquals(yield* lmdber.reopen({ temp: true }), true);
    assert(lmdber.opened);
    assertEquals(lmdber.getVer(), "1.0.0");

    const stories = lmdber.openDB("stories.", false);
    lmdber.setVal(stories, b("story.alpha"), b("first draft"));
    const firstPath = lmdber.path;

    assertEquals(yield* lmdber.close(), true);
    assertEquals(lmdber.env, null);
    assertEquals(lmdber.opened, false);
    assertThrows(() => lmdber.getVer(), DatabaseNotOpenError);

    assertEquals(yield* lmdber.reopen({ temp: true }), true);
    assert(lmdber.opened);
    assertEquals(lmdber.path, firstPath);
    const reopenedStories = lmdber.openDB("stories.", false);
    assertEquals(
      t(lmdber.getVal(reopenedStories, b("story.alpha"))!),
      "first draft",
    );

    yield* lmdber.close(true);
  });
});

Deno.test("db/core lmdber lifecycle - readonly reopen on a missing database returns false without a half-open env", async () => {
  const headDirPath = await Deno.makeTempDir({ prefix: "lmdber-readonly-" });

  try {
    await run(function*() {
      const lmdber = new LMDBer({
        headDirPath,
        base: "missing",
        name: `readonly-${crypto.randomUUID()}`,
        readonly: true,
      });

      assertEquals(yield* lmdber.reopen({ readonly: true }), false);
      assertEquals(lmdber.env, null);
      assertEquals(lmdber.opened, false);
      assert(lmdber.path !== null);

      yield* lmdber.close(true);
    });
  } finally {
    await Deno.remove(headDirPath, { recursive: true }).catch(() => undefined);
  }
});

Deno.test("db/core lmdber lifecycle - getVer and setVer handle overwrite, missing metadata, and empty markers", async () => {
  await run(function*() {
    const lmdber = new LMDBer({
      name: `version-${crypto.randomUUID()}`,
      temp: true,
    });

    assertEquals(yield* lmdber.reopen({ temp: true }), true);
    assertEquals(lmdber.getVer(), "1.0.0");

    lmdber.setVer("2.5.0");
    assertEquals(lmdber.getVer(), "2.5.0");

    lmdber.env!.removeSync(b("__version__"));
    assertEquals(lmdber.getVer(), null);

    lmdber.env!.putSync(b("__version__"), new Uint8Array());
    assertEquals(lmdber.getVer(), null);

    yield* lmdber.close(true);
  });
});

Deno.test("db/core lmdber lifecycle - openDB changes duplicate semantics for named databases", async () => {
  await run(function*() {
    const lmdber = new LMDBer({
      name: `named-db-${crypto.randomUUID()}`,
      temp: true,
    });

    assertEquals(yield* lmdber.reopen({ temp: true }), true);

    const plain = lmdber.openDB("plain.", false);
    const dups = lmdber.openDB("dups.", true);

    lmdber.setVal(plain, b("item"), b("draft"));
    lmdber.setVal(plain, b("item"), b("final"));
    assertEquals(lmdber.cnt(plain), 1);
    assertEquals(t(lmdber.getVal(plain, b("item"))!), "final");

    lmdber.setVal(dups, b("item"), b("draft"));
    lmdber.setVal(dups, b("item"), b("final"));
    assertEquals(lmdber.cnt(dups), 2);
    assertEquals(
      [...lmdber.getValsIter(dups, b("item"))].map((value) => t(value)),
      ["draft", "final"],
    );

    yield* lmdber.close(true);
  });
});
