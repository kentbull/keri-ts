import { run } from "effection";
import { assertEquals, assertExists, assertInstanceOf, assertThrows } from "jsr:@std/assert";
import { b, Cigar, Diger, MtrDex, NumberPrimitive, Prefixer, Siger, Verfer } from "../../../../cesr/mod.ts";
import { branToSeedAeid } from "../../../src/app/habbing.ts";
import { Algos, Creatory, encodeHugeNumber, Manager, saltySigner } from "../../../src/app/keeping.ts";
import { encryptSaltQb64, makeDecrypterFromSeed, makeEncrypterFromAeid } from "../../../src/core/keeper-crypto.ts";
import { createKeeper } from "../../../src/db/keeping.ts";

function keeperPubsKey(pre: string, ridx: number): string {
  return `${pre}.${ridx.toString(16).padStart(32, "0")}`;
}

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

Deno.test("app/keeping - Creatory builds salty and randy creators with executable signers", () => {
  const salt = "0AAwMTIzNDU2Nzg5YWJjZGVm";
  const salty = new Creatory(Algos.salty).make({
    salt,
    stem: "ab",
    tier: "low",
  });
  const saltySigners = salty.create({
    count: 2,
    pidx: 1,
    ridx: 2,
    kidx: 3,
    transferable: false,
    temp: true,
  });
  const ser = new TextEncoder().encode("creator-signatures");
  const randy = new Creatory(Algos.randy).make();
  const randomSigners = randy.create({
    codes: [MtrDex.Ed25519_Seed, MtrDex.ECDSA_256k1_Seed],
    transferable: true,
  });

  assertEquals(
    saltySigners.map((signer) => signer.qb64),
    [
      saltySigner(salt, "ab23", false, "low", true).signer.qb64,
      saltySigner(salt, "ab24", false, "low", true).signer.qb64,
    ],
  );
  assertEquals(
    saltySigners.map((signer) => signer.verfer.code),
    [MtrDex.Ed25519N, MtrDex.Ed25519N],
  );
  assertEquals(
    randomSigners.map((signer) => signer.code),
    [MtrDex.Ed25519_Seed, MtrDex.ECDSA_256k1_Seed],
  );
  for (const signer of randomSigners) {
    const cigar = signer.sign(ser);
    assertEquals(signer.verfer.verify(cigar.raw, ser), true);
  }
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

Deno.test("app/keeping - Manager.incept honors requested current and next signer suites", async () => {
  await run(function*() {
    const keeper = yield* createKeeper({
      name: `manager-suite-incept-${crypto.randomUUID()}`,
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
        icode: MtrDex.ECDSA_256k1_Seed,
        ncode: MtrDex.ECDSA_256r1_Seed,
        transferable: true,
        temp: true,
      });
      const currentPub = verfers[0].qb64;
      const nextPub = [...keeper.pris.getTopItemIter()]
        .map(([keys]) => keys[0])
        .find((pub): pub is string =>
          !!pub && pub !== currentPub
          && Diger.compare(b(pub), digers[0].code, digers[0].raw)
        );

      assertEquals(verfers[0].code, MtrDex.ECDSA_256k1);
      assertEquals(keeper.pris.get(currentPub)?.code, MtrDex.ECDSA_256k1_Seed);
      assertExists(nextPub);
      assertEquals(keeper.pris.get(nextPub)?.code, MtrDex.ECDSA_256r1_Seed);
      assertEquals(digers.length, 1);
    } finally {
      yield* keeper.close(true);
    }
  });
});

Deno.test("app/keeping - Manager.incept stores next Ed25519 public keys and derives digers from them", async () => {
  await run(function*() {
    const keeper = yield* createKeeper({
      name: `manager-ed25519-next-${crypto.randomUUID()}`,
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
        icode: MtrDex.Ed25519_Seed,
        ncode: MtrDex.Ed25519_Seed,
        transferable: true,
        temp: true,
      });
      const pre = verfers[0].qb64;
      const sit = keeper.getSits(pre);
      const storedNext = sit?.nxt.pubs[0];

      assertExists(storedNext);
      assertEquals(Diger.compare(b(storedNext), digers[0].code, digers[0].raw), true);
      assertEquals(keeper.getPubs(keeperPubsKey(pre, 1))?.pubs[0], storedNext);
    } finally {
      yield* keeper.close(true);
    }
  });
});

Deno.test("app/keeping - Manager.sign emits suite-correct signatures from stored signer material", async () => {
  await run(function*() {
    const suites = [
      {
        icode: MtrDex.ECDSA_256k1_Seed,
        verferCode: MtrDex.ECDSA_256k1,
        sigerCode: "C",
        cigarCode: MtrDex.ECDSA_256k1_Sig,
      },
      {
        icode: MtrDex.ECDSA_256r1_Seed,
        verferCode: MtrDex.ECDSA_256r1,
        sigerCode: "E",
        cigarCode: MtrDex.ECDSA_256r1_Sig,
      },
    ] as const;

    for (const suite of suites) {
      const keeper = yield* createKeeper({
        name: `manager-suite-sign-${suite.icode}-${crypto.randomUUID()}`,
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
          icode: suite.icode,
          ncode: suite.icode,
          transferable: true,
          temp: true,
        });
        const ser = new TextEncoder().encode(`suite-sign-${suite.icode}`);
        const sigers = manager.sign(ser, [verfers[0].qb64], true);
        const cigars = manager.sign(ser, [verfers[0].qb64], false);

        assertEquals(verfers[0].code, suite.verferCode);
        assertEquals(sigers[0].code, suite.sigerCode);
        assertEquals(cigars[0].code, suite.cigarCode);
        assertEquals(verfers[0].verify(sigers[0].raw, ser), true);
        assertEquals(verfers[0].verify(cigars[0].raw, ser), true);
      } finally {
        yield* keeper.close(true);
      }
    }
  });
});

Deno.test("app/keeping - Manager.rotate advances Ed25519 current and next public key state", async () => {
  await run(function*() {
    const keeper = yield* createKeeper({
      name: `manager-ed25519-rotate-${crypto.randomUUID()}`,
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
        icode: MtrDex.Ed25519_Seed,
        ncode: MtrDex.Ed25519_Seed,
        transferable: true,
        temp: true,
      });
      const pre = verfers[0].qb64;
      const firstSit = keeper.getSits(pre);
      const nextPub = firstSit?.nxt.pubs[0];
      const [rotVerfers, rotDigers] = manager.rotate({
        pre,
        ncount: 1,
        ncode: MtrDex.Ed25519_Seed,
        transferable: true,
        temp: true,
      });
      const rotatedSit = keeper.getSits(pre);

      assertEquals(rotVerfers[0].qb64, nextPub);
      assertEquals(rotatedSit?.old.pubs[0], pre);
      assertEquals(rotatedSit?.new.pubs[0], nextPub);
      assertEquals(
        Diger.compare(b(rotatedSit?.nxt.pubs[0] ?? ""), rotDigers[0].code, rotDigers[0].raw),
        true,
      );
      assertEquals(
        keeper.getPubs(keeperPubsKey(pre, rotatedSit?.nxt.ridx ?? 0))?.pubs[0],
        rotatedSit?.nxt.pubs[0],
      );
    } finally {
      yield* keeper.close(true);
    }
  });
});

Deno.test("app/keeping - Manager.ingest and replay preserve Ed25519 current and next public key sequences", async () => {
  await run(function*() {
    const keeper = yield* createKeeper({
      name: `manager-ed25519-ingest-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const manager = new Manager({
        ks: keeper,
        salt: "0AAwMTIzNDU2Nzg5YWJjZGVm",
      });
      const firstSecret = saltySigner(
        "0AAwMTIzNDU2Nzg5YWJjZGVm",
        "ingest-a",
        true,
        "low",
        true,
      ).signer.qb64;
      const secondSecret = saltySigner(
        "0AAwMTIzNDU2Nzg5YWJjZGVm",
        "ingest-b",
        true,
        "low",
        true,
      ).signer.qb64;

      const [ipre, verferies] = manager.ingest({
        secrecies: [[firstSecret], [secondSecret]],
        iridx: 0,
        ncount: 1,
        ncode: MtrDex.Ed25519_Seed,
        dcode: MtrDex.Blake3_256,
        algo: Algos.salty,
        salt: "0AAwMTIzNDU2Nzg5YWJjZGVm",
        transferable: true,
        temp: true,
      });
      const [currentVerfers, currentDigers] = manager.replay({
        pre: ipre,
        advance: false,
      });
      const [advancedVerfers, advancedDigers] = manager.replay({
        pre: ipre,
        advance: true,
        erase: false,
      });
      const sit = keeper.getSits(ipre);

      assertEquals(ipre, verferies[0][0].qb64);
      assertEquals(currentVerfers[0].qb64, verferies[0][0].qb64);
      assertEquals(
        Diger.compare(b(verferies[1][0].qb64), currentDigers[0].code, currentDigers[0].raw),
        true,
      );
      assertEquals(advancedVerfers[0].qb64, verferies[1][0].qb64);
      assertEquals(
        Diger.compare(b(sit?.nxt.pubs[0] ?? ""), advancedDigers[0].code, advancedDigers[0].raw),
        true,
      );
    } finally {
      yield* keeper.close(true);
    }
  });
});

Deno.test("app/keeping - Manager.decrypt opens Ed25519 ciphertexts and rejects non-Ed25519 signer suites", async () => {
  await run(function*() {
    const keeper = yield* createKeeper({
      name: `manager-ed25519-decrypt-${crypto.randomUUID()}`,
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
        icode: MtrDex.Ed25519_Seed,
        ncode: MtrDex.Ed25519_Seed,
        transferable: true,
        temp: true,
      });
      const pub = verfers[0].qb64;
      const cipher = encryptSaltQb64(
        "0AAwMTIzNDU2Nzg5YWJjZGVm",
        makeEncrypterFromAeid(pub),
      );

      const plain = manager.decrypt(cipher.qb64, { pubs: [pub] });

      assertEquals(new TextDecoder().decode(plain), "0AAwMTIzNDU2Nzg5YWJjZGVm");
    } finally {
      yield* keeper.close(true);
    }
  });

  await run(function*() {
    const keeper = yield* createKeeper({
      name: `manager-ecdsa-decrypt-${crypto.randomUUID()}`,
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
        icode: MtrDex.ECDSA_256k1_Seed,
        ncode: MtrDex.ECDSA_256k1_Seed,
        transferable: true,
        temp: true,
      });

      assertThrows(
        () => manager.decrypt("1AAHAAAAAAAAAAAAAAAAAAAA", { pubs: [verfers[0].qb64] }),
        Error,
        "Unsupported decrypt signer code",
      );
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
