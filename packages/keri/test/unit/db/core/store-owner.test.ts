import { assertEquals, assertRejects } from "jsr:@std/assert";
import { type Operation, run } from "npm:effection@^3.6.0";
import type { StoreIdentity } from "../../../../src/db/core/dber.ts";
import { lmdbDefaultsFor, LmdbStoreOpener } from "../../../../src/db/core/lmdb-opener.ts";
import { openOwner, type StoreFamily, StoreOwner } from "../../../../src/db/core/store-owner.ts";

/** The established layouts every family must keep, so moving an owner cannot move its data. */
const layouts: [StoreFamily, string, number | undefined][] = [
  [{ tail: "db", maxTables: 128 }, "keri_lmdb_", 128],
  [{ tail: "ks", maxTables: 24 }, "keri_ks_", 24],
  [{ tail: "reg", maxTables: 96 }, "keri_reg_", 96],
  [{ tail: "not", maxTables: 8 }, "keri_not_", 8],
  [{ tail: "mbx", maxTables: 8 }, "keri_mbx_", 8],
  [{ tail: "acdc/reg" }, "keri_acdc_reg_", undefined],
  [{ tail: "verifier" }, "keri_verifier_", undefined],
];

for (const [family, tempPrefix, maxNamedDBs] of layouts) {
  for (const compat of [false, true]) {
    Deno.test(`LMDB layout for ${family.tail} stays fixed (compat=${compat})`, () => {
      const alt = compat ? ".keri" : ".tufa";
      assertEquals(lmdbDefaultsFor(family, compat), {
        tailDirPath: `keri/${family.tail}`,
        cleanTailDirPath: `keri/clean/${family.tail}`,
        altTailDirPath: `${alt}/${family.tail}`,
        altCleanTailDirPath: `${alt}/clean/${family.tail}`,
        tempPrefix,
        ...(maxNamedDBs === undefined ? {} : { maxNamedDBs }),
      });
    });
  }
}

Deno.test("LMDB layout ignores compat for a family without a compatibility layout", () => {
  const defaults = lmdbDefaultsFor({ tail: "wallet", noCompat: true }, true);
  assertEquals(defaults.altTailDirPath, ".tufa/wallet");
  assertEquals(defaults.altCleanTailDirPath, ".tufa/clean/wallet");
});

/** Records acquisition outcomes against a real opened store. */
class ProbeOwner extends StoreOwner {
  closes = 0;
  constructor(store: StoreOwner["store"], readonly opens: boolean) {
    super(store);
  }
  *reopen(options?: StoreIdentity): Operation<boolean> {
    if (!this.opens) return false;
    return yield* this.store.reopen(options);
  }
  override *close(clear = false): Operation<boolean> {
    this.closes += 1;
    return yield* this.store.close(clear);
  }
}

Deno.test("openOwner returns a ready owner over an opener-created store", async () => {
  await run(function*() {
    const store = new LmdbStoreOpener().create({ tail: "reg" }, { name: crypto.randomUUID(), temp: true });
    const owner = yield* openOwner(new ProbeOwner(store, true), "Probe");
    try {
      assertEquals(owner.opened, true);
      assertEquals(owner.closes, 0);
    } finally {
      yield* owner.close(true);
    }
  });
});

Deno.test("openOwner closes an owner whose store did not open", async () => {
  const store = new LmdbStoreOpener().create({ tail: "reg" }, { name: crypto.randomUUID(), temp: true });
  const owner = new ProbeOwner(store, false);
  await assertRejects(() => run(() => openOwner(owner, "Probe")), Error, "Failed to open Probe");
  assertEquals(owner.closes, 1);
});
