import { assertEquals, assertThrows } from "jsr:@std/assert";
import { run } from "effection";
import { DatabaseNotOpenError } from "../../../../src/core/errors.ts";
import { openLMDB } from "../../../../src/db/core/lmdber.ts";
import { b, t } from "../../../../../cesr/mod.ts";
import { pairsAsText, withTempLMDBer } from "./lmdber-test-utils.ts";

Deno.test("db/core lmdber plain - putVal is write-once and leaves neighbors untouched", async () => {
  await withTempLMDBer("plain-put", (lmdber) => {
    const plain = lmdber.openDB("plain.", false);

    assertEquals(lmdber.putVal(plain, b("alpha"), b("first pass")), true);
    assertEquals(lmdber.putVal(plain, b("alpha"), b("second pass")), false);
    assertEquals(lmdber.putVal(plain, b("beta"), b("neighbor")), true);

    assertEquals(t(lmdber.getVal(plain, b("alpha"))!), "first pass");
    assertEquals(t(lmdber.getVal(plain, b("beta"))!), "neighbor");
  });
});

Deno.test("db/core lmdber plain - setVal overwrites and getVal handles missing values", async () => {
  await withTempLMDBer("plain-set", (lmdber) => {
    const plain = lmdber.openDB("plain.", false);

    assertEquals(lmdber.getVal(plain, b("missing")), null);
    assertEquals(lmdber.setVal(plain, b("report"), b("draft")), true);
    assertEquals(lmdber.setVal(plain, b("report"), b("published")), true);
    assertEquals(t(lmdber.getVal(plain, b("report"))!), "published");
  });
});

Deno.test("db/core lmdber plain - getVal throws the existing guard error after close", async () => {
  await run(function* () {
    const lmdber = yield* openLMDB({
      name: `plain-closed-${crypto.randomUUID()}`,
      temp: true,
    });

    const plain = lmdber.openDB("plain.", false);
    lmdber.setVal(plain, b("report"), b("draft"));

    yield* lmdber.close();

    assertThrows(
      () => lmdber.getVal(plain, b("report")),
      DatabaseNotOpenError,
    );

    yield* lmdber.close(true);
  });
});

Deno.test("db/core lmdber plain - delVal removes plain keys, returns false for misses, and deletes one dupsort value when provided", async () => {
  await withTempLMDBer("plain-del", (lmdber) => {
    const plain = lmdber.openDB("plain.", false);
    const dups = lmdber.openDB("dups.", true);

    lmdber.setVal(plain, b("session"), b("active"));
    assertEquals(lmdber.delVal(plain, b("session")), true);
    assertEquals(lmdber.delVal(plain, b("session")), false);

    lmdber.setVal(dups, b("colors"), b("amber"));
    lmdber.setVal(dups, b("colors"), b("blue"));
    assertEquals(lmdber.delVal(dups, b("colors"), b("amber")), true);
    assertEquals(
      [...lmdber.getValsIter(dups, b("colors"))].map((value) => t(value)),
      ["blue"],
    );
  });
});

Deno.test("db/core lmdber plain - cnt and cntAll count plain and dupsort entries", async () => {
  await withTempLMDBer("plain-count", (lmdber) => {
    const plain = lmdber.openDB("plain.", false);
    const dups = lmdber.openDB("dups.", true);

    lmdber.setVal(plain, b("alpha"), b("one"));
    lmdber.setVal(plain, b("beta"), b("two"));
    assertEquals(lmdber.cnt(plain), 2);
    assertEquals(lmdber.cntAll(plain), 2);

    lmdber.setVal(dups, b("queue"), b("first"));
    lmdber.setVal(dups, b("queue"), b("second"));
    lmdber.setVal(dups, b("queue"), b("third"));
    assertEquals(lmdber.cnt(dups), 3);
    assertEquals(lmdber.cntAll(dups), 3);
  });
});

Deno.test("db/core lmdber plain - branch helpers respect boundaries, empty-prefix whole-db scans, and dupsort duplicate counts", async () => {
  await withTempLMDBer("plain-branch", (lmdber) => {
    const plain = lmdber.openDB("plain.", false);
    const dups = lmdber.openDB("dups.", true);

    lmdber.setVal(plain, b("branch.alpha.001"), b("alpha one"));
    lmdber.setVal(plain, b("branch.alpha.002"), b("alpha two"));
    lmdber.setVal(plain, b("branch.beta.001"), b("beta one"));
    lmdber.setVal(plain, b("elsewhere.001"), b("elsewhere"));

    assertEquals(lmdber.cntTop(plain, b("branch.alpha.")), 2);
    assertEquals(lmdber.cntTop(plain), 4);
    assertEquals(
      pairsAsText(lmdber.getTopItemIter(plain, b("branch.alpha."))),
      [
        "branch.alpha.001=alpha one",
        "branch.alpha.002=alpha two",
      ],
    );
    assertEquals(lmdber.delTop(plain, b("branch.alpha.")), true);
    assertEquals(lmdber.delTop(plain, b("branch.alpha.")), false);
    assertEquals(lmdber.cntTop(plain), 2);

    lmdber.setVal(dups, b("dup.branch.alpha"), b("amber"));
    lmdber.setVal(dups, b("dup.branch.alpha"), b("blue"));
    lmdber.setVal(dups, b("dup.branch.beta"), b("green"));

    assertEquals(lmdber.cntTop(dups, b("dup.branch.")), 3);
    assertEquals(
      pairsAsText(lmdber.getTopItemIter(dups, b("dup.branch."))),
      [
        "dup.branch.alpha=amber",
        "dup.branch.alpha=blue",
        "dup.branch.beta=green",
      ],
    );
  });
});
