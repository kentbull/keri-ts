import { assertEquals, assertThrows } from "jsr:@std/assert";
import { b, t } from "../../../../../cesr/mod.ts";
import { onItemsAsText, pairsAsText, valuesAsText, withTempLMDBer } from "./lmdber-test-utils.ts";

Deno.test("db/core lmdber ioset - putIoSetVals preserves first-seen order and only appends new logical values", async () => {
  await withTempLMDBer("ioset-put", (lmdber) => {
    const sets = lmdber.openDB("sets.", false);

    assertEquals(
      lmdber.putIoSetVals(sets, b("story.arc"), [
        b("draft"),
        b("review"),
        b("draft"),
      ]),
      true,
    );
    assertEquals(
      lmdber.putIoSetVals(sets, b("story.arc"), [
        b("review"),
        b("publish"),
      ]),
      true,
    );
    assertEquals(
      lmdber.putIoSetVals(sets, b("story.arc"), [
        b("draft"),
        b("review"),
        b("publish"),
      ]),
      false,
    );

    assertEquals(
      pairsAsText(lmdber.getIoSetItemIter(sets, b("story.arc"))),
      [
        "story.arc=draft",
        "story.arc=review",
        "story.arc=publish",
      ],
    );
  });
});

Deno.test("db/core lmdber ioset - pinIoSetVals replaces the logical set with unique values in order", async () => {
  await withTempLMDBer("ioset-pin", (lmdber) => {
    const sets = lmdber.openDB("sets.", false);

    lmdber.putIoSetVals(sets, b("playlist"), [b("intro"), b("chorus")]);
    assertEquals(
      lmdber.pinIoSetVals(sets, b("playlist"), [
        b("bridge"),
        b("bridge"),
        b("outro"),
      ]),
      true,
    );

    assertEquals(
      pairsAsText(lmdber.getIoSetItemIter(sets, b("playlist"))),
      ["playlist=bridge", "playlist=outro"],
    );
  });
});

Deno.test("db/core lmdber ioset - addIoSetVal is idempotent and does not recycle hidden suffix holes", async () => {
  await withTempLMDBer("ioset-add", (lmdber) => {
    const sets = lmdber.openDB("sets.", false);

    lmdber.putIoSetVals(sets, b("queue"), [b("alpha"), b("beta"), b("gamma")]);
    assertEquals(lmdber.addIoSetVal(sets, b("queue"), b("gamma")), false);
    assertEquals(lmdber.remIoSetVal(sets, b("queue"), b("beta")), true);
    assertEquals(lmdber.addIoSetVal(sets, b("queue"), b("delta")), true);

    assertEquals(
      pairsAsText(lmdber.getIoSetItemIter(sets, b("queue"), 3)),
      ["queue=delta"],
    );
  });
});

Deno.test("db/core lmdber ioset - item iteration offsets and last-item lookup follow insertion order, not lexical order", async () => {
  await withTempLMDBer("ioset-last", (lmdber) => {
    const sets = lmdber.openDB("sets.", false);

    lmdber.putIoSetVals(sets, b("priority"), [
      b("zebra"),
      b("apple"),
      b("moon"),
    ]);

    assertEquals(
      pairsAsText(lmdber.getIoSetItemIter(sets, b("priority"), 1)),
      ["priority=apple", "priority=moon"],
    );
    assertEquals(t(lmdber.getIoSetLastItem(sets, b("priority"))![1]), "moon");
  });
});

Deno.test("db/core lmdber ioset - remIoSet, remIoSetVal, and cntIoSet handle value deletes, null whole-key deletes, and offset counts", async () => {
  await withTempLMDBer("ioset-rem", (lmdber) => {
    const sets = lmdber.openDB("sets.", false);

    lmdber.putIoSetVals(sets, b("labels"), [b("red"), b("green"), b("blue")]);
    assertEquals(lmdber.cntIoSet(sets, b("labels")), 3);
    assertEquals(lmdber.cntIoSet(sets, b("labels"), 1), 2);
    assertEquals(lmdber.remIoSetVal(sets, b("labels"), b("green")), true);
    assertEquals(lmdber.remIoSetVal(sets, b("labels"), b("missing")), false);
    assertEquals(lmdber.remIoSetVal(sets, b("labels"), null), true);
    assertEquals(lmdber.remIoSet(sets, b("labels")), false);
  });
});

Deno.test("db/core lmdber ioset - top and last iterators strip hidden suffixes and keep one last item per effective key", async () => {
  await withTempLMDBer("ioset-branch", (lmdber) => {
    const sets = lmdber.openDB("sets.", false);

    lmdber.putIoSetVals(sets, b("branch.alpha"), [b("a0"), b("a1")]);
    lmdber.putIoSetVals(sets, b("branch.beta"), [b("b0")]);
    lmdber.putIoSetVals(sets, b("branch.gamma"), [b("g0"), b("g1")]);
    lmdber.putIoSetVals(sets, b("other.alpha"), [b("o0")]);

    assertEquals(
      pairsAsText(lmdber.getTopIoSetItemIter(sets, b("branch."))),
      [
        "branch.alpha=a0",
        "branch.alpha=a1",
        "branch.beta=b0",
        "branch.gamma=g0",
        "branch.gamma=g1",
      ],
    );

    assertEquals(
      pairsAsText(lmdber.getIoSetLastItemIterAll(sets)),
      [
        "branch.alpha=a1",
        "branch.beta=b0",
        "branch.gamma=g1",
        "other.alpha=o0",
      ],
    );
    assertEquals(
      pairsAsText(lmdber.getIoSetLastItemIterAll(sets, b("branch.beta"))),
      ["branch.beta=b0", "branch.gamma=g1", "other.alpha=o0"],
    );
    assertEquals(
      valuesAsText(lmdber.getIoSetLastIterAll(sets, b("branch.beta"))),
      ["b0", "g1", "o0"],
    );
  });
});

Deno.test("db/core lmdber onioset - wrapper writes and exact-ordinal reads stay isolated by ordinal bucket", async () => {
  await withTempLMDBer("onioset-wrap", (lmdber) => {
    const sets = lmdber.openDB("sets.", false);

    assertEquals(
      lmdber.putOnIoSetVals(sets, b("chapter"), 0, [b("draft"), b("review")]),
      true,
    );
    assertEquals(
      lmdber.pinOnIoSetVals(sets, b("chapter"), 0, [b("review"), b("final")]),
      true,
    );
    assertEquals(
      lmdber.putOnIoSetVals(sets, b("chapter"), 1, [b("appendix")]),
      true,
    );
    assertEquals(
      lmdber.appendOnIoSetVals(sets, b("chapter"), [
        b("release"),
        b("release"),
      ]),
      2,
    );
    assertEquals(
      lmdber.addOnIoSetVal(sets, b("chapter"), 2, b("archive")),
      true,
    );

    assertEquals(
      onItemsAsText(lmdber.getOnIoSetItemIter(sets, b("chapter"), 0)),
      ["chapter:0=review", "chapter:0=final"],
    );
    assertEquals(
      onItemsAsText(lmdber.getOnIoSetItemIter(sets, b("chapter"), 2)),
      ["chapter:2=release", "chapter:2=archive"],
    );
    assertEquals(
      onItemsAsText(lmdber.getOnIoSetItemIter(sets, b("chapter"), 1)),
      ["chapter:1=appendix"],
    );
    assertEquals(
      t(lmdber.getOnIoSetLastItem(sets, b("chapter"), 2)![2]),
      "archive",
    );
    assertEquals(lmdber.getOnIoSetLastItem(sets, b("chapter"), 9), null);

    assertThrows(() => lmdber.appendOnIoSetVals(sets, b(""), [b("bad")]));
    assertThrows(() => lmdber.appendOnIoSetVals(sets, b("chapter"), null));
  });
});

Deno.test("db/core lmdber onioset - delete and count helpers honor per-ordinal, from-ordinal, and empty-key semantics", async () => {
  await withTempLMDBer("onioset-delete", (lmdber) => {
    const sets = lmdber.openDB("sets.", false);

    lmdber.putOnIoSetVals(sets, b("thread"), 0, [b("first"), b("second")]);
    lmdber.putOnIoSetVals(sets, b("thread"), 1, [b("third")]);
    lmdber.putOnIoSetVals(sets, b("other"), 0, [b("side")]);

    assertEquals(lmdber.cntOnIoSet(sets, b("thread"), 0), 2);
    assertEquals(lmdber.cntOnIoSet(sets, b("thread"), 0, 1), 1);
    assertEquals(lmdber.cntOnAllIoSet(sets, b("thread"), 1), 1);
    assertEquals(lmdber.cntOnAllIoSet(sets), 4);

    assertEquals(lmdber.remOnIoSetVal(sets, b("thread"), 0, b("second")), true);
    assertEquals(
      lmdber.remOnIoSetVal(sets, b("thread"), 0, b("missing")),
      false,
    );
    assertEquals(lmdber.remOnIoSetVal(sets, b("thread"), 1, null), true);
    assertEquals(lmdber.remOnAllIoSet(sets, b("missing"), 0), false);
    assertEquals(lmdber.remOnAllIoSet(sets, b("thread"), 0), true);
    assertEquals(lmdber.remOnAllIoSet(sets), true);
    assertEquals(lmdber.cntAll(sets), 0);
  });
});

Deno.test("db/core lmdber onioset - branch, full-scan, sparse-last, and backward iterators stay readable and correct", async () => {
  await withTempLMDBer("onioset-iters", (lmdber) => {
    const sets = lmdber.openDB("sets.", false);

    lmdber.putOnIoSetVals(sets, b("timeline"), 0, [b("draft"), b("review")]);
    lmdber.putOnIoSetVals(sets, b("timeline"), 2, [b("publish")]);
    lmdber.putOnIoSetVals(sets, b("timeline"), 4, [b("archive"), b("notify")]);
    lmdber.putOnIoSetVals(sets, b("timewarp"), 1, [b("alternate")]);

    assertEquals(
      onItemsAsText(lmdber.getOnTopIoSetItemIter(sets, b("timeline."))),
      [
        "timeline:0=draft",
        "timeline:0=review",
        "timeline:2=publish",
        "timeline:4=archive",
        "timeline:4=notify",
      ],
    );
    assertEquals(
      onItemsAsText(lmdber.getOnAllIoSetItemIter(sets, b("timeline"), 2)),
      [
        "timeline:2=publish",
        "timeline:4=archive",
        "timeline:4=notify",
      ],
    );
    assertEquals(
      onItemsAsText(lmdber.getOnAllIoSetItemIter(sets)),
      [
        "timeline:0=draft",
        "timeline:0=review",
        "timeline:2=publish",
        "timeline:4=archive",
        "timeline:4=notify",
        "timewarp:1=alternate",
      ],
    );
    assertEquals(
      onItemsAsText(lmdber.getOnAllIoSetLastItemIter(sets, b("timeline"))),
      [
        "timeline:0=review",
        "timeline:2=publish",
        "timeline:4=notify",
      ],
    );
    assertEquals(
      onItemsAsText(lmdber.getOnAllIoSetItemBackIter(sets, b("timeline"), 2)),
      [
        "timeline:2=publish",
        "timeline:0=review",
        "timeline:0=draft",
      ],
    );
    assertEquals(
      onItemsAsText(
        lmdber.getOnAllIoSetLastItemBackIter(sets, b("timeline"), 2),
      ),
      [
        "timeline:2=publish",
        "timeline:0=review",
      ],
    );
  });
});
