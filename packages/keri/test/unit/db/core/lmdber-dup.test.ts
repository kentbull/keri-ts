import { assertEquals } from "jsr:@std/assert";
import { b, t } from "../../../../../cesr/mod.ts";
import { onItemsAsText, pairsAsText, valuesAsText, withTempLMDBer } from "./lmdber-test-utils.ts";

Deno.test("db/core lmdber dup - putVals returns false on mixed existing input but still stores new values in lexical order", async () => {
  await withTempLMDBer("dup-put", (lmdber) => {
    const dups = lmdber.openDB("dups.", true);

    assertEquals(
      lmdber.putVals(dups, b("letters"), [b("charlie"), b("alpha")]),
      true,
    );
    assertEquals(
      lmdber.putVals(dups, b("letters"), [b("bravo"), b("alpha"), b("delta")]),
      false,
    );

    assertEquals(valuesAsText(lmdber.getVals(dups, b("letters"))), [
      "alpha",
      "bravo",
      "charlie",
      "delta",
    ]);
    assertEquals(lmdber.cntVals(dups, b("letters")), 4);
  });
});

Deno.test("db/core lmdber dup - addVal, iterators, last lookup, and missing-key behavior follow dupsort semantics", async () => {
  await withTempLMDBer("dup-basics", (lmdber) => {
    const dups = lmdber.openDB("dups.", true);

    assertEquals(lmdber.addVal(dups, b("colors"), b("blue")), true);
    assertEquals(lmdber.addVal(dups, b("colors"), b("blue")), false);
    assertEquals(lmdber.addVal(dups, b("colors"), b("amber")), true);

    assertEquals(valuesAsText(lmdber.getValsIter(dups, b("colors"))), [
      "amber",
      "blue",
    ]);
    assertEquals(t(lmdber.getValLast(dups, b("colors"))!), "blue");
    assertEquals(valuesAsText(lmdber.getVals(dups, b("missing"))), []);
    assertEquals(valuesAsText(lmdber.getValsIter(dups, b("missing"))), []);
    assertEquals(lmdber.getValLast(dups, b("missing")), null);
    assertEquals(lmdber.cntVals(dups, b("missing")), 0);
    assertEquals(lmdber.delVals(dups, b("missing")), false);
  });
});

Deno.test("db/core lmdber iodup - insertion order survives lexical conflicts and hidden ordinals advance monotonically", async () => {
  await withTempLMDBer("iodup-order", (lmdber) => {
    const dups = lmdber.openDB("dups.", true);

    const rawOrdinals = () =>
      lmdber.getVals(dups, b("journal")).map((value) => Number.parseInt(t(value.slice(0, 32)), 16));

    assertEquals(
      lmdber.putIoDupVals(dups, b("journal"), [b("zebra"), b("apple")]),
      true,
    );
    assertEquals(
      lmdber.putIoDupVals(dups, b("journal"), [b("apple"), b("moon")]),
      true,
    );
    assertEquals(
      lmdber.putIoDupVals(dups, b("journal"), [
        b("zebra"),
        b("apple"),
        b("moon"),
      ]),
      false,
    );

    assertEquals(valuesAsText(lmdber.getIoDupVals(dups, b("journal"))), [
      "zebra",
      "apple",
      "moon",
    ]);
    assertEquals(rawOrdinals(), [0, 1, 2]);

    assertEquals(lmdber.delIoDupVal(dups, b("journal"), b("apple")), true);
    assertEquals(lmdber.addIoDupVal(dups, b("journal"), b("berry")), true);
    assertEquals(valuesAsText(lmdber.getIoDupVals(dups, b("journal"))), [
      "zebra",
      "moon",
      "berry",
    ]);
    assertEquals(rawOrdinals(), [0, 2, 3]);
  });
});

Deno.test("db/core lmdber iodup - iterators, last lookup, delete-all, counts, and top-branch scans expose stripped logical values", async () => {
  await withTempLMDBer("iodup-branch", (lmdber) => {
    const dups = lmdber.openDB("dups.", true);

    lmdber.putIoDupVals(dups, b("branch.alpha"), [b("zebra"), b("apple")]);
    lmdber.putIoDupVals(dups, b("branch.beta"), [b("moon")]);
    lmdber.putIoDupVals(dups, b("other.alpha"), [b("other")]);

    assertEquals(
      valuesAsText(lmdber.getIoDupValsIter(dups, b("branch.alpha"))),
      [
        "zebra",
        "apple",
      ],
    );
    assertEquals(t(lmdber.getIoDupValLast(dups, b("branch.alpha"))!), "apple");
    assertEquals(lmdber.cntIoDups(dups, b("branch.alpha")), 2);
    assertEquals(
      pairsAsText(lmdber.getTopIoDupItemIter(dups, b("branch."))),
      [
        "branch.alpha=zebra",
        "branch.alpha=apple",
        "branch.beta=moon",
      ],
    );
    assertEquals(lmdber.delIoDupVals(dups, b("branch.beta")), true);
    assertEquals(lmdber.delIoDupVals(dups, b("branch.beta")), false);
  });
});

Deno.test("db/core lmdber oniodup - exact-ordinal helpers stay isolated and append creates a new ordinal bucket", async () => {
  await withTempLMDBer("oniodup-exact", (lmdber) => {
    const dups = lmdber.openDB("dups.", true);

    assertEquals(
      lmdber.putOnIoDupVals(dups, b("ledger"), 0, [b("debit"), b("credit")]),
      true,
    );
    assertEquals(
      lmdber.addOnIoDupVal(dups, b("ledger"), 0, b("credit")),
      false,
    );
    assertEquals(
      lmdber.putOnIoDupVals(dups, b("ledger"), 2, [b("settled")]),
      true,
    );
    assertEquals(lmdber.appendOnIoDupVal(dups, b("ledger"), b("archived")), 3);

    assertEquals(valuesAsText(lmdber.getOnIoDupVals(dups, b("ledger"), 0)), [
      "debit",
      "credit",
    ]);
    assertEquals(
      valuesAsText(lmdber.getOnIoDupValsIter(dups, b("ledger"), 0)),
      [
        "debit",
        "credit",
      ],
    );
    assertEquals(t(lmdber.getOnIoDupLast(dups, b("ledger"), 3)!), "archived");
    assertEquals(valuesAsText(lmdber.getOnIoDupVals(dups, b("ledger"), 2)), [
      "settled",
    ]);
  });
});

Deno.test("db/core lmdber oniodup - last-per-ordinal iterators group by ordinal bucket and strip proems", async () => {
  await withTempLMDBer("oniodup-last", (lmdber) => {
    const dups = lmdber.openDB("dups.", true);

    lmdber.putOnIoDupVals(dups, b("ledger"), 0, [b("a0"), b("a1")]);
    lmdber.putOnIoDupVals(dups, b("ledger"), 2, [b("b0")]);
    lmdber.putOnIoDupVals(dups, b("ledger"), 3, [b("c0"), b("c1")]);

    assertEquals(
      valuesAsText(lmdber.getOnIoDupLastValIter(dups, b("ledger"))),
      [
        "a1",
        "b0",
        "c1",
      ],
    );
    assertEquals(
      onItemsAsText(lmdber.getOnIoDupLastItemIter(dups, b("ledger"))),
      [
        "ledger:0=a1",
        "ledger:2=b0",
        "ledger:3=c1",
      ],
    );
  });
});

Deno.test("db/core lmdber oniodup - delete, count, and full-scan helpers work across ordinals and mixed keys", async () => {
  await withTempLMDBer("oniodup-delete", (lmdber) => {
    const dups = lmdber.openDB("dups.", true);

    lmdber.putOnIoDupVals(dups, b("ledger"), 0, [b("red"), b("blue")]);
    lmdber.putOnIoDupVals(dups, b("ledger"), 1, [b("green")]);
    lmdber.putOnIoDupVals(dups, b("other"), 0, [b("side")]);

    assertEquals(lmdber.delOnIoDupVal(dups, b("ledger"), 0, b("red")), true);
    assertEquals(lmdber.cntOnIoDups(dups, b("ledger"), 0), 1);
    assertEquals(lmdber.delOnIoDups(dups, b("ledger"), 1), true);
    assertEquals(lmdber.delOnIoDups(dups, b("ledger"), 1), false);

    assertEquals(
      onItemsAsText(lmdber.getOnIoDupItemIterAll(dups, b("ledger"), 0)),
      ["ledger:0=blue"],
    );
    assertEquals(valuesAsText(lmdber.getOnIoDupIterAll(dups)), [
      "blue",
      "side",
    ]);
  });
});
