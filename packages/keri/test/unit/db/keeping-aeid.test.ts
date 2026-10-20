import { run } from "effection";
import { assert, assertEquals, assertStrictEquals, assertThrows } from "jsr:@std/assert";
import { b, t, Verfer } from "../../../../cesr/mod.ts";
import { branToSeedAeid } from "../../../src/app/habbing.ts";
import { Manager } from "../../../src/app/keeping.ts";
import { DatabaseOperationError } from "../../../src/core/errors.ts";
import { createKeeper, type Keeper } from "../../../src/db/keeping.ts";

const first = branToSeedAeid("MyPasscodeARealSecret");
const second = branToSeedAeid("AnotherPasscodeSecretX");
const salt = "0AAwMTIzNDU2Nzg5YWJjZGVm";

/** Copy the actual affected native rows, including opaque encrypted signer bytes. */
function snapshot(keeper: Keeper) {
  return [keeper.gbls.sdb, keeper.prms.sdb, keeper.pris.sdb].map((table) =>
    Array.from(table.getRange(), ({ key, value }) => [t(key), Array.from(value)])
  );
}

/** Several parameter and signer rows ensure failure can follow real early writes. */
function populate(manager: Manager): string[] {
  const pubs: string[] = [];
  for (let i = 0; i < 2; i++) {
    const [verfers] = manager.incept({ icount: 2, ncount: 2, transferable: true, temp: true });
    pubs.push(...verfers.map((verfer) => verfer.qb64));
  }
  return pubs;
}

/** Verify usable private keys, rather than accepting decrypted-row presence alone. */
function verifySigning(manager: Manager, pubs: string[]) {
  const message = b("AEID migration signing proof");
  const signatures = manager.sign(message, pubs, true);
  assertEquals(signatures.length, pubs.length);
  for (const [index, signature] of signatures.entries()) {
    assert(new Verfer({ qb64: pubs[index] }).verify(signature.raw, message));
  }
}

for (const fault of ["prefix-throw", "signer-false", "aeid-throw", "aeid-false"] as const) {
  Deno.test(`AEID migration - ${fault} rolls back durable and live state through reopen`, async () => {
    const headDirPath = await Deno.makeTempDir();
    const name = "aeid-rollback";
    try {
      await run(function*() {
        let keeper = yield* createKeeper({ name, headDirPath });
        try {
          const manager = new Manager({ ks: keeper, ...first, salt });
          const pubs = populate(manager);
          const before = snapshot(keeper);
          const failure = new Error("Injected late AEID write failure");
          const pinPrms = keeper.prms.pin;
          const pinPris = keeper.pris.pin;
          const pinGbls = keeper.pinGbls;
          let written = 0;
          if (fault === "prefix-throw") {
            keeper.prms.pin = function(...args) {
              const result = pinPrms.apply(this, args);
              if (++written === 2) throw failure;
              return result;
            };
          } else if (fault === "signer-false") {
            keeper.pris.pin = function(...args) {
              const result = pinPris.apply(this, args);
              if (++written === 2) return false;
              return result;
            };
          } else {
            keeper.pinGbls = function(key, value) {
              const result = pinGbls.call(this, key, value);
              if (key === "aeid") {
                written++;
                if (fault === "aeid-throw") throw failure;
                return false;
              }
              return result;
            };
          }
          try {
            const error = assertThrows(() => manager.updateAeid(second.aeid, second.seed));
            if (fault.endsWith("throw")) assertStrictEquals(error, failure);
            else assert(error instanceof DatabaseOperationError);
          } finally {
            keeper.prms.pin = pinPrms;
            keeper.pris.pin = pinPris;
            keeper.pinGbls = pinGbls;
          }
          assertEquals(written, fault.startsWith("aeid") ? 1 : 2);
          assertEquals(snapshot(keeper), before);
          assertEquals(manager.seed, first.seed);
          assertEquals(manager.salt, salt);
          verifySigning(manager, pubs);
          yield* keeper.close();
          keeper = yield* createKeeper({ name, headDirPath });
          assertEquals(snapshot(keeper), before);
          verifySigning(new Manager({ ks: keeper, seed: first.seed }), pubs);
          assertThrows(() => new Manager({ ks: keeper, seed: second.seed }));
        } finally {
          yield* keeper.close();
        }
      });
    } finally {
      await Deno.remove(headDirPath, { recursive: true });
    }
  });
}

Deno.test("AEID migration - plaintext, same-key, new-key and plaintext transitions retain every managed key", async () => {
  const headDirPath = await Deno.makeTempDir();
  try {
    await run(function*() {
      let keeper = yield* createKeeper({ name: "aeid-transitions", headDirPath });
      try {
        let manager = new Manager({ ks: keeper, salt });
        const pubs = populate(manager);
        const plaintext = snapshot(keeper);
        manager.updateAeid(first.aeid, first.seed);
        assert(keeper.getGbls("salt") !== salt);
        for (const [, data] of keeper.prms.getTopItemIter()) assert(data.salt !== salt);
        for (const pub of pubs) assertThrows(() => keeper.getPris(pub));
        verifySigning(manager, pubs);
        yield* keeper.close();
        keeper = yield* createKeeper({ name: "aeid-transitions", headDirPath });
        manager = new Manager({ ks: keeper, seed: first.seed });
        verifySigning(manager, pubs);
        const encrypted = snapshot(keeper);
        manager.updateAeid(first.aeid, first.seed);
        assertEquals(snapshot(keeper), encrypted);
        manager.updateAeid(second.aeid, second.seed);
        verifySigning(manager, pubs);
        yield* keeper.close();
        keeper = yield* createKeeper({ name: "aeid-transitions", headDirPath });
        assertThrows(() => new Manager({ ks: keeper, seed: first.seed }));
        manager = new Manager({ ks: keeper, seed: second.seed });
        verifySigning(manager, pubs);
        manager.updateAeid("", "");
        assertEquals(snapshot(keeper), plaintext);
        verifySigning(manager, pubs);
        yield* keeper.close();
        keeper = yield* createKeeper({ name: "aeid-transitions", headDirPath });
        verifySigning(new Manager({ ks: keeper }), pubs);
      } finally {
        yield* keeper.close();
      }
    });
  } finally {
    await Deno.remove(headDirPath, { recursive: true });
  }
});

Deno.test("AEID migration - invalid replacement credentials leave old secrets usable", async () => {
  await run(function*() {
    const keeper = yield* createKeeper({ name: "aeid-invalid", temp: true });
    try {
      const manager = new Manager({ ks: keeper, ...first, salt });
      const pubs = populate(manager);
      const before = snapshot(keeper);
      for (
        const [aeid, seed] of [[second.aeid, first.seed], [second.aeid, ""], ["invalid", second.seed], ["", "invalid"]]
      ) {
        assertThrows(() => manager.updateAeid(aeid, seed));
        assertEquals(snapshot(keeper), before);
        assertEquals(manager.seed, first.seed);
        assertEquals(manager.salt, salt);
        verifySigning(manager, pubs);
      }
    } finally {
      yield* keeper.close(true);
    }
  });
});

Deno.test("AEID migration - readonly keeper refuses changes without disturbing signing or durable rows", async () => {
  const headDirPath = await Deno.makeTempDir();
  try {
    await run(function*() {
      let keeper = yield* createKeeper({ name: "aeid-readonly", headDirPath });
      try {
        const manager = new Manager({ ks: keeper, ...first, salt });
        const pubs = populate(manager);
        const before = snapshot(keeper);
        yield* keeper.close();
        keeper = yield* createKeeper({ name: "aeid-readonly", headDirPath, readonly: true });
        const reader = new Manager({ ks: keeper, seed: first.seed });
        for (const [aeid, seed] of [[second.aeid, second.seed], ["", ""]]) {
          assertThrows(() => reader.updateAeid(aeid, seed), DatabaseOperationError, "read-only");
          assertEquals(snapshot(keeper), before);
          assertEquals(reader.seed, first.seed);
          assertEquals(reader.salt, salt);
          verifySigning(reader, pubs);
        }
      } finally {
        yield* keeper.close();
      }
    });
  } finally {
    await Deno.remove(headDirPath, { recursive: true });
  }
});

Deno.test("AEID migration - refuse a borrowed writer before publishing manager state", async () => {
  await run(function*() {
    const keeper = yield* createKeeper({ name: "aeid-borrowed", temp: true });
    try {
      const manager = new Manager({ ks: keeper, ...first, salt });
      const pubs = populate(manager);
      const before = snapshot(keeper);
      assertThrows(
        () => keeper.gbls.sdb.transactionSync(() => manager.updateAeid(second.aeid, second.seed)),
        DatabaseOperationError,
        "own its write transaction",
      );
      assertEquals(snapshot(keeper), before);
      assertEquals(manager.seed, first.seed);
      assertEquals(manager.salt, salt);
      verifySigning(manager, pubs);
    } finally {
      yield* keeper.close(true);
    }
  });
});

Deno.test("AEID migration - stale manager cannot replace another manager's committed policy", async () => {
  await run(function*() {
    const keeper = yield* createKeeper({ name: "aeid-stale", temp: true });
    try {
      const stale = new Manager({ ks: keeper, ...first, salt });
      const pubs = populate(stale);
      const current = new Manager({ ks: keeper, seed: first.seed });
      current.updateAeid(second.aeid, second.seed);
      const before = snapshot(keeper);
      assertThrows(() => stale.updateAeid(first.aeid, first.seed), Error, "not associated with last aeid");
      assertEquals(snapshot(keeper), before);
      verifySigning(current, pubs);
    } finally {
      yield* keeper.close(true);
    }
  });
});
