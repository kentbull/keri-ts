import { run } from "effection";
import { assertEquals } from "jsr:@std/assert";
import { b, Cipher, parseSerder, Prefixer, SerderKERI, Signer, smell } from "../../../../cesr/mod.ts";
import { branToSeedAeid } from "../../../src/app/habbing.ts";
import { saltySigner } from "../../../src/app/keeping.ts";
import { makeDecrypterFromSeed, makeEncrypterFromAeid } from "../../../src/core/keeper-crypto.ts";
import { createLMDBer } from "../../../src/db/core/lmdber.ts";
import {
  CesrIoSetSuber,
  CesrSuber,
  CryptSignerSuber,
  IoSetSuber,
  OnIoDupSuber,
  OnIoSetSuber,
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
      assertEquals([...suber.getTopItemIter("")], [[["", "alice"], "EPrefix"]]);
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
      assertEquals(suber.putOn("other", 0, "gamma"), true);
      assertEquals(suber.getOn("evt", 0), "alpha");
      assertEquals(suber.getOn("evt", 1), "beta");
      assertEquals([...suber.getTopItemIter("evt")], [
        [["evt"], 0, "alpha"],
        [["evt"], 1, "beta"],
      ]);
      assertEquals([...suber.getAllItemIter("evt", 1)], [
        [["evt"], 1, "beta"],
      ]);
      assertEquals([...suber.getAllIter("evt", 0)], ["alpha", "beta"]);
      assertEquals([...suber.getOnTopItemIter("evt")], [
        [["evt"], 0, "alpha"],
        [["evt"], 1, "beta"],
      ]);
      assertEquals([...suber.getOnItemIter("evt")], [
        [["evt"], 0, "alpha"],
        [["evt"], 1, "beta"],
      ]);
      assertEquals([...suber.getOnAllItemIter("evt", 1)], [
        [["evt"], 1, "beta"],
      ]);
      assertEquals([...suber.getOnAllIter("evt", 0)], ["alpha", "beta"]);
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
        [...suber.getTopItemIter("")].map((
          [keys, value],
        ) => [keys, value.qb64]),
        [[["alice"], prefixer.qb64]],
      );
      assertEquals(
        [...suber.getItemIter("")].map(([keys, value]) => [keys, value.qb64]),
        [[["alice"], prefixer.qb64]],
      );
    } finally {
      yield* lmdber.close(true);
    }
  });
});

Deno.test("db/subing - OnIoDupSuber supports normalized iterators while retaining legacy aliases", async () => {
  await run(function*() {
    const lmdber = yield* createLMDBer({
      name: `oniodup-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const suber = new OnIoDupSuber<string>(lmdber, { subkey: "dups." });
      assertEquals(suber.put("ledger", 0, ["red", "blue"]), true);
      assertEquals(suber.putOn("ledger", 1, ["green"]), true);
      assertEquals(suber.put("other", 0, ["side"]), true);

      assertEquals(suber.getOn("ledger", 0), ["red", "blue"]);
      assertEquals([...suber.getTopItemIter("ledger")], [
        [["ledger"], 0, "red"],
        [["ledger"], 0, "blue"],
        [["ledger"], 1, "green"],
      ]);
      assertEquals([...suber.getAllItemIter("ledger", 0)], [
        [["ledger"], 0, "red"],
        [["ledger"], 0, "blue"],
        [["ledger"], 1, "green"],
      ]);
      assertEquals([...suber.getAllIter("ledger", 0)], [
        "red",
        "blue",
        "green",
      ]);
      assertEquals([...suber.getOnItemIterAll("ledger", 0)], [
        [["ledger"], 0, "red"],
        [["ledger"], 0, "blue"],
        [["ledger"], 1, "green"],
      ]);
      assertEquals([...suber.getOnIterAll("ledger", 0)], [
        "red",
        "blue",
        "green",
      ]);
      assertEquals(suber.remOn("ledger", 0, "red"), true);
      assertEquals([...suber.getAllIter("ledger", 0)], ["blue", "green"]);
    } finally {
      yield* lmdber.close(true);
    }
  });
});

Deno.test("db/subing - OnIoSetSuber exposes normalized KERIpy-style methods and legacy aliases", async () => {
  await run(function*() {
    const lmdber = yield* createLMDBer({
      name: `onioset-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const suber = new OnIoSetSuber<string>(lmdber, { subkey: "sets." });
      assertEquals(suber.put("group", 0, ["a", "b"]), true);
      assertEquals(suber.add("group", 0, "b"), false);
      assertEquals(suber.add("group", 0, "c"), true);
      assertEquals(suber.putOn("group", 1, ["x", "y"]), true);
      assertEquals(suber.append("group", ["tail"]), 2);

      assertEquals(suber.getItem("group", 0), [
        [["group"], 0, "a"],
        [["group"], 0, "b"],
        [["group"], 0, "c"],
      ]);
      assertEquals(suber.get("group", 0), ["a", "b", "c"]);
      assertEquals([...suber.getItemIter("group", 0)], [
        [["group"], 0, "a"],
        [["group"], 0, "b"],
        [["group"], 0, "c"],
      ]);
      assertEquals([...suber.getIter("group", 0)], ["a", "b", "c"]);
      assertEquals(suber.getLastItem("group", 0), [["group"], 0, "c"]);
      assertEquals(suber.getLast("group", 0), "c");
      assertEquals(suber.cnt("group", 0), 3);
      assertEquals(suber.cntAll("group", 1), 3);
      assertEquals([...suber.getTopItemIter("group")], [
        [["group"], 0, "a"],
        [["group"], 0, "b"],
        [["group"], 0, "c"],
        [["group"], 1, "x"],
        [["group"], 1, "y"],
        [["group"], 2, "tail"],
      ]);
      assertEquals([...suber.getAllItemIter("group", 1)], [
        [["group"], 1, "x"],
        [["group"], 1, "y"],
        [["group"], 2, "tail"],
      ]);
      assertEquals([...suber.getAllIter("group", 1)], ["x", "y", "tail"]);
      assertEquals([...suber.getAllLastItemIter("group", 0)], [
        [["group"], 0, "c"],
        [["group"], 1, "y"],
        [["group"], 2, "tail"],
      ]);
      assertEquals([...suber.getAllLastIter("group", 0)], ["c", "y", "tail"]);
      assertEquals([...suber.getAllItemBackIter("group", 2)], [
        [["group"], 2, "tail"],
        [["group"], 1, "y"],
        [["group"], 1, "x"],
        [["group"], 0, "c"],
        [["group"], 0, "b"],
        [["group"], 0, "a"],
      ]);
      assertEquals([...suber.getAllBackIter("group", 2)], [
        "tail",
        "y",
        "x",
        "c",
        "b",
        "a",
      ]);
      assertEquals([...suber.getAllLastItemBackIter("group", 2)], [
        [["group"], 2, "tail"],
        [["group"], 1, "y"],
        [["group"], 0, "c"],
      ]);
      assertEquals([...suber.getAllLastBackIter("group", 2)], [
        "tail",
        "y",
        "c",
      ]);
      assertEquals(suber.rem("group", 0, "b"), true);
      assertEquals(suber.get("group", 0), ["a", "c"]);
      assertEquals(suber.remAll("group", 1), true);
      assertEquals(suber.cntAll("group", 0), 2);
      assertEquals([...suber.getOnTopItemIter("group")], [
        [["group"], 0, "a"],
        [["group"], 0, "c"],
      ]);
      assertEquals([...suber.getOnAllItemIter("group", 0)], [
        [["group"], 0, "a"],
        [["group"], 0, "c"],
      ]);
      assertEquals([...suber.getOnLastItemIter("group", 0)], [
        [["group"], 0, "c"],
      ]);
      assertEquals([...suber.getOnItemBackIter("group", 0)], [
        [["group"], 0, "c"],
        [["group"], 0, "a"],
      ]);
      assertEquals([...suber.getOnBackIter("group", 0)], ["c", "a"]);
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
