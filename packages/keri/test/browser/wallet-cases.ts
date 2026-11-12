/**
 * `openWebWallet` on real IndexedDB with real Web Locks. Like the engine cases these run only in
 * the browser lane, where those two exist; the unit tests in `packages/wallet/test` cover the rest
 * with fakes.
 */

import { assert, assertEquals, assertRejects } from "jsr:@std/assert";
import { openWebWallet } from "../../../wallet/web.ts";
import { StoreLockHeldError } from "../../runtime-web.ts";
import { requestPersistentStorage } from "../../src/runtime/web/persistent-storage.ts";
import { note } from "./notes.ts";

const unique = (label: string) => `${label}-${crypto.randomUUID()}`;
const bran = "0123456789abcdefghijk";

/** Incept, close, reopen and read the identifier and an inventory row back. */
async function inceptAndReload(): Promise<void> {
  const name = unique("wallet-reload");
  const first = await openWebWallet({ name, bran });
  const pre = first.hby.makeHab("main").pre;
  first.inventory.credentials.pin(["k"], "v");
  await first.close();

  const second = await openWebWallet({ name, bran });
  try {
    assertEquals(second.hby.habByName("main")?.pre, pre);
    assertEquals(second.inventory.credentials.get(["k"]), "v");
    assertEquals(second.health(), { status: "ok" });
  } finally {
    await second.close();
  }
}

/** The page's own Web Locks refuse a second open of one identity until the first closes. */
async function secondOpenRefused(): Promise<void> {
  const name = unique("wallet-lock");
  const first = await openWebWallet({ name, bran });
  try {
    await assertRejects(() => openWebWallet({ name, bran }), StoreLockHeldError);
  } finally {
    await first.close();
  }
  await (await openWebWallet({ name, bran })).close();
}

/** Whatever the engine answers, the result is well formed and never throws. */
async function persistentStorageShape(): Promise<void> {
  const result = await requestPersistentStorage();
  assertEquals(typeof result.persisted, "boolean");
  assertEquals(typeof result.supported, "boolean");
  for (const field of [result.quota, result.usage]) assert(field === undefined || typeof field === "number");
  note(`persistent storage: ${JSON.stringify(result)}`);
}

/** Register the wallet cases. */
export function registerWalletCases(): void {
  Deno.test("wallet: openWebWallet incepts, closes and reopens on real IndexedDB", inceptAndReload);
  Deno.test("wallet: a second openWebWallet on one identity is refused until the first closes", secondOpenRefused);
  Deno.test("wallet: requestPersistentStorage returns a well-formed result", persistentStorageShape);
}
