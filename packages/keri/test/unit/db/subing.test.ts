import { run } from "effection";
import { assertEquals } from "jsr:@std/assert";
import {
  b,
  Cipher,
  parseSerder,
  Prefixer,
  SerderKERI,
  Signer,
  smell,
} from "../../../../cesr/mod.ts";
import { branToSeedAeid } from "../../../src/app/habbing.ts";
import { saltySigner } from "../../../src/app/keeping.ts";
import { makeDecrypterFromSeed, makeEncrypterFromAeid } from "../../../src/core/keeper-crypto.ts";
import { createLMDBer } from "../../../src/db/core/lmdber.ts";
import {
  CesrIoSetSuber,
  CesrSuber,
  CryptSignerSuber,
  IoSetSuber,
  OnSuber,
  SerderSuber,
  Suber,
} from "../../../src/db/subing.ts";

function makeSignerMaterial(path: string, transferable = false) {
  return saltySigner(
    "0AAwMTIzNDU2Nzg5YWJjZGVm",
    path,
    transferable,
    "low",
    true,
  );
}

function makeTestSerder(): SerderKERI {
  const prefix = "D".repeat(44);
  const said = "E".repeat(44);
  const ked = {
    v: "KERI10JSON000000_",
    t: "icp",
    d: said,
    i: prefix,
    s: "0",
    kt: "1",
    k: [prefix],
    nt: "0",
    n: [],
    bt: "0",
    b: [],
    c: [],
    a: [],
  };
  const encoder = new TextEncoder();
  const raw = encoder.encode(JSON.stringify({
    ...ked,
    v: `KERI10JSON${encoder.encode(JSON.stringify(ked)).length.toString(16).padStart(6, "0")}_`,
  }));
  const { smellage } = smell(raw);
  return parseSerder(raw, smellage) as SerderKERI;
}

Deno.test("db/subing - Suber uses the configured separator and iterates keys", async () => {
  await run(function*() {
    const lmdber = yield* createLMDBer({
      name: `suber-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const suber = new Suber(lmdber, { subkey: "names.", sep: "^" });
      assertEquals(suber.put(["", "alice"], "EPrefix"), true);
      assertEquals(suber.get(["", "alice"]), "EPrefix");
      assertEquals(suber.get("^alice"), "EPrefix");
      assertEquals([...suber.getItemIter("")], [[["", "alice"], "EPrefix"]]);
    } finally {
      yield* lmdber.close(true);
    }
  });
});

Deno.test("db/subing - OnSuber preserves exposed ordinals", async () => {
  await run(function*() {
    const lmdber = yield* createLMDBer({
      name: `onsuber-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const suber = new OnSuber(lmdber, { subkey: "logs." });
      assertEquals(suber.putOn("evt", 0, "alpha"), true);
      assertEquals(suber.appendOn("evt", "beta"), 1);
      assertEquals(suber.getOn("evt", 0), "alpha");
      assertEquals(suber.getOn("evt", 1), "beta");
      assertEquals([...suber.getOnItemIter("evt")], [
        [["evt"], 0, "alpha"],
        [["evt"], 1, "beta"],
      ]);
      assertEquals(suber.getOnItem("evt", 1), [["evt"], 1, "beta"]);
    } finally {
      yield* lmdber.close(true);
    }
  });
});

Deno.test("db/subing - IoSetSuber keeps insertion order while deduplicating values", async () => {
  await run(function*() {
    const lmdber = yield* createLMDBer({
      name: `ioset-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const suber = new IoSetSuber<string>(lmdber, { subkey: "sets." });
      assertEquals(suber.put("group", ["alpha", "beta"]), true);
      assertEquals(suber.add("group", "beta"), false);
      assertEquals(suber.add("group", "gamma"), true);
      assertEquals(suber.get("group"), ["alpha", "beta", "gamma"]);
      assertEquals(suber.getLast("group"), "gamma");
      assertEquals([...suber.getLastItemIter("")], [[["group"], "gamma"]]);
      assertEquals(suber.cnt("group"), 3);
    } finally {
      yield* lmdber.close(true);
    }
  });
});

Deno.test("db/subing - CesrSuber hydrates typed CESR primitives", async () => {
  await run(function*() {
    const lmdber = yield* createLMDBer({
      name: `cesrsuber-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const { verfer } = makeSignerMaterial("pref-a", false);
      const prefixer = new Prefixer({ qb64: verfer.qb64 });
      const suber = new CesrSuber<Prefixer>(lmdber, {
        subkey: "pres.",
        klas: Prefixer,
      });

      assertEquals(suber.put("alice", prefixer), true);
      assertEquals(suber.get("alice")?.qb64, prefixer.qb64);
      assertEquals(
        [...suber.getItemIter("")].map(([keys, value]) => [keys, value.qb64]),
        [[["alice"], prefixer.qb64]],
      );
    } finally {
      yield* lmdber.close(true);
    }
  });
});

Deno.test("db/subing - CesrIoSetSuber round-trips typed CESR set members", async () => {
  await run(function*() {
    const lmdber = yield* createLMDBer({
      name: `cesrioset-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const signerA = new Signer({
        qb64: makeSignerMaterial("signer-a").signer.qb64,
      });
      const signerB = new Signer({
        qb64: makeSignerMaterial("signer-b").signer.qb64,
      });
      const suber = new CesrIoSetSuber<Signer>(lmdber, {
        subkey: "pris.",
        klas: Signer,
      });

      assertEquals(suber.put("alice", [signerA, signerB]), true);
      assertEquals(suber.get("alice").map((signer) => signer.qb64), [
        signerA.qb64,
        signerB.qb64,
      ]);
      assertEquals(suber.getLast("alice")?.qb64, signerB.qb64);
    } finally {
      yield* lmdber.close(true);
    }
  });
});

Deno.test("db/subing - SerderSuber hydrates KERI serders through the shared parser", async () => {
  await run(function*() {
    const lmdber = yield* createLMDBer({
      name: `serdersuber-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const serder = makeTestSerder();
      const suber = new SerderSuber<SerderKERI>(lmdber, {
        subkey: "evts.",
      });
      assertEquals(suber.put(["Epre", serder.said!], serder), true);
      assertEquals(suber.get(["Epre", serder.said!])?.said, serder.said);
      assertEquals(suber.get(["Epre", serder.said!])?.ilk, "icp");
    } finally {
      yield* lmdber.close(true);
    }
  });
});

Deno.test("db/subing - CryptSignerSuber encrypts at rest and decrypts on read", async () => {
  await run(function*() {
    const lmdber = yield* createLMDBer({
      name: `cryptsigner-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const { signer, verfer } = makeSignerMaterial("crypt-signer", true);
      const { seed, aeid } = branToSeedAeid("MyPasscodeARealSecret");
      const encrypter = makeEncrypterFromAeid(aeid);
      const decrypter = makeDecrypterFromSeed(seed);
      const suber = new CryptSignerSuber(lmdber, { subkey: "pris." });

      assertEquals(suber.put(verfer.qb64, signer, encrypter), true);

      const stored = lmdber.getVal(suber.sdb, b(verfer.qb64));
      if (!stored) {
        throw new Error("Expected encrypted signer bytes in LMDB.");
      }
      assertEquals(new Cipher({ qb64b: stored }).code, "P");
      assertEquals(new Cipher({ qb64b: stored }).qb64 === signer.qb64, false);
      assertEquals(suber.get(verfer.qb64, decrypter)?.qb64, signer.qb64);
      assertEquals(
        [...suber.getTopItemIter("", decrypter)].map(([keys, value]) => [
          keys,
          value.qb64,
        ]),
        [[[verfer.qb64], signer.qb64]],
      );
    } finally {
      yield* lmdber.close(true);
    }
  });
});
