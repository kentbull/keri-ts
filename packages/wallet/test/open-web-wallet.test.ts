/** `openWebWallet` composes lock, IndexedDB stores, runtime and barrier; fakes stand in for the browser. */
import { MtrDex, Signer } from "cesr-ts";
import { type Operation, run } from "effection";
import { assert, assertEquals, assertInstanceOf, assertRejects } from "jsr:@std/assert";
import type { HttpClient, HttpResponse, HttpStreamResponse } from "keri-ts/runtime";
import { StoreLockHeldError, type StoreLockManager, StoreLockUnsupportedError } from "keri-ts/runtime/web";
import { IDBFactory, IDBKeyRange } from "npm:fake-indexeddb@6.2.5";
import {
  openWebWallet,
  type OpenWebWalletOptions,
  UnencryptedKeeperError,
  WALLET_KRAM_CACHES,
  type WebWallet,
} from "../web.ts";

const keyRange = IDBKeyRange as unknown as typeof globalThis.IDBKeyRange;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** An IDBFactory whose read-write transactions throw once `poison.on` is set. */
function poisonable(poison: { on: boolean }): IDBFactory {
  return new class extends IDBFactory {
    override open(name: string, version?: number) {
      const request = super.open(name, version);
      request.addEventListener("success", () => {
        const db = request.result as IDBDatabase;
        const transaction = db.transaction.bind(db) as (...args: unknown[]) => IDBTransaction;
        (db as unknown as { transaction: unknown }).transaction = (...args: unknown[]) => {
          if (poison.on && args[1] === "readwrite") throw new DOMException("quota", "QuotaExceededError");
          return transaction(...args);
        };
      });
      return request;
    }
  }() as unknown as IDBFactory;
}

/** One page: shared lock manager and IndexedDB, with hooks to observe lock release. */
function page() {
  const poison = { on: false };
  const factory = poisonable(poison);
  const held = new Set<string>();
  const log: string[] = [];
  let onRelease = () => {};
  const locks: StoreLockManager = {
    async request(name, _options, callback) {
      if (held.has(name)) return await callback(null);
      held.add(name);
      try {
        return await callback({});
      } finally {
        onRelease();
        held.delete(name);
      }
    },
  };
  const sent: string[] = [];
  const http: HttpClient = {
    *request(url): Operation<HttpResponse> {
      sent.push(url);
      return { status: 404, ok: false, headers: new Headers(), body: new Uint8Array() };
    },
    *open(url): Operation<HttpStreamResponse> {
      sent.push(url);
      return { status: 404, ok: false, headers: new Headers(), body: async function*() {} };
    },
  };
  const lifecycle = {
    page: new EventTarget(),
    document: Object.assign(new EventTarget(), { visibilityState: "visible" }),
  };
  const open = (extra: Partial<OpenWebWalletOptions> = {}) =>
    openWebWallet({
      name: "alice",
      bran: "0123456789abcdefghijk",
      host: {
        indexedDb: { factory, keyRange },
        locks,
        storage: { persist: () => Promise.resolve(true) },
        http,
        lifecycle,
      },
      ...extra,
    } as OpenWebWalletOptions);
  return { open, poison, held, log, sent, lifecycle, whenReleased: (fn: () => void) => onRelease = fn };
}

Deno.test("reload: close and reopen with a fresh opener returns identifiers and wallet inventory", async () => {
  const p = page();
  const first = await p.open();
  assertEquals((await first.storage).persisted, true);
  const pre = first.hby.makeHab("main").pre;
  first.inventory.credentials.pin(["k"], "v");
  await first.close();

  const second = await p.open();
  try {
    assert(second.opener !== first.opener);
    assertEquals(second.hby.habByName("main")?.pre, pre);
    assertEquals(second.inventory.credentials.get(["k"]), "v");
    assertEquals(second.health(), { status: "ok" });
  } finally {
    await second.close();
  }
});

Deno.test("a second opener of the same identity is refused until the first closes", async () => {
  const p = page();
  const first = await p.open();
  await assertRejects(() => p.open(), StoreLockHeldError);
  await first.close();
  await (await p.open()).close();
});

Deno.test("no Web Locks fails closed", async () => {
  const p = page();
  await assertRejects(
    () =>
      p.open({ host: { indexedDb: { factory: new IDBFactory() as unknown as IDBFactory, keyRange }, locks: null } }),
    StoreLockUnsupportedError,
  );
});

Deno.test("an unencrypted keeper is refused without a passcode, or a seed without its AEID, and the lock stays free", async () => {
  const p = page();
  await assertRejects(
    () => p.open({ bran: undefined } as unknown as Partial<OpenWebWalletOptions>),
    UnencryptedKeeperError,
  );
  assertEquals(p.held.size, 0);
  const seed = new Signer({ raw: crypto.getRandomValues(new Uint8Array(32)), code: MtrDex.Ed25519_Seed }).qb64;
  const noAeid = { bran: undefined, seed } as unknown as Partial<OpenWebWalletOptions>;
  await assertRejects(() => p.open(noAeid), UnencryptedKeeperError);
  assertEquals(p.held.size, 0);
  await (await p.open()).close();
});

Deno.test("a runtime request waits for the persistence flush", async () => {
  const p = page();
  const w = await p.open();
  try {
    let release!: () => void;
    w.opener.queue.enqueue(() => new Promise<void>((resolve) => release = resolve));
    w.runtime.oobiery.resolve("http://witness.test/oobi/EAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    await sleep(300);
    assertEquals(p.sent, [], "nothing leaves before the queue flushes");
    release();
    for (let i = 0; i < 50 && p.sent.length === 0; i++) await sleep(50);
    assertEquals(p.sent.length > 0, true, "the request is released after the flush");
  } finally {
    await w.close();
  }
});

Deno.test("close stops everything, closes stores, then releases the lock", async () => {
  const p = page();
  const w = await p.open();
  const state = () => [w.hby.db.opened, w.hby.ks.opened, w.inventory.opened, w.runtime.noter?.opened ?? false];
  assertEquals(state(), [true, true, true, true]);
  p.whenReleased(() => p.log.push(`released with stores open: ${state()}`));
  await w.close();
  await w.close();
  assertEquals(p.log, ["released with stores open: false,false,false,false"]);
});

Deno.test("pagehide and hidden visibilitychange request a flush; close removes the handlers", async () => {
  const p = page();
  const w = await p.open();
  const flushes: string[] = [];
  const flushed = w.hby.db.flushed.bind(w.hby.db);
  w.hby.db.flushed = () => (flushes.push("flush"), flushed());
  p.lifecycle.page.dispatchEvent(new Event("pagehide"));
  p.lifecycle.document.dispatchEvent(new Event("visibilitychange"));
  assertEquals(flushes.length, 1, "visible does not flush");
  p.lifecycle.document.visibilityState = "hidden";
  p.lifecycle.document.dispatchEvent(new Event("visibilitychange"));
  assertEquals(flushes.length, 2);
  await w.close();
  p.lifecycle.page.dispatchEvent(new Event("pagehide"));
  assertEquals(flushes.length, 2);
});

Deno.test("a failed write latches; close reports it and reopen sees exactly the last durable state", async () => {
  const p = page();
  const first = await p.open();
  first.inventory.credentials.pin(["durable"], "yes");
  await run(() => first.opener.queue.flushed());
  assertEquals(first.health(), { status: "ok" });

  p.poison.on = true;
  first.inventory.credentials.pin(["lost"], "no");
  await assertRejects(() => run(() => first.opener.queue.flushed()));
  const health = first.health();
  assertEquals(health.status, "latched");
  assertInstanceOf((health as { cause: unknown }).cause, DOMException);
  p.poison.on = false;
  await assertRejects(() => first.close());
  assertEquals(p.held.size, 0, "the lock is released although close failed");

  const second: WebWallet = await p.open();
  try {
    assertEquals(second.inventory.credentials.get(["durable"]), "yes");
    assertEquals(second.inventory.credentials.get(["lost"]), null);
    assertEquals(second.health(), { status: "ok" });
  } finally {
    await second.close();
  }
});

Deno.test("a new web wallet installs the loose mailbox KRAM windows: 5 minute drift, 24 hour lags and pruning", async () => {
  const wallet = await page().open();
  try {
    const day = 86_400_000;
    assertEquals(WALLET_KRAM_CACHES["~"], [300_000, day, day, day, day, day, day]);
    const row = wallet.hby.db.ctyp.get("~")!;
    assertEquals([row.d, row.sl, row.ll, row.xl, row.psl, row.pll, row.pxl], [300_000, day, day, day, day, day, day]);
  } finally {
    await wallet.close();
  }
});
