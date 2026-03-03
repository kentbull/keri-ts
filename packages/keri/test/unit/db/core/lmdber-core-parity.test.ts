import { run } from "effection";
import { assert, assertEquals, assertThrows } from "jsr:@std/assert";
import { DatabaseNotOpenError } from "../../../../src/core/errors.ts";
import { b, openLMDB, t } from "../../../../src/db/core/lmdber.ts";

Deno.test("db/core lmdber - lifecycle reopen and version metadata parity", async () => {
  await run(function* () {
    const name = `lmdber-lifecycle-${crypto.randomUUID()}`;
    const lmdber = yield* openLMDB({ name, temp: true });
    try {
      assert(lmdber.opened);
      assertEquals(lmdber.getVer(), "1.0.0");

      yield* lmdber.close();
      assertEquals(lmdber.opened, false);

      assertThrows(() => lmdber.getVer(), DatabaseNotOpenError);

      const reopened = yield* lmdber.reopen({ temp: true });
      assertEquals(reopened, true);
      assert(lmdber.opened);
      assertEquals(lmdber.getVer(), "1.0.0");
    } finally {
      if (lmdber.opened) {
        yield* lmdber.close(true);
      }
    }
  });
});

Deno.test("db/core lmdber - cntTop/cntAll/getTopItemIter/delTop non-dup parity", async () => {
  await run(function* () {
    const name = `lmdber-branch-${crypto.randomUUID()}`;
    const lmdber = yield* openLMDB({ name, temp: true });
    try {
      const db = lmdber.openDB("branch.", false);

      // puts three items under the subkey "alpha." with distinct ordinal suffixes
      lmdber.setVal(db, b("alpha.1"), b("v1"));
      lmdber.setVal(db, b("alpha.2"), b("v2"));
      lmdber.setVal(db, b("alpha.3"), b("v3"));
      lmdber.setVal(db, b("beta.1"), b("v4"));

      assertEquals(lmdber.cntAll(db), 4);
      assertEquals(lmdber.cntTop(db, b("alpha.")), 3);

      const iterItems = [...lmdber.getTopItemIter(db, b("alpha."))].map(
        ([key, val]) => `${t(key)}=${t(val)}`,
      );
      assertEquals(iterItems, ["alpha.1=v1", "alpha.2=v2", "alpha.3=v3"]);

      assertEquals(lmdber.delTop(db, b("alpha.")), true);
      assertEquals(lmdber.cntTop(db, b("alpha.")), 0);
      assertEquals(lmdber.cntAll(db), 1);
      assertEquals(lmdber.delTop(db, b("alpha.")), false);
    } finally {
      yield* lmdber.close(true);
    }
  });
});

Deno.test("db/core lmdber - dupsort branch iteration/count/delete parity", async () => {
  await run(function* () {
    const name = `lmdber-dups-${crypto.randomUUID()}`;
    const lmdber = yield* openLMDB({ name, temp: true });
    try {
      const dupDb = lmdber.openDB("dups.", true);

      lmdber.setVal(dupDb, b("branch.a"), b("v1"));
      lmdber.setVal(dupDb, b("branch.a"), b("v2"));
      lmdber.setVal(dupDb, b("branch.b"), b("v3"));
      lmdber.setVal(dupDb, b("other.c"), b("v4"));

      assertEquals(lmdber.cntTop(dupDb, b("branch.")), 3);
      assertEquals(lmdber.cntAll(dupDb), 4);

      const branchVals = [...lmdber.getTopItemIter(dupDb, b("branch."))].map(
        ([_, val]) => t(val),
      );
      assertEquals(branchVals, ["v1", "v2", "v3"]);

      assertEquals(lmdber.delTop(dupDb, b("branch.")), true);
      assertEquals(lmdber.cntTop(dupDb, b("branch.")), 0);
      assertEquals(lmdber.cntAll(dupDb), 1);
    } finally {
      yield* lmdber.close(true);
    }
  });
});
