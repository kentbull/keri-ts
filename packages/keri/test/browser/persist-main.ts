/**
 * Browser entry of the persistent-profile lane (`scripts/run_browser_persist.ts`).
 *
 * The lane writes in one browser launch and verifies in a second launch on the same profile directory, so
 * reads come from the engine's on-disk IndexedDB rather than a live connection or an in-memory backend.
 * `write` stores a keeper-shaped store (`gbls.` rows, 100 deterministic 89-byte `rroots.` keys, a dupsort
 * table) and a web wallet with one identifier; `verify` reopens both and checks every row.
 */

import { b } from "cesr-ts";
import { assert, assertEquals } from "jsr:@std/assert";
import { run } from "npm:effection@^3.6.0";
import { openWebWallet } from "../../../wallet/web.ts";
import { indexedDbOpener } from "../../db-indexeddb.ts";
import type { WebDBer } from "../../src/db/core/webdber.ts";

const STORE_NAME = "persist-keeper";
const WALLET_NAME = "persist-wallet";
const BRAN = "0123456789abcdefghijk";
const ROOTS = 100;
const GBLS: ReadonlyArray<readonly [string, string]> = [
  ["aeid", "BAeidAeidAeidAeidAeidAeidAeidAeidAeidAeidAeid"],
  ["pidx", "0"],
  ["algo", "salty"],
  ["salt", "salt-value"],
  ["tier", "low"],
];
const DUPS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["a", ["one", "two", "three"]],
  ["a.b", ["x"]],
  ["c", ["p", "q"]],
];

/** An 89-byte key, the width of a registry-root key, distinct per `index` and the same in every run. */
function rootKey(index: number): Uint8Array {
  return Uint8Array.from({ length: 89 }, (_, at) => (index * 31 + at * 7 + (at === 0 ? 0 : index)) & 0xff);
}

/** A value distinct per `index`. */
function rootValue(index: number): Uint8Array {
  return Uint8Array.from({ length: 24 }, (_, at) => (index * 13 + at * 5) & 0xff);
}

async function openKeeperShaped(): Promise<WebDBer> {
  const store = indexedDbOpener().create({ tail: "ks" }, { name: STORE_NAME });
  await run(() => store.reopen());
  return store;
}

/** Write the keeper-shaped store, then a wallet with one identifier; both are closed, hence flushed. */
async function write(): Promise<string> {
  const store = await openKeeperShaped();
  const gbls = store.openTable("gbls.");
  const rroots = store.openTable("rroots.");
  const dups = store.openTable("dups.", { dupsort: true });
  store.transaction(() => {
    for (const [key, value] of GBLS) store.setVal(gbls, b(key), b(value));
    for (let index = 0; index < ROOTS; index++) store.setVal(rroots, rootKey(index), rootValue(index));
    for (const [key, values] of DUPS) store.putVals(dups, b(key), values.map((value) => b(value)));
  });
  await run(() => store.close());

  const wallet = await openWebWallet({ name: WALLET_NAME, bran: BRAN, delivery: "direct" });
  const pre = wallet.hby.makeHab("main").pre;
  await wallet.close();
  return pre;
}

/** Reopen both stores and check every row; throws on the first difference. */
async function verify(pre: string): Promise<string> {
  const store = await openKeeperShaped();
  try {
    const gbls = store.openTable("gbls.");
    for (const [key, value] of GBLS) {
      const got = store.getVal(gbls, b(key));
      assertEquals(got && new TextDecoder().decode(got), value, `gbls.${key} survived the relaunch`);
    }
    const rroots = store.openTable("rroots.");
    for (let index = 0; index < ROOTS; index++) {
      assertEquals(store.getVal(rroots, rootKey(index)), rootValue(index), `rroots. row ${index} survived`);
    }
    assertEquals(store.cnt(rroots), ROOTS, "no extra rroots. rows");
    const dups = store.openTable("dups.", { dupsort: true });
    for (const [key, values] of DUPS) {
      const got = store.getVals(dups, b(key)).map((value) => new TextDecoder().decode(value)).sort();
      assertEquals(got, [...values].sort(), `duplicates of ${key} survived`);
    }
  } finally {
    await run(() => store.close());
  }
  const wallet = await openWebWallet({ name: WALLET_NAME, bran: BRAN, delivery: "direct" });
  try {
    assertEquals(wallet.hby.habByName("main")?.pre, pre, "the wallet reopened with its identifier");
    assert(wallet.health().status === "ok", "the reopened wallet is healthy");
  } finally {
    await wallet.close();
  }
  return `${GBLS.length} gbls rows, ${ROOTS} rroots rows, dupsort table, wallet ${pre}`;
}

export interface KeriPersist {
  write(): Promise<string>;
  verify(pre: string): Promise<string>;
}

(globalThis as unknown as { keriPersist: KeriPersist }).keriPersist = { write, verify };
