import { type Operation, run } from "effection";
import { assert, assertEquals, assertThrows } from "jsr:@std/assert";
import { b, Cigar, Encrypter, MtrDex, Siger, Signer, t, Verfer } from "../../../../../cesr/mod.ts";
import { branToSeedAeid } from "../../../../src/app/identity/habbing.ts";
import { Manager } from "../../../../src/app/identity/keeping.ts";
import { MemStoreOpener } from "../../../../src/db/core/memstore.ts";
import { openOwner } from "../../../../src/db/core/store-owner.ts";
import { Keeper } from "../../../../src/db/keeping.ts";

const salt = "0AAwMTIzNDU2Nzg5YWJjZGVm";
const first = branToSeedAeid("MyPasscodeARealSecret");
const second = branToSeedAeid("AnotherPasscodeSecretX");
const message = b("held signer proof");

/** Open a Keeper on the in-memory backend, whose contents survive close and reopen of one instance. */
function* openKeeper(): Operation<Keeper> {
  const identity = { name: crypto.randomUUID(), temp: true, reopen: true };
  return yield* openOwner(
    new Keeper(new MemStoreOpener().create(Keeper.Family, identity)),
    "Keeper",
    identity,
  );
}

/** A fresh Ed25519 signer with the explicit transferability a key list would use. */
function signerOf(transferable: boolean): Signer {
  return Signer.random({ code: MtrDex.Ed25519_Seed, transferable });
}

/** Every physical row of every table the Keeper binds, as comparable text. */
function allRows(ks: Keeper): { table: string; key: Uint8Array; value: Uint8Array }[] {
  const seen = new Set<unknown>();
  const rows: { table: string; key: Uint8Array; value: Uint8Array }[] = [];
  for (const [field, owner] of Object.entries(ks)) {
    const table = (owner as { sdb?: unknown } | null)?.sdb;
    if (!table || seen.has(table)) continue;
    seen.add(table);
    for (const { key, value } of ks.store.scan(table as never)) rows.push({ table: field, key, value });
  }
  // The scan must really span the keeper, or "nothing found" proves nothing.
  const tables = new Set(rows.map((row) => row.table));
  for (const needed of ["gbls", "prms", "pris", "sits", "pubs"]) assert(tables.has(needed), `${needed} not scanned`);
  return rows;
}

function contains(haystack: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let at = 0; at + needle.length <= haystack.length; at++) {
    for (let i = 0; i < needle.length; i++) if (haystack[at + i] !== needle[i]) continue outer;
    return true;
  }
  return false;
}

/** Table names of rows whose key or value contains the signer's seed (text or raw) or public key (text or raw). */
function leaks(ks: Keeper, signer: Signer): string[] {
  const needles = [signer.qb64b, signer.raw, signer.verfer.qb64b, signer.verfer.raw];
  return allRows(ks)
    .filter((row) => needles.some((needle) => contains(row.key, needle) || contains(row.value, needle)))
    .map((row) => row.table);
}

/** Byte-exact snapshot of the whole Keeper, to prove an operation wrote nothing. */
function snapshot(ks: Keeper): string[] {
  return allRows(ks).map((row) => `${row.table}|${t(row.key)}|${Array.from(row.value).join(",")}`).sort();
}

function failureOf(fn: () => unknown): Error {
  try {
    fn();
  } catch (error) {
    return error as Error;
  }
  throw new Error("Expected a failure");
}

Deno.test("held signer signs through pubs and verfers and writes nothing to the Keeper", async () => {
  await run(function*() {
    const ks = yield* openKeeper();
    try {
      const manager = new Manager({ ks, salt });
      manager.incept({ icount: 1, ncount: 1, transferable: true, temp: true });
      const before = snapshot(ks);
      for (const transferable of [true, false]) {
        const signer = signerOf(transferable);
        manager.hold([signer]);
        const pub = signer.verfer.qb64;
        assertEquals(pub[0], transferable ? "D" : "B");

        const [byPubs] = manager.sign(message, [pub], true);
        assertEquals(byPubs.index, 0);
        assert(signer.verfer.verify(byPubs.raw, message));

        const [byVerfers] = manager.sign(message, { verfers: [signer.verfer], indexed: true, indices: [3] }) as Siger[];
        assertEquals(byVerfers.index, 3);
        assert(signer.verfer.verify(byVerfers.raw, message));

        const [cigar] = manager.sign(message, [pub], false) as Cigar[];
        assert(signer.verfer.verify(cigar.raw, message));
      }
      assertEquals(snapshot(ks), before);
    } finally {
      yield* ks.close(true);
    }
  });
});

Deno.test("a held key is matched only by the encoding it was held under", async () => {
  await run(function*() {
    const ks = yield* openKeeper();
    try {
      const manager = new Manager({ ks, salt });
      const raw = crypto.getRandomValues(new Uint8Array(32));
      const asTransferable = new Signer({ code: MtrDex.Ed25519_Seed, raw, transferable: true });
      const asNonTransferable = new Signer({ code: MtrDex.Ed25519_Seed, raw, transferable: false });
      assertEquals(asTransferable.verfer.raw, asNonTransferable.verfer.raw);
      assert(asTransferable.verfer.qb64 !== asNonTransferable.verfer.qb64);

      manager.hold([asTransferable]);
      assertEquals(manager.sign(message, [asTransferable.verfer.qb64], true).length, 1);
      assertThrows(
        () => manager.sign(message, [asNonTransferable.verfer.qb64], true),
        Error,
        `Missing prikey in db for pubkey=${asNonTransferable.verfer.qb64}`,
      );

      manager.release();
      manager.hold([asNonTransferable]);
      assertEquals(manager.sign(message, [asNonTransferable.verfer.qb64], true).length, 1);
      assertThrows(
        () => manager.sign(message, [asTransferable.verfer.qb64], true),
        Error,
        `Missing prikey in db for pubkey=${asTransferable.verfer.qb64}`,
      );
    } finally {
      yield* ks.close(true);
    }
  });
});

Deno.test("held signer decrypts and opens ESSR ciphertext sealed to its key", async () => {
  await run(function*() {
    const ks = yield* openKeeper();
    try {
      const manager = new Manager({ ks, salt });
      for (const transferable of [true, false]) {
        const signer = signerOf(transferable);
        const encrypter = new Encrypter({ verkey: signer.verfer.qb64 });
        const cipher = encrypter.encrypt({ ser: b("sealed to the held key") });

        assertThrows(() => manager.decrypt(cipher.qb64, { pubs: [signer.verfer.qb64] }), Error, "Missing prikey");
        manager.hold([signer]);
        assertEquals(t(manager.decrypt(cipher.qb64, { pubs: [signer.verfer.qb64] })), "sealed to the held key");
        assertEquals(t(manager.decrypt(cipher.qb64, { verfers: [signer.verfer] })), "sealed to the held key");
        assertEquals(t(manager.open(cipher.raw, signer.verfer)!), "sealed to the held key");

        const stranger = signerOf(transferable);
        const foreign = new Encrypter({ verkey: stranger.verfer.qb64 }).encrypt({ ser: b("not for us") });
        assertEquals(manager.open(foreign.raw, signer.verfer), null);

        manager.release([signer.verfer.qb64]);
        assertThrows(() => manager.open(cipher.raw, signer.verfer), Error, "Missing prikey");
      }
    } finally {
      yield* ks.close(true);
    }
  });
});

Deno.test("a held signer is consulted before the stored key with the same public key", async () => {
  await run(function*() {
    const ks = yield* openKeeper();
    try {
      const manager = new Manager({ ks, salt });
      const [verfers] = manager.incept({ icount: 1, ncount: 1, transferable: true, temp: true });
      const pub = verfers[0].qb64;
      const real = ks.pris.get(pub)!;
      assert(real.verfer.verify(manager.sign(message, [pub], false)[0].raw, message));

      // Corrupt the stored row so the Keeper's answer for this pub is observably wrong.
      ks.pris.pin(pub, signerOf(true));
      assert(!real.verfer.verify(manager.sign(message, [pub], false)[0].raw, message));

      let reads = 0;
      const get = ks.pris.get;
      ks.pris.get = function(...args) {
        reads++;
        return get.apply(this, args);
      };
      manager.hold([real]);
      assert(real.verfer.verify(manager.sign(message, [pub], false)[0].raw, message));
      assertEquals(reads, 0);

      manager.release();
      assert(!real.verfer.verify(manager.sign(message, [pub], false)[0].raw, message));
      assertEquals(reads, 1);
    } finally {
      yield* ks.close(true);
    }
  });
});

Deno.test("no Keeper row holds a held key's seed or public key, and the scan can see a stored one", async () => {
  await run(function*() {
    for (const keys of [{ seed: "", aeid: "" }, first]) {
      const ks = yield* openKeeper();
      try {
        const manager = new Manager({ ks, salt, ...keys });
        const [verfers] = manager.incept({ icount: 1, ncount: 1, transferable: true, temp: true });
        const stored = verfers[0].qb64;
        const held = signerOf(true);
        const before = snapshot(ks);

        manager.hold([held]);
        manager.sign(message, [held.verfer.qb64], true);
        manager.decrypt(new Encrypter({ verkey: held.verfer.qb64 }).encrypt({ ser: b("x") }).qb64, {
          pubs: [held.verfer.qb64],
        });

        assertEquals(snapshot(ks), before);
        assertEquals(leaks(ks, held), []);
        // Control: the same scan finds the stored key's public key where a stored key has one.
        const found = allRows(ks).filter((row) => contains(row.key, b(stored)) || contains(row.value, b(stored)));
        assert(found.some((row) => row.table === "pubs"));
        assert(found.some((row) => row.table === "pris"));
        if (!keys.aeid) assert(leaks(ks, ks.pris.get(stored)!).includes("pris"));
      } finally {
        yield* ks.close(true);
      }
    }
  });
});

Deno.test("release restores the missing-key failure exactly, in whole or in part", async () => {
  await run(function*() {
    const ks = yield* openKeeper();
    try {
      const manager = new Manager({ ks, salt });
      const [one, two, three] = [signerOf(true), signerOf(true), signerOf(false)];
      const never = new Manager({ ks, salt });

      manager.hold([one, two, three]);
      manager.release([one.verfer.qb64, "DUnheldKeyIgnored"]);
      const expected = failureOf(() => never.sign(message, [one.verfer.qb64], true));
      const released = failureOf(() => manager.sign(message, [one.verfer.qb64], true));
      assertEquals(released.constructor, expected.constructor);
      assertEquals(released.message, expected.message);
      assertEquals(released.message, `Missing prikey in db for pubkey=${one.verfer.qb64}`);
      assertEquals(manager.sign(message, [two.verfer.qb64, three.verfer.qb64], true).length, 2);

      manager.release([]);
      assertEquals(manager.sign(message, [two.verfer.qb64], true).length, 1);
      manager.release();
      for (const signer of [two, three]) {
        assertThrows(() => manager.sign(message, [signer.verfer.qb64], true), Error, "Missing prikey in db");
      }
    } finally {
      yield* ks.close(true);
    }
  });
});

Deno.test("hold validates the whole batch before holding any of it", async () => {
  await run(function*() {
    const ks = yield* openKeeper();
    try {
      const manager = new Manager({ ks, salt });
      const good = signerOf(true);
      assertThrows(() => manager.hold([good, { verfer: new Verfer({ qb64: good.verfer.qb64 }) } as Signer]), Error);
      assertThrows(() => manager.sign(message, [good.verfer.qb64], true), Error, "Missing prikey");
    } finally {
      yield* ks.close(true);
    }
  });
});

Deno.test("holds do not survive a reopen of the Keeper under a new Manager", async () => {
  await run(function*() {
    const ks = yield* openKeeper();
    try {
      const manager = new Manager({ ks, salt, ...first });
      const [verfers] = manager.incept({ icount: 1, ncount: 1, transferable: true, temp: true });
      const held = signerOf(true);
      manager.hold([held]);
      assertEquals(manager.sign(message, [held.verfer.qb64], true).length, 1);

      yield* ks.close();
      assert(yield* ks.reopen({ temp: true, reuse: true }));
      const reopened = new Manager({ ks, ...first });
      assertEquals(reopened.sign(message, [verfers[0].qb64], true).length, 1);
      assertThrows(
        () => reopened.sign(message, [held.verfer.qb64], true),
        Error,
        `Missing prikey in db for pubkey=${held.verfer.qb64}`,
      );
      reopened.hold([held]);
      assertEquals(reopened.sign(message, [held.verfer.qb64], true).length, 1);
    } finally {
      yield* ks.close(true);
    }
  });
});

Deno.test("an AEID change re-encrypts stored keys, leaves holds working and stores nothing", async () => {
  await run(function*() {
    const ks = yield* openKeeper();
    try {
      const manager = new Manager({ ks, salt, ...first });
      const [verfers] = manager.incept({ icount: 1, ncount: 1, transferable: true, temp: true });
      const stored = verfers[0].qb64;
      const held = signerOf(true);
      manager.hold([held]);

      const before = snapshot(ks);
      manager.updateAeid(second.aeid, second.seed);
      assert(snapshot(ks).join() !== before.join(), "stored keys were re-encrypted");

      const [heldSig] = manager.sign(message, [held.verfer.qb64], true);
      assert(held.verfer.verify(heldSig.raw, message));
      const [storedSig] = manager.sign(message, [stored], true);
      assert(verfers[0].verify(storedSig.raw, message));
      assertEquals(leaks(ks, held), []);

      // Holding after the change behaves the same.
      const later = signerOf(false);
      manager.hold([later]);
      assertEquals(manager.sign(message, [later.verfer.qb64], true).length, 1);
      assertEquals(leaks(ks, later), []);
    } finally {
      yield* ks.close(true);
    }
  });
});
