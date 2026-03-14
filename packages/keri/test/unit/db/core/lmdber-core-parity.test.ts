import { assertEquals } from "jsr:@std/assert";
import { b } from "../../../../../cesr/mod.ts";
import {
  onItemsAsText,
  valuesAsText,
  withTempLMDBer,
} from "./lmdber-test-utils.ts";

Deno.test("db/core lmdber parity - OnIoSet reverse scans keep mixed-key whole-db order and treat `on` as an upper bound", async () => {
  await withTempLMDBer("parity-onioset", (lmdber) => {
    const sets = lmdber.openDB("sets.", false);

    lmdber.putOnIoSetVals(sets, b("alpha"), 0, [b("alpha-0a"), b("alpha-0b")]);
    lmdber.putOnIoSetVals(sets, b("alpha"), 2, [b("alpha-2a")]);
    lmdber.putOnIoSetVals(sets, b("beta"), 0, [b("beta-0a")]);
    lmdber.putOnIoSetVals(sets, b("beta"), 1, [b("beta-1a"), b("beta-1b")]);

    assertEquals(
      onItemsAsText(lmdber.getOnAllIoSetItemBackIter(sets)),
      [
        "beta:1=beta-1b",
        "beta:1=beta-1a",
        "beta:0=beta-0a",
        "alpha:2=alpha-2a",
        "alpha:0=alpha-0b",
        "alpha:0=alpha-0a",
      ],
    );
    assertEquals(
      onItemsAsText(lmdber.getOnAllIoSetLastItemBackIter(sets)),
      [
        "beta:1=beta-1b",
        "beta:0=beta-0a",
        "alpha:2=alpha-2a",
        "alpha:0=alpha-0b",
      ],
    );
    assertEquals(
      onItemsAsText(lmdber.getOnAllIoSetItemBackIter(sets, b("alpha"), 0)),
      [
        "alpha:0=alpha-0b",
        "alpha:0=alpha-0a",
      ],
    );
  });
});

Deno.test("db/core lmdber parity - OnIoDup reverse scans preserve KERIpy-style mixed-key vectors", async () => {
  await withTempLMDBer("parity-oniodup", (lmdber) => {
    const dups = lmdber.openDB("dups.", true);

    lmdber.putOnIoDupVals(dups, b("alpha"), 0, [b("alpha-0a"), b("alpha-0b")]);
    lmdber.putOnIoDupVals(dups, b("alpha"), 2, [b("alpha-2a")]);
    lmdber.putOnIoDupVals(dups, b("beta"), 0, [b("beta-0a"), b("beta-0b")]);
    lmdber.putOnIoDupVals(dups, b("beta"), 1, [b("beta-1a")]);

    assertEquals(
      onItemsAsText(lmdber.getOnIoDupItemBackIter(dups)),
      [
        "beta:1=beta-1a",
        "beta:0=beta-0b",
        "beta:0=beta-0a",
        "alpha:2=alpha-2a",
        "alpha:0=alpha-0b",
        "alpha:0=alpha-0a",
      ],
    );
    assertEquals(
      valuesAsText(lmdber.getOnIoDupValBackIter(dups, b("alpha"), 0)),
      ["alpha-0b", "alpha-0a"],
    );
  });
});
