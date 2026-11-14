/**
 * LMDB takes the environment's writer lock for every write transaction it opens, even one that writes nothing.
 * A primitive that finds nothing to change therefore answers from a read: a write transaction opens only for a
 * row that will change, and the counter the store seam exposes moves only then.
 */
import { assertEquals } from "jsr:@std/assert";
import { b } from "../../../../../cesr/mod.ts";
import { withTempLMDBer } from "./lmdber-test-utils.ts";

Deno.test("db/core lmdber - a write that changes nothing opens no write transaction", async () => {
  await withTempLMDBer("no-empty-writes", (lmdber) => {
    const plain = lmdber.openDB("plain.", false), dup = lmdber.openDB("dup.", true);
    const opened = (act: () => unknown) => {
      const before = lmdber.writeActivity;
      act();
      return lmdber.writeActivity - before;
    };

    assertEquals(opened(() => lmdber.putVal(plain, b("a"), b("1"))), 1, "a new row is written");
    assertEquals(opened(() => lmdber.putVal(plain, b("a"), b("2"))), 0, "an existing row is not overwritten");
    assertEquals(opened(() => lmdber.delVal(plain, b("absent"))), 0, "an absent row needs no removal");
    assertEquals(opened(() => lmdber.delVal(plain, b("a"))), 1, "a stored row is removed");

    assertEquals(opened(() => lmdber.addVal(dup, b("k"), b("v"))), 1, "a new duplicate is written");
    assertEquals(opened(() => lmdber.addVal(dup, b("k"), b("v"))), 0, "a stored duplicate is not added again");
    assertEquals(opened(() => lmdber.putVals(dup, b("k"), [b("v")])), 0, "stored duplicates are not added again");
    assertEquals(opened(() => lmdber.delVal(dup, b("k"), b("absent"))), 0, "an absent duplicate needs no removal");
    assertEquals(opened(() => lmdber.delVal(dup, b("nokey"), b("v"))), 0, "a duplicate of an absent key needs none");
    assertEquals(opened(() => lmdber.delVal(dup, b("k"), b("v"))), 1, "a stored duplicate is removed");
    assertEquals(opened(() => lmdber.delVals(dup, b("k"))), 0, "a key already emptied needs no removal");

    assertEquals(opened(() => lmdber.transaction(() => {})), 1, "an explicit transaction is a write transaction");
    assertEquals(
      opened(() =>
        lmdber.transaction(() => {
          lmdber.putVal(plain, b("n"), b("1"));
          lmdber.delVal(plain, b("n"));
        })
      ),
      1,
      "writes inside one writer borrow it",
    );
  });
});
