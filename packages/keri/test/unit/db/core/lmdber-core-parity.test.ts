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

Deno.test("db/core lmdber - On* ordinal-key family parity", async () => {
  await run(function* () {
    const name = `lmdber-on-${crypto.randomUUID()}`;
    const lmdber = yield* openLMDB({ name, temp: true });
    try {
      const db = lmdber.openDB("on.", false);
      const key = b("k");

      assertEquals(lmdber.putOnVal(db, key, 0, b("v0")), true);
      assertEquals(lmdber.putOnVal(db, key, 0, b("again")), false);
      assertEquals(lmdber.pinOnVal(db, key, 0, b("v0p")), true);
      assertEquals(lmdber.appendOnVal(db, key, b("v1")), 1);
      assertEquals(lmdber.appendOnVal(db, key, b("v2")), 2);

      assertEquals(t(lmdber.getOnVal(db, key, 1)!), "v1");
      const item = lmdber.getOnItem(db, key, 2);
      assert(item !== null);
      assertEquals(item[1], 2);
      assertEquals(t(item[2]), "v2");

      assertEquals(lmdber.cntOnAll(db, key), 3);
      const ons = [...lmdber.getOnAllItemIter(db, key)].map(([_, on]) => on);
      assertEquals(ons, [0, 1, 2]);

      assertEquals(lmdber.remOn(db, key, 1), true);
      assertEquals(lmdber.cntOnAll(db, key), 2);
      assertEquals(lmdber.remOnAll(db, key, 2), true);
      assertEquals(lmdber.cntOnAll(db, key), 1);
    } finally {
      yield* lmdber.close(true);
    }
  });
});

Deno.test("db/core lmdber - IoSet and OnIoSet family parity", async () => {
  await run(function* () {
    const name = `lmdber-ioset-${crypto.randomUUID()}`;
    const lmdber = yield* openLMDB({ name, temp: true });
    try {
      const db = lmdber.openDB("ioset.", false);
      const onDb = lmdber.openDB("onioset.", false);
      const key = b("s");
      const okey = b("o");

      assertEquals(
        lmdber.putIoSetVals(db, key, [b("a"), b("b"), b("a")]),
        true,
      );
      assertEquals(lmdber.cntIoSet(db, key), 2);
      assertEquals(lmdber.addIoSetVal(db, key, b("b")), false);
      assertEquals(lmdber.addIoSetVal(db, key, b("c")), true);
      assertEquals(
        [...lmdber.getIoSetItemIter(db, key)].map(([_, val]) => t(val)),
        ["a", "b", "c"],
      );
      assertEquals(t(lmdber.getIoSetLastItem(db, key)![1]), "c");
      assertEquals(lmdber.remIoSetVal(db, key, b("b")), true);
      assertEquals(
        [...lmdber.getIoSetItemIter(db, key)].map(([_, val]) => t(val)),
        ["a", "c"],
      );
      assertEquals(lmdber.pinIoSetVals(db, key, [b("d"), b("e")]), true);
      assertEquals(
        [...lmdber.getIoSetItemIter(db, key)].map(([_, val]) => t(val)),
        ["d", "e"],
      );

      assertEquals(
        lmdber.putOnIoSetVals(onDb, okey, 0, [b("x"), b("y")]),
        true,
      );
      assertEquals(lmdber.appendOnIoSetVals(onDb, okey, [b("z")]), 1);
      assertEquals(lmdber.cntOnIoSet(onDb, okey, 0), 2);
      assertEquals(lmdber.cntOnAllIoSet(onDb, okey), 3);
      assertEquals(
        [...lmdber.getOnAllIoSetLastItemIter(onDb, okey)].map(([, on, val]) =>
          `${on}:${t(val)}`
        ),
        ["0:y", "1:z"],
      );
      assertEquals(
        [...lmdber.getOnAllIoSetItemBackIter(onDb, okey, null)].map((
          [, on, val],
        ) => `${on}:${t(val)}`),
        ["1:z", "0:y", "0:x"],
      );
      assertEquals(lmdber.remOnAllIoSet(onDb, okey, 1), true);
      assertEquals(lmdber.cntOnAllIoSet(onDb, okey), 2);
    } finally {
      yield* lmdber.close(true);
    }
  });
});

Deno.test("db/core lmdber - dup/IoDup/OnIoDup family parity", async () => {
  await run(function* () {
    const name = `lmdber-iodup-${crypto.randomUUID()}`;
    const lmdber = yield* openLMDB({ name, temp: true });
    try {
      const db = lmdber.openDB("dups-plus.", true);
      const dkey = b("d");
      const ikey = b("i");
      const okey = b("o");

      assertEquals(lmdber.putVals(db, dkey, [b("a"), b("b")]), true);
      assertEquals(lmdber.addVal(db, dkey, b("a")), false);
      assertEquals(lmdber.cntVals(db, dkey), 2);
      assertEquals([...lmdber.getValsIter(db, dkey)].map((val) => t(val)), [
        "a",
        "b",
      ]);
      assertEquals(t(lmdber.getValLast(db, dkey)!), "b");
      assertEquals(lmdber.delVal(db, dkey, b("a")), true);
      assertEquals(lmdber.cntVals(db, dkey), 1);
      assertEquals(lmdber.delVals(db, dkey), true);
      assertEquals(lmdber.cntVals(db, dkey), 0);

      assertEquals(lmdber.putIoDupVals(db, ikey, [b("v1"), b("v2")]), true);
      assertEquals(lmdber.addIoDupVal(db, ikey, b("v2")), false);
      assertEquals(lmdber.addIoDupVal(db, ikey, b("v3")), true);
      assertEquals(lmdber.getIoDupVals(db, ikey).map((val) => t(val)), [
        "v1",
        "v2",
        "v3",
      ]);
      assertEquals(t(lmdber.getIoDupValLast(db, ikey)!), "v3");
      assertEquals(lmdber.delIoDupVal(db, ikey, b("v2")), true);
      assertEquals(lmdber.getIoDupVals(db, ikey).map((val) => t(val)), [
        "v1",
        "v3",
      ]);
      assertEquals(lmdber.cntIoDups(db, ikey), 2);

      assertEquals(lmdber.putOnIoDupVals(db, okey, 0, [b("a"), b("b")]), true);
      assertEquals(lmdber.addOnIoDupVal(db, okey, 0, b("b")), false);
      assertEquals(lmdber.appendOnIoDupVal(db, okey, b("c")), 1);
      assertEquals(lmdber.getOnIoDupVals(db, okey, 0).map((val) => t(val)), [
        "a",
        "b",
      ]);
      assertEquals(t(lmdber.getOnIoDupLast(db, okey, 1)!), "c");
      assertEquals(
        [...lmdber.getOnIoDupLastItemIter(db, okey, 0)].map(([, on, val]) =>
          `${on}:${t(val)}`
        ),
        ["0:b", "1:c"],
      );
      assertEquals(
        [...lmdber.getOnIoDupItemIterAll(db, okey, 0)].map(([, on, val]) =>
          `${on}:${t(val)}`
        ),
        ["0:a", "0:b", "1:c"],
      );
      assertEquals(
        [...lmdber.getOnIoDupItemBackIter(db, okey, 1)].map(([, on, val]) =>
          `${on}:${t(val)}`
        ),
        ["1:c", "0:b", "0:a"],
      );
      assertEquals(lmdber.delOnIoDupVal(db, okey, 0, b("a")), true);
      assertEquals(lmdber.cntOnIoDups(db, okey, 0), 1);
      assertEquals(lmdber.delOnIoDups(db, okey, 1), true);
    } finally {
      yield* lmdber.close(true);
    }
  });
});

Deno.test("db/core lmdber - method representation sweep for remaining LMDBer APIs", async () => {
  await run(function* () {
    const name = `lmdber-repr-${crypto.randomUUID()}`;
    const lmdber = yield* openLMDB({ name, temp: true });
    try {
      const plain = lmdber.openDB("repr-plain.", false);
      const onDb = lmdber.openDB("repr-on.", false);
      const ioDb = lmdber.openDB("repr-ioset.", false);
      const dupDb = lmdber.openDB("repr-dup.", true);

      // Coverage-only sweep: ensure every LMDBer API has at least one direct
      // call site in unit tests. Assertions stay shallow and behavioral.

      // Core key/value + version primitives.
      assertEquals(lmdber.putVal(plain, b("k0"), b("v0")), true);
      assertEquals(t(lmdber.getVal(plain, b("k0"))!), "v0");
      assertEquals(lmdber.cnt(plain), 1);
      lmdber.setVer("9.9.9");
      assertEquals(lmdber.getVer(), "9.9.9");

      // On* top iterator.
      lmdber.putOnVal(onDb, b("ord"), 0, b("o0"));
      lmdber.putOnVal(onDb, b("ord"), 1, b("o1"));
      assertEquals(
        [...lmdber.getOnTopItemIter(onDb, b("ord"))].map(([, on, val]) =>
          `${on}:${t(val)}`
        ),
        ["0:o0", "1:o1"],
      );

      // IoSet* API coverage points.
      lmdber.putIoSetVals(ioDb, b("set.a"), [b("a1"), b("a2")]);
      lmdber.putIoSetVals(ioDb, b("set.b"), [b("b1")]);
      assertEquals(
        [...lmdber.getTopIoSetItemIter(ioDb, b("set.a"))].map(([k, v]) =>
          `${t(k)}=${t(v)}`
        ),
        ["set.a=a1", "set.a=a2"],
      );
      assertEquals(
        [...lmdber.getIoSetLastItemIterAll(ioDb)].map(([k, v]) =>
          `${t(k)}=${t(v)}`
        ),
        ["set.a=a2", "set.b=b1"],
      );
      assertEquals([...lmdber.getIoSetLastIterAll(ioDb)].map((v) => t(v)), [
        "a2",
        "b1",
      ]);
      assertEquals(lmdber.remIoSet(ioDb, b("set.b")), true);

      // OnIoSet* wrappers/iterators not explicitly covered above.
      assertEquals(
        lmdber.pinOnIoSetVals(ioDb, b("on"), 0, [b("x0"), b("x1")]),
        true,
      );
      assertEquals(lmdber.addOnIoSetVal(ioDb, b("on"), 0, b("x2")), true);
      assertEquals(
        [...lmdber.getOnIoSetItemIter(ioDb, b("on"), 0)].map(([, on, val]) =>
          `${on}:${t(val)}`
        ),
        ["0:x0", "0:x1", "0:x2"],
      );
      assertEquals(t(lmdber.getOnIoSetLastItem(ioDb, b("on"), 0)![2]), "x2");
      assertEquals(lmdber.remOnIoSetVal(ioDb, b("on"), 0, b("x1")), true);
      assertEquals(
        [...lmdber.getOnTopIoSetItemIter(ioDb, b("on"))].map(([, on, val]) =>
          `${on}:${t(val)}`
        ),
        ["0:x0", "0:x2"],
      );
      assertEquals(
        [...lmdber.getOnAllIoSetItemIter(ioDb, b("on"), 0)].map(([, on, val]) =>
          `${on}:${t(val)}`
        ),
        ["0:x0", "0:x2"],
      );
      assertEquals(
        [...lmdber.getOnAllIoSetLastItemBackIter(ioDb, b("on"), 0)].map((
          [, on, val],
        ) => `${on}:${t(val)}`),
        ["0:x2"],
      );

      // dup/IoDup*/OnIoDup* points not explicitly called elsewhere.
      lmdber.putVals(dupDb, b("dup"), [b("d1"), b("d2")]);
      assertEquals(lmdber.getVals(dupDb, b("dup")).map((v) => t(v)), [
        "d1",
        "d2",
      ]);

      lmdber.putIoDupVals(dupDb, b("iodup.top.a"), [b("ia1"), b("ia2")]);
      lmdber.putIoDupVals(dupDb, b("iodup.top.b"), [b("ib1")]);
      assertEquals(
        [...lmdber.getIoDupValsIter(dupDb, b("iodup.top.a"))].map((v) => t(v)),
        [
          "ia1",
          "ia2",
        ],
      );
      assertEquals(
        [...lmdber.getTopIoDupItemIter(dupDb, b("iodup.top."))].map(([k, v]) =>
          `${t(k)}=${t(v)}`
        ),
        ["iodup.top.a=ia1", "iodup.top.a=ia2", "iodup.top.b=ib1"],
      );
      assertEquals(lmdber.delIoDupVals(dupDb, b("iodup.top.b")), true);

      lmdber.putOnIoDupVals(dupDb, b("oid"), 0, [b("oa1"), b("oa2")]);
      lmdber.putOnIoDupVals(dupDb, b("oid"), 1, [b("ob1")]);
      assertEquals(
        [...lmdber.getOnIoDupValsIter(dupDb, b("oid"), 0)].map((v) => t(v)),
        [
          "oa1",
          "oa2",
        ],
      );
      assertEquals(
        [...lmdber.getOnIoDupLastValIter(dupDb, b("oid"), 0)].map((v) => t(v)),
        [
          "oa2",
          "ob1",
        ],
      );
      assertEquals(
        [...lmdber.getOnIoDupValBackIter(dupDb, b("oid"), 1)].map((v) => t(v)),
        [
          "ob1",
          "oa2",
          "oa1",
        ],
      );
      assertEquals(
        [...lmdber.getOnIoDupIterAll(dupDb, b("oid"), 0)].map((v) => t(v)),
        [
          "oa1",
          "oa2",
          "ob1",
        ],
      );
    } finally {
      yield* lmdber.close(true);
    }
  });
});

Deno.test("db/core lmdber - strict KERIpy oracle parity for backward + mixed-key iterators", async () => {
  await run(function* () {
    const name = `lmdber-oracle-${crypto.randomUUID()}`;
    const lmdber = yield* openLMDB({ name, temp: true });
    try {
      const ioDb = lmdber.openDB("oracle-io.", false);
      const dupDb = lmdber.openDB("oracle-dup.", true);

      lmdber.putOnIoSetVals(ioDb, b("a"), 0, [b("a0x"), b("a0y")]);
      lmdber.putOnIoSetVals(ioDb, b("a"), 1, [b("a1x")]);
      lmdber.putOnIoSetVals(ioDb, b("b"), 0, [b("b0x")]);
      lmdber.putOnIoSetVals(ioDb, b("b"), 2, [b("b2x"), b("b2y")]);

      lmdber.putOnIoDupVals(dupDb, b("a"), 0, [b("da0x"), b("da0y")]);
      lmdber.putOnIoDupVals(dupDb, b("a"), 1, [b("da1x")]);
      lmdber.putOnIoDupVals(dupDb, b("b"), 0, [b("db0x")]);
      lmdber.putOnIoDupVals(dupDb, b("b"), 2, [b("db2x"), b("db2y")]);

      // Oracle vectors copied from KERIpy execution against the same scenario.
      // Source command: keripy venv Python run in this repo's local environment.
      assertEquals(
        [...lmdber.getOnAllIoSetItemBackIter(ioDb)].map(([
          key,
          on,
          val,
        ]) => `${t(key)}:${on}:${t(val)}`),
        ["b:2:b2y", "b:2:b2x", "b:0:b0x", "a:1:a1x", "a:0:a0y", "a:0:a0x"],
      );
      assertEquals(
        [...lmdber.getOnAllIoSetItemBackIter(ioDb, b("a"), 1)].map(([
          key,
          on,
          val,
        ]) => `${t(key)}:${on}:${t(val)}`),
        ["a:1:a1x", "a:0:a0y", "a:0:a0x"],
      );
      assertEquals(
        [...lmdber.getOnAllIoSetLastItemBackIter(ioDb)].map(([
          key,
          on,
          val,
        ]) => `${t(key)}:${on}:${t(val)}`),
        ["b:2:b2y", "b:0:b0x", "a:1:a1x", "a:0:a0y"],
      );
      assertEquals(
        [...lmdber.getOnAllIoSetLastItemBackIter(ioDb, b("a"), 1)].map(([
          key,
          on,
          val,
        ]) => `${t(key)}:${on}:${t(val)}`),
        ["a:1:a1x", "a:0:a0y"],
      );

      assertEquals(
        [...lmdber.getOnIoDupItemBackIter(dupDb)].map(([
          key,
          on,
          val,
        ]) => `${t(key)}:${on}:${t(val)}`),
        [
          "b:2:db2y",
          "b:2:db2x",
          "b:0:db0x",
          "a:1:da1x",
          "a:0:da0y",
          "a:0:da0x",
        ],
      );
      assertEquals(
        [...lmdber.getOnIoDupItemBackIter(dupDb, b("a"), 1)].map(([
          key,
          on,
          val,
        ]) => `${t(key)}:${on}:${t(val)}`),
        ["a:1:da1x", "a:0:da0y", "a:0:da0x"],
      );
      assertEquals([...lmdber.getOnIoDupValBackIter(dupDb)].map((v) => t(v)), [
        "db2y",
        "db2x",
        "db0x",
        "da1x",
        "da0y",
        "da0x",
      ]);
      assertEquals(
        [...lmdber.getOnIoDupValBackIter(dupDb, b("a"), 1)].map((v) => t(v)),
        ["da1x", "da0y", "da0x"],
      );

      // mixed-key branch boundary checks
      assertEquals(
        [...lmdber.getOnAllIoSetItemIter(ioDb, b("a"), 0)].map(([
          key,
          on,
          val,
        ]) => `${t(key)}:${on}:${t(val)}`),
        ["a:0:a0x", "a:0:a0y", "a:1:a1x"],
      );
      assertEquals(
        [...lmdber.getOnAllIoSetItemIter(ioDb)].map(([
          key,
          on,
          val,
        ]) => `${t(key)}:${on}:${t(val)}`),
        ["a:0:a0x", "a:0:a0y", "a:1:a1x", "b:0:b0x", "b:2:b2x", "b:2:b2y"],
      );
      assertEquals(
        [...lmdber.getOnIoDupItemIterAll(dupDb, b("a"), 0)].map(([
          key,
          on,
          val,
        ]) => `${t(key)}:${on}:${t(val)}`),
        ["a:0:da0x", "a:0:da0y", "a:1:da1x"],
      );
      assertEquals(
        [...lmdber.getOnIoDupItemIterAll(dupDb)].map(([
          key,
          on,
          val,
        ]) => `${t(key)}:${on}:${t(val)}`),
        [
          "a:0:da0x",
          "a:0:da0y",
          "a:1:da1x",
          "b:0:db0x",
          "b:2:db2x",
          "b:2:db2y",
        ],
      );
    } finally {
      yield* lmdber.close(true);
    }
  });
});
