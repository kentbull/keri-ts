/**
 * `openWebWallet` on real IndexedDB with real Web Locks. Like the engine cases these run only in
 * the browser lane, where those two exist; the unit tests in `packages/wallet/test` cover the rest
 * with fakes.
 */

import { assert, assertEquals, assertRejects } from "jsr:@std/assert";
import { openWebWallet } from "../../../wallet/web.ts";
import { StoreLockHeldError } from "../../runtime-web.ts";
import { Roles } from "../../src/core/roles.ts";
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

/**
 * Whatever the engine answers, the result is well formed and never throws. An engine that holds
 * the request on a permission prompt (Firefox) answers nothing in automation; that is noted.
 */
async function persistentStorageShape(): Promise<void> {
  const pending = Symbol("pending");
  const asked = requestPersistentStorage();
  const result = await Promise.race([
    asked,
    new Promise<typeof pending>((resolve) => setTimeout(() => resolve(pending), 5000)),
  ]);
  if (result === pending) return note("persistent storage: request still pending after 5 s (permission prompt)");
  assertEquals(typeof result.persisted, "boolean");
  assertEquals(typeof result.supported, "boolean");
  for (const field of [result.quota, result.usage]) assert(field === undefined || typeof field === "number");
  note(`persistent storage: ${JSON.stringify(result)}`);
}

/**
 * A wallet polling a mailbox that has nothing to say must still close promptly and release its lock.
 * The runtime worker holds the idle poll's request; halting it is what `close()` waits for. WebKit
 * hung here until the HTTP client kept its in-flight request alive, so wait for a collection first.
 */
async function closeWithIdlePoll(): Promise<void> {
  const name = unique("wallet-idle-poll");
  const id = crypto.randomUUID();
  const first = await openWebWallet({ name, bran });
  const hab = first.hby.makeHab("main");
  const mailbox = first.hby.makeHab("mailbox", undefined, { transferable: false, ncount: 0 }).pre;
  first.hby.db.locs.pin([mailbox, "http"], { url: `${location.origin}/stall?mode=headers&id=${id}` });
  first.hby.db.ends.pin([hab.pre, Roles.mailbox, mailbox], { allowed: true });
  const state = async () => (await fetch(`${location.origin}/stall-state?id=${id}`)).json();
  for (let waited = 0; (await state()).opened === null; waited += 100) {
    assert(waited < 10_000, "the wallet never started polling the mailbox");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const started = performance.now();
  const closed = await Promise.race([
    first.close().then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5000)),
  ]);
  assert(closed, "close() did not finish while a mailbox poll was idle");
  note(`wallet close with an idle poll: ${Math.round(performance.now() - started)} ms`);
  for (let waited = 0; (await state()).closedAfter === null; waited += 100) {
    assert(waited < 3000, "the idle poll's connection stayed open after close()");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await (await openWebWallet({ name, bran })).close();
}

/** Register the wallet cases. */
export function registerWalletCases(): void {
  Deno.test("wallet: openWebWallet incepts, closes and reopens on real IndexedDB", inceptAndReload);
  Deno.test("wallet: a second openWebWallet on one identity is refused until the first closes", secondOpenRefused);
  Deno.test("wallet: close() finishes and frees the lock while a mailbox poll is idle", closeWithIdlePoll);
  Deno.test("wallet: requestPersistentStorage returns a well-formed result", persistentStorageShape);
}
