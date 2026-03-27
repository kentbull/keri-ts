import { run } from "effection";
import { assertEquals, assertInstanceOf, assertThrows } from "jsr:@std/assert";
import { Cigar, Diger, NumberPrimitive, Prefixer, Siger, Verfer } from "../../../../cesr/mod.ts";
import { branToSeedAeid } from "../../../src/app/habbing.ts";
import { encodeHugeNumber, Manager, saltySigner } from "../../../src/app/keeping.ts";
import { makeDecrypterFromSeed } from "../../../src/core/keeper-crypto.ts";
import { createKeeper } from "../../../src/db/keeping.ts";

Deno.test("db/keeping - Keeper round-trips group member tuple stores", async () => {
  await run(function*() {
    const keeper = yield* createKeeper({
      name: `keeper-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const member = new Prefixer({
        qb64: saltySigner(
          "0AAwMTIzNDU2Nzg5YWJjZGVm",
          "member-a",
          true,
          "low",
          true,
        ).verfer.qb64,
      });
      const ordinal = new NumberPrimitive({ qb64: encodeHugeNumber(1) });

      assertEquals(keeper.putSmids("group-a", [[member, ordinal]]), true);
      assertEquals(keeper.putRmids("group-a", [[member, ordinal]]), true);
      assertEquals(keeper.getSmids("group-a")[0]?.[0].qb64, member.qb64);
      assertEquals(keeper.getSmids("group-a")[0]?.[1].num, 1n);
      assertEquals(keeper.getRmids("group-a")[0]?.[0].qb64, member.qb64);
      assertEquals(keeper.getRmids("group-a")[0]?.[1].num, 1n);
    } finally {
      yield* keeper.close(true);
    }
  });
});

Deno.test("app/keeping - Manager returns narrow CESR primitives for inception and signing", async () => {
  await run(function*() {
    const keeper = yield* createKeeper({
      name: `manager-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const manager = new Manager({
        ks: keeper,
        salt: "0AAwMTIzNDU2Nzg5YWJjZGVm",
      });
      const [verfers, digers] = manager.incept({
        icount: 1,
        ncount: 1,
        transferable: true,
        temp: true,
      });
      const ser = new TextEncoder().encode("keri-ts");
      const sigers = manager.sign(ser, [verfers[0].qb64], true);
      const cigars = manager.sign(ser, [verfers[0].qb64], false);

      assertInstanceOf(verfers[0], Verfer);
      assertInstanceOf(digers[0], Diger);
      assertInstanceOf(sigers[0], Siger);
      assertInstanceOf(cigars[0], Cigar);
    } finally {
      yield* keeper.close(true);
    }
  });
});

Deno.test("app/keeping - Manager.sign preserves overload behavior for indexed and unindexed calls", async () => {
  await run(function*() {
    const keeper = yield* createKeeper({
      name: `manager-sign-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const manager = new Manager({
        ks: keeper,
        salt: "0AAwMTIzNDU2Nzg5YWJjZGVm",
      });
      const [verfers] = manager.incept({
        icount: 1,
        ncount: 1,
        transferable: true,
        temp: true,
      });
      const ser = new TextEncoder().encode("typed-signatures");

      const indexed = manager.sign(ser, [verfers[0].qb64], true);
      const unindexed = manager.sign(ser, [verfers[0].qb64], false);

      assertEquals(indexed.length, 1);
      assertEquals(unindexed.length, 1);
      assertInstanceOf(indexed[0], Siger);
      assertInstanceOf(unindexed[0], Cigar);
      assertEquals(indexed[0]?.index, 0);
    } finally {
      yield* keeper.close(true);
    }
  });
});

Deno.test("app/keeping - encrypted manager persists sealed secrets and reopens with the same passcode", async () => {
  const name = `manager-enc-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-keeper-${crypto.randomUUID()}`;
  const bran = "MyPasscodeARealSecret";
  const { seed, aeid } = branToSeedAeid(bran);
  let pub = "";

  await run(function*() {
    const keeper = yield* createKeeper({
      name,
      headDirPath,
      reopen: true,
    });
    try {
      const manager = new Manager({
        ks: keeper,
        seed,
        aeid,
        salt: "0AAwMTIzNDU2Nzg5YWJjZGVm",
      });
      const [verfers] = manager.incept({
        icount: 1,
        ncount: 1,
        transferable: true,
        temp: true,
      });
      pub = verfers[0].qb64;

      assertEquals(keeper.getGbls("aeid"), aeid);
      assertEquals(keeper.getGbls("salt")?.startsWith("1AAH"), true);
      assertEquals(keeper.getPrms(pub)?.salt.startsWith("1AAH"), true);
      assertEquals(
        keeper.getPris(pub, makeDecrypterFromSeed(seed)) !== null,
        true,
      );
    } finally {
      yield* keeper.close();
    }
  });

  await run(function*() {
    const keeper = yield* createKeeper({
      name,
      headDirPath,
      reopen: true,
    });
    try {
      const manager = new Manager({ ks: keeper, seed });
      const sigers = manager.sign(
        new TextEncoder().encode("reopen"),
        [pub],
        true,
      );
      assertEquals(sigers.length, 1);
      assertInstanceOf(sigers[0], Siger);
    } finally {
      yield* keeper.close();
    }
  });

  await run(function*() {
    const keeper = yield* createKeeper({
      name,
      headDirPath,
      reopen: true,
    });
    try {
      assertThrows(
        () =>
          new Manager({
            ks: keeper,
            seed: branToSeedAeid("WrongPasscodeSecretAB").seed,
          }),
        Error,
        "Last seed missing or provided last seed not associated",
      );
    } finally {
      yield* keeper.close();
    }
  });
});

Deno.test("app/keeping - updateAeid re-encrypts stored salts and signer secrets", async () => {
  await run(function*() {
    const keeper = yield* createKeeper({
      name: `manager-reaeid-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const first = branToSeedAeid("MyPasscodeARealSecret");
      const second = branToSeedAeid("AnotherPasscodeSecretX");
      const manager = new Manager({
        ks: keeper,
        seed: first.seed,
        aeid: first.aeid,
        salt: "0AAwMTIzNDU2Nzg5YWJjZGVm",
      });
      const [verfers] = manager.incept({
        icount: 1,
        ncount: 1,
        transferable: true,
        temp: true,
      });
      const pub = verfers[0].qb64;
      const beforeRootSalt = keeper.getGbls("salt");
      const beforePreSalt = keeper.getPrms(pub)?.salt;

      manager.updateAeid(second.aeid, second.seed);

      assertEquals(keeper.getGbls("salt") === beforeRootSalt, false);
      assertEquals(keeper.getPrms(pub)?.salt === beforePreSalt, false);
      assertEquals(
        keeper.getPris(pub, makeDecrypterFromSeed(second.seed)) !== null,
        true,
      );
      assertThrows(
        () => keeper.getPris(pub, makeDecrypterFromSeed(first.seed)),
        Error,
      );
      const sigers = manager.sign(new TextEncoder().encode("re-encrypted"), [
        pub,
      ], true);
      assertEquals(sigers.length, 1);
    } finally {
      yield* keeper.close(true);
    }
  });
});
