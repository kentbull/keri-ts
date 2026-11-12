import { assertEquals, assertInstanceOf, assertRejects } from "jsr:@std/assert";
import {
  acquireStoreLock,
  StoreLockHeldError,
  storeLockKey,
  type StoreLockManager,
  StoreLockUnsupportedError,
} from "../../../../runtime-web.ts";

/** A single-process lock manager honouring exclusive + ifAvailable. */
function fakeLocks(): StoreLockManager & { held: Set<string> } {
  const held = new Set<string>();
  return {
    held,
    async request(name, options, callback) {
      assertEquals(options, { mode: "exclusive", ifAvailable: true });
      if (held.has(name)) return await callback(null);
      held.add(name);
      try {
        return await callback({ name });
      } finally {
        held.delete(name);
      }
    },
  };
}

const identity = { base: "wallets", name: "alice" };

Deno.test("store lock key covers base and name but not the store family", () => {
  assertEquals(storeLockKey(identity), "keri-ts:store:[\"wallets\",\"alice\",\"durable\"]");
  assertEquals(storeLockKey({ name: "x", temp: true }), "keri-ts:store:[\"\",\"x\",\"temp\"]");
});

Deno.test("store lock is exclusive and reusable after release", async () => {
  const locks = fakeLocks();
  const first = await acquireStoreLock(identity, { locks });
  assertEquals(locks.held.has(first.key), true);

  const error = await assertRejects(() => acquireStoreLock(identity, { locks }), StoreLockHeldError);
  assertEquals([error.key, error.storeName, error.storeBase], [first.key, "alice", "wallets"]);
  await acquireStoreLock({ name: "bob" }, { locks });

  await first.release();
  await first.release();
  assertEquals(locks.held.has(first.key), false);
  await (await acquireStoreLock(identity, { locks })).release();
});

Deno.test("store lock fails closed when the Web Locks API is absent", async () => {
  const error = await assertRejects(
    () => acquireStoreLock(identity, { locks: null }),
    StoreLockUnsupportedError,
  );
  assertEquals(error instanceof StoreLockHeldError, false);
  assertInstanceOf(error, Error);
});

Deno.test("store lock surfaces a failing lock manager", async () => {
  const locks: StoreLockManager = { request: () => Promise.reject(new Error("SecurityError")) };
  await assertRejects(() => acquireStoreLock(identity, { locks }), Error, "SecurityError");
});
