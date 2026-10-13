import { assert, assertEquals, assertThrows } from "jsr:@std/assert";
import { b, t } from "../../../../../cesr/mod.ts";
import { onItemsAsText, withTempLMDBer } from "./lmdber-test-utils.ts";

Deno.test("db/core lmdber on - putOnVal and pinOnVal write exact ordinals without disturbing neighbors", async () => {
  await withTempLMDBer("on-put-pin", (lmdber) => {
    const ordinals = lmdber.openDB("ordinals.", false);

    assertEquals(
      lmdber.putOnVal(ordinals, b("event"), 0, b("inception")),
      true,
    );
    assertEquals(lmdber.putOnVal(ordinals, b("event"), 0, b("rewrite")), false);
    assertEquals(lmdber.putOnVal(ordinals, b("event"), 1, b("rotation")), true);
    assertEquals(lmdber.pinOnVal(ordinals, b("event"), 0, b("icp")), true);

    assertEquals(t(lmdber.getOnVal(ordinals, b("event"), 0)!), "icp");
    assertEquals(t(lmdber.getOnVal(ordinals, b("event"), 1)!), "rotation");

    const item = lmdber.getOnItem(ordinals, b("event"), 1);
    assert(item !== null);
    assertEquals(item[1], 1);
    assertEquals(t(item[2]), "rotation");
    assertEquals(lmdber.getOnVal(ordinals, b("event"), 3), null);
    assertEquals(lmdber.getOnItem(ordinals, b("event"), 3), null);
  });
});

Deno.test("db/core lmdber on - appendOnVal starts at zero, uses the highest existing ordinal, and rejects bad args", async () => {
  await withTempLMDBer("on-append", (lmdber) => {
    const ordinals = lmdber.openDB("ordinals.", false);

    assertEquals(lmdber.appendOnVal(ordinals, b("fresh"), b("first")), 0);

    lmdber.putOnVal(ordinals, b("event"), 0, b("icp"));
    lmdber.putOnVal(ordinals, b("event"), 4, b("ixn"));
    lmdber.putOnVal(ordinals, b("zulu"), 0, b("foreign tail"));

    assertEquals(lmdber.appendOnVal(ordinals, b("event"), b("tail")), 5);
    assertEquals(t(lmdber.getOnVal(ordinals, b("event"), 5)!), "tail");

    assertThrows(() => lmdber.appendOnVal(ordinals, b(""), b("bad")));
    assertThrows(() => lmdber.appendOnVal(ordinals, b("event"), null));
  });
});

Deno.test("db/core lmdber on - remOn, remOnAll, and cntOnAll honor start ordinals and empty-key whole-db behavior", async () => {
  await withTempLMDBer("on-delete", (lmdber) => {
    const ordinals = lmdber.openDB("ordinals.", false);

    lmdber.putOnVal(ordinals, b("alpha"), 0, b("a0"));
    lmdber.putOnVal(ordinals, b("alpha"), 1, b("a1"));
    lmdber.putOnVal(ordinals, b("alpha"), 3, b("a3"));
    lmdber.putOnVal(ordinals, b("beta"), 0, b("b0"));

    assertEquals(lmdber.cntOnAll(ordinals, b("alpha"), 1), 2);
    assertEquals(lmdber.cntOnAll(ordinals), 4);

    assertEquals(lmdber.remOn(ordinals, b("alpha"), 1), true);
    assertEquals(lmdber.remOn(ordinals, b("alpha"), 1), false);
    assertEquals(lmdber.remOnAll(ordinals, b("missing"), 0), false);
    assertEquals(lmdber.remOnAll(ordinals, b("alpha"), 3), true);
    assertEquals(lmdber.cntOnAll(ordinals, b("alpha")), 1);

    assertEquals(lmdber.remOnAll(ordinals), true);
    assertEquals(lmdber.cntOnAll(ordinals), 0);
  });
});

Deno.test("db/core lmdber on - top and all iterators decode logical keys, honor boundaries, and support full scans", async () => {
  await withTempLMDBer("on-iters", (lmdber) => {
    const ordinals = lmdber.openDB("ordinals.", false);

    lmdber.putOnVal(ordinals, b("group.alpha"), 0, b("alpha zero"));
    lmdber.putOnVal(ordinals, b("group.alpha"), 1, b("alpha one"));
    lmdber.putOnVal(ordinals, b("group.beta"), 0, b("beta zero"));
    lmdber.putOnVal(ordinals, b("other.alpha"), 0, b("other zero"));

    assertEquals(
      onItemsAsText(lmdber.getOnTopItemIter(ordinals, b("group.alpha."))),
      [
        "group.alpha:0=alpha zero",
        "group.alpha:1=alpha one",
      ],
    );

    assertEquals(
      onItemsAsText(lmdber.getOnAllItemIter(ordinals, b("group.alpha"), 1)),
      ["group.alpha:1=alpha one"],
    );

    assertEquals(
      onItemsAsText(lmdber.getOnAllItemIter(ordinals)),
      [
        "group.alpha:0=alpha zero",
        "group.alpha:1=alpha one",
        "group.beta:0=beta zero",
        "other.alpha:0=other zero",
      ],
    );
  });
});
