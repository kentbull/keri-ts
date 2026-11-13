/** `openWebWallet` composes lock, IndexedDB stores, runtime and barrier; fakes stand in for the browser. */
import { concatBytes, Counter, MtrDex, Signer, Vrsn_2_0 } from "cesr-ts";
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
  WalletStoppedError,
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

Deno.test("identifiers: inception and rotation complete as typed results and the alias is not reused", async () => {
  const w = await page().open();
  try {
    const incepted = await w.identifiers.incept({ alias: "main" });
    assertEquals([incepted.outcome, incepted.sn, incepted.status], ["complete", 0, { state: "complete" }]);
    const rotated = await w.identifiers.rotate(incepted.pre);
    assertEquals([rotated.outcome, rotated.sn, rotated.pre], ["complete", 1, incepted.pre]);
    assertEquals(w.identifiers.status(incepted.pre, 1), { state: "complete" });
    await assertRejects(() => w.identifiers.incept({ alias: "main" }), Error, "already exists");
    await assertRejects(() => w.identifiers.incept({ alias: "w", witnesses: [incepted.pre] }), Error, "toad");
    await assertRejects(() => w.identifiers.rotate("Eunknown"), Error, "not a local identifier");
  } finally {
    await w.close();
  }
});

Deno.test("an OOBI the network cannot serve is not reported resolved, and mailboxes need a resolved endpoint", async () => {
  const w = await page().open();
  try {
    const result = await w.oobis.resolve("http://127.0.0.1:1/oobi/Eabc/controller", { timeoutMs: 300 });
    assert(result.outcome === "failed" || result.outcome === "timed-out", JSON.stringify(result));
    const { pre } = await w.identifiers.incept({ alias: "main" });
    await assertRejects(() => w.mailboxes.add(pre, "Emailbox"), Error, "No endpoint URL");
    assertEquals(w.credentials.pending(), []);
    assertEquals(w.credentials.list(), { issued: [], held: [] });
  } finally {
    await w.close();
  }
});

Deno.test("health reports owner faults, and calls on a closed wallet are refused", async () => {
  const w = await page().open();
  assertEquals(w.health(), { status: "ok" });
  const health = w.runtime.operations!.health;
  health.faults = 1;
  health.last = { owner: "issuance", error: "boom", at: "2026-01-01T00:00:00.000Z" };
  assertEquals(w.health(), { status: "faulted", faults: 1, last: health.last });
  await w.close();
  assertEquals(w.health(), { status: "closed" });
  await assertRejects(() => w.identifiers.incept({ alias: "late" }), WalletStoppedError);
});

Deno.test("presentation, Unblind, Admit resend and mailbox removal are wired and refuse what they cannot do", async () => {
  const w = await page().open();
  try {
    const a = await w.identifiers.incept({ alias: "a" }), b = await w.identifiers.incept({ alias: "b" });
    // Presentation selects from the wallet's inventory.
    const views = w.runtime.operations!.presentation.deps.views;
    assert(views);
    assertEquals(views.issuedRegistry("Eunknown"), undefined);
    assertEquals(w.credentials.presentations(), []);
    const applied = await w.credentials.requestProof(a.pre, { message: "", recipient: b.pre, plan: [] }, {
      timeoutMs: 300,
    });
    assertEquals(applied.status.verb, "apply");
    assertEquals(applied.recipient, b.pre);
    assertEquals(w.credentials.presentationStatus(applied.said).verb, "apply");
    await assertRejects(() => w.credentials.unblind("Eunknown"), Error, "not addressed to a local identifier");
    await assertRejects(() => w.credentials.resendAdmit("Eunknown"), Error, "has not admitted");
    await assertRejects(() => w.mailboxes.remove(a.pre, "Emailbox"), Error, "No endpoint URL");
  } finally {
    await w.close();
  }
});

Deno.test("groups and proposals: refusals, an empty consent list, and a group inception that needs its co-members' endpoints", async () => {
  const first = await page().open({ name: "member-a" }), second = await page().open({ name: "member-b" });
  try {
    const a = await first.identifiers.incept({ alias: "a" }), b = await second.identifiers.incept({ alias: "b" });
    assertEquals(first.proposals.list(), []);
    assertEquals(first.proposals.dismiss("Eunknown"), 0);
    await assertRejects(() => first.proposals.approve("Eunknown"), Error, "No group proposal");
    await assertRejects(() => first.groups.rotate(a.pre), Error, "not a local group");
    await assertRejects(() => first.groups.join("Eunknown", { alias: "g" }), Error, "not a proposal to join");
    await assertRejects(() => first.groups.inceptRegistry("Eunknown", "r"), Error, "not a local group");
    await assertRejects(
      () => first.groups.incept({ alias: "a", member: a.pre, smids: [a.pre, b.pre] }),
      Error,
      "already exists",
    );
    assertEquals(first.credentials.pending(), []);

    // The proposer knows its co-member's key state, as it would after resolving the co-member's OOBI.
    for (const wire of second.hby.db.clonePreIter(b.pre, 0, Vrsn_2_0)) {
      await run(function*() {
        yield* first.runtime.reactor.processBytes(concatBytes(Counter.makeGVC(Vrsn_2_0), wire));
      });
    }
    // The library signs this member's contribution, then needs a route to every co-member to publish the proposal.
    // A co-member whose endpoint roles are unknown is a refusal, not a wait; the group stays held locally.
    await assertRejects(
      () => first.groups.incept({ alias: "pair", member: a.pre, smids: [a.pre, b.pre], timeoutMs: 200 }),
      Error,
      "No end roles",
    );
    const held = first.hby.habByName("pair");
    assert(held, "the proposer holds the group habitat");
  } finally {
    await first.close();
    await second.close();
  }
});
