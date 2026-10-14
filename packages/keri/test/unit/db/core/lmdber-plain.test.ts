import { run } from "effection";
import { assertEquals, assertThrows } from "jsr:@std/assert";
import * as lmdbBinding from "npm:lmdb@3.5.3";
import { b, bytesEqual, ResourceAdmissionError, ResourceLimitError, t } from "../../../../../cesr/mod.ts";
import { DatabaseNotOpenError, DatabaseOperationError } from "../../../../src/core/errors.ts";
import { openLMDB } from "../../../../src/db/core/lmdber.ts";
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

Deno.test("db/core lmdber plain - rows above the native shared-buffer threshold survive read and reopen", async () => {
  await run(function*() {
    const lmdber = yield* openLMDB({ name: `plain-large-${crypto.randomUUID()}`, temp: true });
    try {
      let plain = lmdber.openDB("plain.", false);
      const value = new Uint8Array(16 * 1024 ** 2 + 1);
      value.fill(0xa5);
      value[0] = 0xff;
      value[value.length - 1] = 0xfe;
      lmdber.setVal(plain, b("large"), value);
      assertEquals(bytesEqual(lmdber.getVal(plain, b("large"))!, value), true);
      yield* lmdber.close(false);
      yield* lmdber.reopen({ reuse: true });
      plain = lmdber.openDB("plain.", false);
      assertEquals(bytesEqual(lmdber.getVal(plain, b("large"))!, value), true);
      lmdber.setVal(plain, b("small"), b("following read"));
      assertEquals(t(lmdber.getVal(plain, b("small"))!), "following read");
    } finally {
      yield* lmdber.close(true);
    }
  });
});

Deno.test("db/core lmdber bounded rows admit before copy and retain read or writer transaction ownership", async () => {
  await withTempLMDBer("plain-bounded", (lmdber) => {
    const plain = lmdber.openDB("plain.");
    const native = plain as unknown as {
      getBinary(key: Uint8Array, options?: object): Uint8Array | undefined;
      getBinaryFast(key: Uint8Array, options?: object): Uint8Array | undefined;
      _returnLargeBuffer(): Uint8Array;
      useReadTransaction(): { address: number; done(): void };
      compression: unknown;
      useVersions?: boolean;
    };
    const large = new Uint8Array(16 * 1024 ** 2 + 1).fill(0xff);
    lmdber.setVal(plain, b("large"), large);
    const getBinary = native.getBinary, growth = native._returnLargeBuffer, useRead = native.useReadTransaction;
    let copies = 0, finished = 0;
    native.getBinary = function(key, options) {
      copies++;
      return getBinary.call(this, key, options);
    };
    native._returnLargeBuffer = () => {
      throw new Error("preflight must not grow the native target");
    };
    native.useReadTransaction = function() {
      const transaction = useRead.call(this);
      return {
        address: transaction.address,
        done: () => {
          finished++;
          transaction.done();
        },
      };
    };
    try {
      assertThrows(() => lmdber.getValBounded(plain, b("large"), 1024), ResourceLimitError);
      assertEquals([copies, finished], [0, 1], "oversize releases the snapshot without a fallback copy");
      assertThrows(() =>
        lmdber.getValBounded(plain, b("large"), large.length, (bytes) => {
          assertEquals(bytes, large.length);
          throw new ResourceAdmissionError("copy credit occupied", "busy");
        }), ResourceAdmissionError);
      assertEquals([copies, finished], [0, 2], "shared refusal releases the same snapshot before copying");
      lmdber.setVal(plain, b("small"), b("tiny"));
      const owned = lmdber.getValBounded(plain, b("small"), 4)!;
      assertEquals(t(owned), "tiny");
      assertEquals(
        lmdber.getValBounded(plain, b("absent"), 0, () => {
          throw new Error("missing row needs no credit");
        }),
        null,
      );
      lmdber.setVal(plain, b("empty"), new Uint8Array());
      assertEquals(lmdber.getValBounded(plain, b("empty"), 0), new Uint8Array());
      for (const limit of [-1, NaN, Infinity, 1.5]) {
        assertThrows(() => lmdber.getValBounded(plain, b("small"), limit), RangeError);
      }
      const compression = native.compression;
      native.compression = true;
      assertThrows(() => lmdber.getValBounded(plain, b("small"), 4), DatabaseOperationError, "binding");
      native.compression = compression;
      native.useVersions = true;
      assertThrows(() => lmdber.getValBounded(plain, b("small"), 4), DatabaseOperationError, "binding");
      native.useVersions = false;
      const version = (lmdbBinding as unknown as { version: { nodeCompiledVersion?: number } }).version;
      const compiled = version.nodeCompiledVersion;
      try {
        for (const unsupported of [20, -1, NaN]) {
          version.nodeCompiledVersion = unsupported;
          assertThrows(() => lmdber.getValBounded(plain, b("small"), 4), DatabaseOperationError, "binding");
        }
      } finally {
        if (compiled === undefined) delete version.nodeCompiledVersion;
        else version.nodeCompiledVersion = compiled;
      }
      const fast = native.getBinaryFast;
      native.getBinaryFast = function(key, options) {
        const result = fast.call(this, key, options);
        lmdber.setVal(plain, key, b("later"));
        return result;
      };
      try {
        assertEquals(t(lmdber.getValBounded(plain, b("small"), 4)!), "tiny", "both reads hold the old snapshot");
      } finally {
        native.getBinaryFast = fast;
      }
      assertEquals(t(lmdber.getVal(plain, b("small"))!), "later");
      assertEquals(t(owned), "tiny", "owned rows survive later native reads");
      const before = finished, copying = native.getBinary;
      native.getBinary = () => {
        throw new Error("bounded copy infrastructure fault");
      };
      assertThrows(() => lmdber.getValBounded(plain, b("small"), 5), Error, "infrastructure fault");
      assertEquals(finished, before + 1, "copy failure releases the read snapshot");
      native.getBinary = copying;
      native.useReadTransaction = () => {
        throw new Error("an active writer must not open a readonly transaction");
      };
      lmdber.env!.transactionSync(() => {
        lmdber.setVal(plain, b("inside"), b("writer"));
        assertEquals(t(lmdber.getValBounded(plain, b("inside"), 6, (bytes) => assertEquals(bytes, 6))!), "writer");
        lmdber.setVal(plain, b("inside"), b("changed"));
        assertEquals(t(lmdber.getValBounded(plain, b("inside"), 7)!), "changed");
      });
    } finally {
      native.getBinary = getBinary;
      native._returnLargeBuffer = growth;
      native.useReadTransaction = useRead;
    }
    assertEquals(bytesEqual(lmdber.getValBounded(plain, b("large"), large.length)!, large), true);
    const dups = lmdber.openDB("dups.", true);
    lmdber.putVals(dups, b("same"), [b("z"), b("a")]);
    assertEquals(t(lmdber.getValBounded(dups, b("same"), 1)!), "a");
    lmdber.env!.transactionSync(() => {
      lmdber.addVal(dups, b("same"), b("0"));
      assertEquals(t(lmdber.getValBounded(dups, b("same"), 1)!), "0");
    });
    assertEquals(t(lmdber.getVal(plain, b("inside"))!), "changed");
  });
});

Deno.test("db/core lmdber plain - getVal throws the existing guard error after close", async () => {
  await run(function*() {
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
