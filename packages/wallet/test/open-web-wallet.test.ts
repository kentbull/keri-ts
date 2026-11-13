/** `openWebWallet` composes lock, IndexedDB stores, runtime and barrier; fakes stand in for the browser. */
import {
  concatBytes,
  Counter,
  Matter,
  MtrDex,
  Saider,
  Salter,
  type SerderKERI,
  type Siger,
  Signer,
  Vrsn_2_0,
} from "cesr-ts";
import { type Operation, run } from "effection";
import { assert, assertEquals, assertInstanceOf, assertRejects, assertThrows } from "jsr:@std/assert";
import {
  type ChangeSink,
  DatabaseNotOpenError,
  type Habery,
  openHabery,
  PersistenceLatchedError,
  PersistenceReadError,
  processCuesOnce,
  type RuntimeChange,
  Schemer,
  ValidationError,
} from "keri-ts/runtime";
import type { HttpClient, HttpResponse, HttpStreamResponse } from "keri-ts/runtime";
import { StoreLockHeldError, type StoreLockManager, StoreLockUnsupportedError } from "keri-ts/runtime/web";
import { IDBFactory, IDBKeyRange } from "npm:fake-indexeddb@6.2.5";
import { exchange, incept } from "../../keri/src/core/protocol-eventing.ts";
import { messagize } from "../../keri/src/core/protocol-serialization.ts";
import { dgKey } from "../../keri/src/db/core/keys.ts";
import { MemStoreOpener } from "../../keri/src/db/core/memstore.ts";
import { makeNowIso8601 } from "../../keri/src/time/mod.ts";
import {
  KeeperSaltMismatchError,
  openWebWallet,
  type OpenWebWalletOptions,
  recoverWebWallet,
  UnencryptedKeeperError,
  WALLET_KRAM_CACHES,
  WalletRecoveryError,
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
  const host = {
    indexedDb: { factory, keyRange },
    locks,
    storage: { persist: () => Promise.resolve(true) },
    http,
    lifecycle,
  };
  const options = (extra: Partial<OpenWebWalletOptions> = {}) =>
    ({ name: "alice", bran: "0123456789abcdefghijk", host, ...extra }) as OpenWebWalletOptions;
  const open = (extra: Partial<OpenWebWalletOptions> = {}) => openWebWallet(options(extra));
  return {
    open,
    options,
    host,
    poison,
    held,
    log,
    sent,
    lifecycle,
    whenReleased: (fn: () => void) => onRelease = fn,
  };
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

/** A fresh random 128-bit keeper salt in qb64. */
const randomSalt = () => new Salter({ code: MtrDex.Salt_128, raw: crypto.getRandomValues(new Uint8Array(16)) }).qb64;

Deno.test("openWebWallet stores a supplied salt as the keeper root salt", async () => {
  const salt = randomSalt();
  const w = await page().open({ salt });
  try {
    assertEquals(w.hby.mgr.salt, salt);
  } finally {
    await w.close();
  }
});

Deno.test("two fresh stores with the same passcode and salt derive the same signator and named identifier", async () => {
  const salt = randomSalt();
  const derived: { signator: string; named: string; aeid: string | null }[] = [];
  for (const options of [{ salt }, { salt }, {}]) {
    const w = await page().open(options);
    try {
      derived.push({ signator: w.hby.signator!.pre, named: w.hby.makeHab("main").pre, aeid: w.hby.mgr.aeid });
    } finally {
      await w.close();
    }
  }
  assertEquals(derived[1], derived[0]);
  assert(derived[2].signator !== derived[0].signator, "a random salt derives other identifiers");
  assertEquals(derived[2].aeid, derived[0].aeid, "the AEID comes from the passcode alone");
});

Deno.test("openWebWallet refuses a salt that differs from the stored one, closes what it opened, and leaves the store as it was", async () => {
  const p = page();
  const stored = randomSalt();
  await (await p.open({ salt: stored })).close();
  await assertRejects(() => p.open({ salt: randomSalt() }), KeeperSaltMismatchError);
  assertEquals(p.held.size, 0, "the lock is released, so the stores are closed");
  const unchanged = await p.open();
  try {
    assertEquals(unchanged.hby.mgr.salt, stored);
  } finally {
    await unchanged.close();
  }
  // A store opened without a salt keeps the random one it made, so a later salt cannot be the root.
  const q = page();
  await (await q.open()).close();
  await assertRejects(() => q.open({ salt: stored }), KeeperSaltMismatchError);
  assertEquals(q.held.size, 0);
  await (await q.open({ salt: undefined })).close();
});

Deno.test("openWebWallet refuses a salt that is not a 128-bit salt, before any store opens", async () => {
  const p = page();
  const wide = new Matter({ code: MtrDex.Salt_256, raw: crypto.getRandomValues(new Uint8Array(32)) }).qb64;
  for (const salt of [wide, "not-a-salt", "", randomSalt().slice(0, -2)]) {
    await assertRejects(() => p.open({ salt }), ValidationError);
    assertEquals(p.held.size, 0);
  }
  // Nothing was stored by the refusals: the first good salt becomes the root.
  const salt = randomSalt();
  const w = await p.open({ salt });
  try {
    assertEquals(w.hby.mgr.salt, salt);
  } finally {
    await w.close();
  }
});

Deno.test("a held-signer identifier is not derived from the salt", async () => {
  const salt = randomSalt();
  const signer = Signer.random({ code: MtrDex.Ed25519_Seed, transferable: false });
  const serder = incept([signer.verfer.qb64], { version: Vrsn_2_0, code: signer.verfer.code, nsith: "0", toad: 0 });
  const first = await page().open({ salt });
  let held: string;
  try {
    held = first.hby.makeSignedHab("held", undefined, {
      serder,
      sigers: [signer.sign(serder.raw, { index: 0 }) as Siger],
    }).pre;
  } finally {
    await first.close();
  }
  const second = await page().open({ salt });
  try {
    assertEquals(second.hby.habByName("held"), null);
    assertEquals(second.hby.habs.has(held), false);
    assert(second.hby.makeHab("held").pre !== held, "the name derives other keys from the same salt");
  } finally {
    await second.close();
  }
});

Deno.test("a fresh store with the same salt re-derives a retired identifier", async () => {
  const salt = randomSalt();
  const first = await page().open({ salt });
  let retired: string;
  try {
    retired = (await first.identifiers.incept({ alias: "a" })).pre;
    first.identifiers.retire(retired);
    await assertRejects(() => first.identifiers.incept({ alias: "a" }), Error, "retired identifier");
  } finally {
    await first.close();
  }
  // The retirement marker is store state; a fresh store has none, so the name derives the same identifier.
  const second = await page().open({ salt });
  try {
    assertEquals((await second.identifiers.incept({ alias: "a" })).pre, retired);
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
  assertEquals(first.persistenceStatus(), "healthy");
  assertEquals(await first.readPersisted(() => Promise.resolve("after the durable pin")), "after the durable pin");

  p.poison.on = true;
  first.inventory.credentials.pin(["lost"], "no");
  await assertRejects(() => run(() => first.opener.queue.flushed()), PersistenceLatchedError);
  assertEquals(first.persistenceStatus(), "latched");
  await assertRejects(() => first.readPersisted(() => Promise.reject(new Error("read"))), PersistenceReadError);
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

Deno.test("health reads closed after close, and calls on a closed wallet are refused", async () => {
  const w = await page().open();
  assertEquals(w.health(), { status: "ok" });
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
    assertEquals(w.credentials.applies(), []);
    assertThrows(() => w.credentials.pinSchema(new TextEncoder().encode("{}")));
    const applied = await w.credentials.requestProof(a.pre, { message: "", recipient: b.pre, plan: [] }, {
      timeoutMs: 300,
    });
    assertEquals(applied.status.verb, "apply");
    assertEquals(applied.recipient, b.pre);
    assertEquals(w.credentials.presentationStatus(applied.said).verb, "apply");
    assertEquals(w.credentials.applies(b.pre).map((item) => item.apply), [applied.said], "the Apply waits for b");
    assertEquals(w.credentials.applies(a.pre), [], "and for nobody else");
    // Once an exchange answers the Apply it leaves the default list, and the holder's UI can still list it.
    w.hby.db.erpy.pin([applied.said], new Saider({ qb64: applied.said }));
    assertEquals(w.credentials.applies(b.pre), []);
    assertEquals(
      w.credentials.applies(b.pre, { includeAnswered: true }).map((item) => [item.apply, item.state, item.answer]),
      [[applied.said, "answered", applied.said]],
    );
    assertEquals(w.credentials.agreeFor(applied.said), null, "nothing here is an Agree");
    await assertRejects(() => w.credentials.unblind("Eunknown"), Error, "not addressed to a local identifier");
    await assertRejects(() => w.credentials.resendAdmit("Eunknown"), Error, "has not admitted");
    await assertRejects(() => w.mailboxes.remove(a.pre, "Emailbox"), Error, "No endpoint URL");
  } finally {
    await w.close();
  }
});

Deno.test("groups and proposals: refusals, an empty consent list, and a group inception refused for a co-member it cannot reach leaves nothing behind", async () => {
  const first = await page().open({ name: "member-a" }), second = await page().open({ name: "member-b" });
  try {
    const a = await first.identifiers.incept({ alias: "a" }), b = await second.identifiers.incept({ alias: "b" });
    assertEquals(first.proposals.list(), []);
    assertEquals(first.proposals.dismiss("Eunknown"), 0);
    await assertRejects(() => first.proposals.approve("Eunknown"), Error, "No group proposal");
    await assertRejects(() => first.groups.rotate(a.pre), Error, "not a local group");
    await assertRejects(() => first.groups.join("Eunknown", { alias: "g" }), Error, "not a proposal to join");
    await assertRejects(
      () => Promise.resolve().then(() => first.groups.replaceMember(a.pre, { member: a.pre, smids: [a.pre] })),
      Error,
      "not a local group",
    );
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
    // Publishing needs a route to every co-member. A co-member whose endpoint roles are unknown is a refusal made
    // before anything is created, so the alias stays free and the call can be retried once the OOBI is resolved.
    const attempt = () => first.groups.incept({ alias: "pair", member: a.pre, smids: [a.pre, b.pre], timeoutMs: 200 });
    await assertRejects(attempt, Error, "cannot be reached");
    assertEquals(first.hby.habByName("pair"), null, "a refused inception leaves no group habitat");
    await assertRejects(attempt, Error, "cannot be reached");
  } finally {
    await first.close();
    await second.close();
  }
});

Deno.test("the wallet's error classes report their own names, in a bundle that mangles class names", () => {
  for (
    const [Error_, name] of [
      [UnencryptedKeeperError, "UnencryptedKeeperError"],
      [KeeperSaltMismatchError, "KeeperSaltMismatchError"],
      [WalletStoppedError, "WalletStoppedError"],
      [WalletRecoveryError, "WalletRecoveryError"],
    ] as const
  ) {
    const original = Object.getOwnPropertyDescriptor(Error_, "name")!;
    Object.defineProperty(Error_, "name", { value: "a", configurable: true });
    try {
      assertEquals(new Error_("x").name, name);
    } finally {
      Object.defineProperty(Error_, "name", original);
    }
  }
});

Deno.test("pinSchema keeps a schema document, and a group present sends the verb it names and refuses any other", async () => {
  const w = await page().open();
  try {
    const schemer = new Schemer({ sed: { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object" } });
    assertEquals(w.credentials.pinSchema(schemer.raw), schemer.said);
    assertEquals(w.hby.db.schema.get(schemer.said)?.said, schemer.said, "the table holds the pinned document");

    const a = await w.identifiers.incept({ alias: "a" }), b = await w.identifiers.incept({ alias: "b" });
    const solo = await w.groups.incept({ alias: "solo", member: a.pre, smids: [a.pre], timeoutMs: 2000 });
    const group = w.hby.habByName("solo")!;
    assert(solo && group, "a one-member group is its own quorum");
    // The recorded member is still a member in accepted state, so the wallet refuses to switch it.
    assertThrows(
      () => w.groups.replaceMember("solo", { member: b.pre, smids: [a.pre, b.pre] }),
      Error,
      "still a member",
    );
    const options = { recipient: b.pre, message: "", plan: [] };

    const applied = await w.credentials.present({ verb: "apply", pre: group.pre!, options }, { timeoutMs: 2000 });
    assert("said" in applied);
    assertEquals(w.hby.db.exns.get([applied.said])?.route, "/ipex/apply", "the verb picked the message");

    await assertRejects(
      () => w.credentials.present({ verb: "bogus", pre: group.pre!, options } as never),
      Error,
      "cannot send the verb bogus",
    );
    // An Offer takes the Offer path: it asks the wallet for the credential it offers, where a Grant would not.
    await assertRejects(
      () =>
        w.credentials.present({ verb: "offer", pre: group.pre!, selection: { said: "Eunknown" }, options } as never),
      Error,
    );
    assertEquals(
      [...w.hby.db.exns.getTopItemIter()].filter(([, body]) => body.route === "/ipex/grant").length,
      0,
      "no Grant was made in place of the Offer",
    );
  } finally {
    await w.close();
  }
});

Deno.test("held signers: a store opens without its signer, health lists it until a later hold lets it act; an open with them is served on the first poll", async () => {
  const mailbox = "http://held-mailbox.test/";
  /** Mailbox polls only: the KEL publisher also posts the KEL to the same URL. */
  const polls: string[] = [];
  const record = (url: string, init?: { body?: unknown }) => {
    const text = init?.body instanceof ArrayBuffer ? new TextDecoder().decode(init.body) : "";
    if (text.includes("\"qry\"")) polls.push(url);
  };
  const served: HttpClient = {
    *request(url, init): Operation<HttpResponse> {
      record(url, init);
      return { status: 204, ok: true, headers: new Headers(), body: new Uint8Array() };
    },
    *open(url, init): Operation<HttpStreamResponse> {
      record(url, init);
      return { status: 204, ok: true, headers: new Headers(), body: async function*() {} };
    },
  };
  const p = page();
  const reopen = (extra: Partial<OpenWebWalletOptions> = {}) => p.open({ host: { ...p.host, http: served }, ...extra });
  /** Wait until `condition` holds; the runtime's loops run on their own tocks. */
  const until = async (condition: () => boolean) => {
    for (let waited = 0; !condition() && waited < 5_000; waited += 20) await sleep(20);
    assert(condition());
  };

  // A keyless non-transferable hab whose key the host keeps, authorized on a mailbox.
  const signer = Signer.random({ code: MtrDex.Ed25519_Seed, transferable: false });
  const first = await p.open();
  const serder = incept([signer.verfer.qb64], { version: Vrsn_2_0, code: signer.verfer.code, nsith: "0", toad: 0 });
  const pre = first.hby.makeSignedHab("held", undefined, {
    serder,
    sigers: [signer.sign(serder.raw, { index: 0 }) as Siger],
  }).pre;
  first.hby.db.locs.pin(["Emailbox", "http"], { url: mailbox });
  first.hby.db.ends.pin([pre, "mailbox", "Emailbox"], { allowed: true });
  await first.close();

  // Without the option the open resolves; health lists the identifier, and nothing is polled for it.
  const without = await reopen();
  try {
    assertEquals(without.health(), {
      status: "signer-unavailable",
      identifiers: [{ pre, missing: [signer.verfer.qb64] }],
    });
    await sleep(200);
    assertEquals(polls, []);
    // A later hold lets it act: health clears on read, and the next poll is signed.
    without.hby.mgr.hold([signer]);
    assertEquals(without.health(), { status: "ok" });
    await until(() => polls.length > 0);
  } finally {
    await without.close();
  }
  polls.length = 0;

  // With the option the signer is held before the runtime starts: the first poll is signed and served.
  const withSigners = await reopen({ heldSigners: [signer] });
  try {
    await until(() => polls.length > 0);
    assertEquals(withSigners.health(), { status: "ok" });
  } finally {
    await withSigners.close();
  }
});

Deno.test("wallet identifiers.retire", async () => {
  const w = await page().open();
  try {
    const a = await w.identifiers.incept({ alias: "a" }), b = await w.identifiers.incept({ alias: "b" });
    assertEquals(w.identifiers.retire(a.pre), { pre: a.pre, name: "a", released: [], mailboxes: [] });
    assertEquals(w.hby.habs.has(a.pre), false);
    assertEquals(w.hby.habByName("a"), null);
    assert(w.hby.db.getKever(a.pre), "the KEL stays");
    assertThrows(() => w.identifiers.retire(a.pre), Error, "not a local identifier");
    // The retired name derives the retired keys again, so it cannot be reused with the same salt and namespace.
    await assertRejects(() => w.identifiers.incept({ alias: "a" }), Error, "retired identifier");
    // An identifier the runtime still needs is refused with the reason, and stays.
    w.runtime.querying.enqueue({ pre: "Esubject", signer: b.pre, route: "logs", q: {} });
    assertThrows(() => w.identifiers.retire(b.pre), Error, "signs queued queries");
    assert(w.hby.habs.has(b.pre));
  } finally {
    await w.close();
  }
});

/** Accept `serder` at `hby` as group coordination does: local intake, then escrows. */
function deliverEvent(hby: Habery, serder: SerderKERI, sigers: Siger[]) {
  hby.kevery.processEvent({ serder, sigers, wigers: [], frcs: [], sscs: [], ssts: [], local: true });
  hby.kevery.processEscrows();
}

/** Replay every accepted event of `pre` from `from` into each `to`. */
function shareKel(from: Habery, pre: string, to: Habery[]) {
  for (const [, said] of [...from.db.getKelItemIter(pre)]) {
    const serder = from.db.getEvtSerder(pre, said)!;
    for (const hby of to) deliverEvent(hby, serder, from.db.sigs.get(dgKey(pre, said)));
  }
}

Deno.test("wallet health is ok after replacing and retiring a member", async () => {
  const w = await page().open();
  const others: Habery[] = [];
  try {
    for (const name of ["member-b", "member-c"]) {
      others.push(
        await run(() => openHabery({ name, temp: true, skipConfig: true, opener: new MemStoreOpener() })),
      );
    }
    const a = (await w.identifiers.incept({ alias: "a" })).hab;
    const fresh = (await w.identifiers.incept({ alias: "replacement" })).hab;
    const [b, c] = others.map((hby) => ({ hby, hab: hby.makeHab("member") }));
    // The old member polls a mailbox, so retiring it must stop that worker too.
    w.hby.db.locs.pin(["Emailbox", "http"], { url: "http://retire-mailbox.test/" });
    w.hby.db.ends.pin([a.pre, "mailbox", "Emailbox"], { allowed: true });
    w.runtime.mailboxPoller.prompt(a.pre);
    const sides = [{ hby: w.hby, hab: a }, b, c];
    for (const from of sides) shareKel(from.hby, from.hab.pre, sides.filter((s) => s !== from).map((s) => s.hby));
    shareKel(w.hby, fresh.pre, [b.hby, c.hby]);
    const args = { isith: "2", nsith: "2", toad: 0 }, smids = sides.map((s) => s.hab.pre);
    const created = sides.map((s) => s.hby.makeGroupHab("g", s.hab, smids, [...smids, fresh.pre], undefined, args));
    sides.forEach((s, i) => created.forEach((g, j) => i !== j && deliverEvent(s.hby, g.serder, g.sigers)));
    const gid = created[0].serder.pre!;
    b.hab.rotate();
    c.hab.rotate();
    fresh.rotate();
    shareKel(b.hby, b.hab.pre, [w.hby, c.hby]);
    shareKel(c.hby, c.hab.pre, [w.hby, b.hby]);
    shareKel(w.hby, fresh.pre, [b.hby, c.hby]);
    const next = [b.hab.pre, c.hab.pre, fresh.pre];
    const rots = [b, c].map((s) => s.hby.rotateGroupHab("g", next, next, args));
    rots.forEach((r) => deliverEvent(w.hby, r.serder, r.sigers));
    assertEquals(w.hby.db.getKever(gid)!.sn, 1);

    const replaced = w.groups.replaceMember(gid, { member: fresh.pre, smids: next });
    assertEquals(replaced.previousMember, {
      kind: "retired",
      retired: { pre: a.pre, name: "a", released: [], mailboxes: ["Emailbox"] },
    });
    assertEquals(w.hby.habs.has(a.pre), false);
    // Let the poller and publisher take their next tocks, then read health with no special case.
    await sleep(1_500);
    assertEquals(w.runtime.kelPublisher.statusOf(a.pre), []);
    assertEquals(w.health(), { status: "ok" });
  } finally {
    await w.close();
    for (const hby of others) await run(() => hby.close(true));
  }
});

Deno.test("a host change sink receives kramRefused for a late peer message", async () => {
  const changes: RuntimeChange[] = [];
  const host: ChangeSink = { push: (change) => void changes.push(change) };
  const wallet = await page().open({ name: "receiver", runtime: { operationStores: { changes: host } } });
  const peer = await page().open({ name: "peer" });
  try {
    const sender = await peer.identifiers.incept({ alias: "sender" });
    // The receiver knows the sender's key state, as it would after resolving the sender's OOBI.
    for (const wire of peer.hby.db.clonePreIter(sender.pre, 0, Vrsn_2_0)) {
      await run(function*() {
        yield* wallet.runtime.reactor.processBytes(concatBytes(Counter.makeGVC(Vrsn_2_0), wire));
      });
    }
    // Three days old is far outside the wallet's 24 hour lag.
    const stamp = makeNowIso8601(new Date(Date.now() - 3 * 86_400_000));
    const body = exchange("/wallet/late", { sender: sender.pre, stamp });
    const signed = messagize(body, { sigers: peer.hby.habByName("sender")!.sign(body.raw, true), gvrsn: Vrsn_2_0 });
    await run(function*() {
      yield* wallet.runtime.reactor.processBytes(concatBytes(Counter.makeGVC(Vrsn_2_0), signed));
      yield* processCuesOnce(wallet.runtime);
    });
    assertEquals(changes.length, 1);
    const [change] = changes;
    assertEquals(change.kind, "kramRefused");
    assert(change.kind === "kramRefused");
    assertEquals(change.id, body.said);
    assertEquals(change.refusal.sender, sender.pre);
    assertEquals(change.refusal.reason, "timeliness");
    assertEquals(change.refusal.route, "/wallet/late");
  } finally {
    await wallet.close();
    await peer.close();
  }
});

/**
 * A custodial co-member `a` holding a two-member group with the wallet's keyless member, and an HTTP client that
 * serves the group's OOBI and `a`'s OOBI from it. The member's signed inception is what the host keeps to re-adopt it.
 */
async function groupAgent() {
  const agent = await run(() =>
    openHabery({ name: "agent", temp: true, skipConfig: true, opener: new MemStoreOpener() })
  );
  // The wallet's non-transferable member, re-adopted from its signed inception after the store was lost.
  const signer = Signer.random({ code: MtrDex.Ed25519_Seed, transferable: false });
  const serder = incept([signer.verfer.qb64], { version: Vrsn_2_0, code: signer.verfer.code, nsith: "0", toad: 0 });
  const sigers = [signer.sign(serder.raw, { index: 0 }) as Siger];
  const a = agent.makeHab("a");
  deliverEvent(agent, serder, sigers);
  const smids = [a.pre, serder.pre!];
  const gid = agent.makeGroupHab("g", a, smids, [a.pre], undefined, { isith: ["1", "0"], nsith: "1", toad: 0 })
    .serder.pre!;
  const oobi = `http://agent.test/oobi/${gid}/controller`;
  const memberOobi = `http://agent.test/oobi/${a.pre}/controller`;
  const served = new Map([[oobi, gid], [memberOobi, a.pre]]);
  const fetched: string[] = [];
  const http: HttpClient = {
    *request(): Operation<HttpResponse> {
      return { status: 404, ok: false, headers: new Headers(), body: new Uint8Array() };
    },
    *open(url): Operation<HttpStreamResponse> {
      fetched.push(url);
      const pre = served.get(url);
      if (!pre) return { status: 404, ok: false, headers: new Headers(), body: async function*() {} };
      const bytes = agent.habs.get(pre)!.replyToOobi(pre, "controller");
      return {
        status: 200,
        ok: true,
        headers: new Headers({ "content-type": "application/json+cesr" }),
        body: async function*() {
          yield bytes;
        },
      };
    },
  };
  return { agent, signer, serder, sigers, a, smids, gid, oobi, memberOobi, http, fetched };
}

Deno.test("wallet groups.rejoin", async () => {
  // The custodial co-member: it holds the group and serves the group's OOBI.
  const { agent, signer, serder, sigers, a, smids, gid, oobi, http, fetched } = await groupAgent();
  const p = page();
  const w = await p.open({ host: { ...p.host, http } });
  try {
    const member = w.hby.makeSignedHab("member", undefined, { serder, sigers });
    w.hby.mgr.hold([signer]);
    shareKel(agent, a.pre, [w.hby]);

    const options = { oobi, group: gid, member: member.pre, alias: "group" };
    const joined = await w.groups.rejoin(options);
    assert(joined.outcome === "joined");
    assertEquals(joined, { outcome: "joined", group: gid, alias: "group", smids, rmids: [a.pre], written: true });
    assertEquals(w.hby.db.getHab(gid)?.mid, member.pre);
    assertEquals(w.hby.habByName("group")?.pre, gid);
    // A repeat is joined at once, writes nothing and fetches nothing.
    assertEquals(await w.groups.rejoin(options), { ...joined, written: false });
    assertEquals(fetched, [oobi]);
    // The group is not a member of itself.
    await assertRejects(() => w.groups.rejoin({ ...options, member: gid }), Error, "Group identifiers");
  } finally {
    await w.close();
    await run(() => agent.close(true));
  }
});

/** Latch `w`: a commit made while writes fail exhausts its retries. Writes succeed again afterwards. */
async function latch(p: ReturnType<typeof page>, w: WebWallet) {
  p.poison.on = true;
  w.inventory.credentials.pin(["lost"], "no");
  await assertRejects(() => run(() => w.opener.queue.flushed()), PersistenceLatchedError);
  p.poison.on = false;
}

Deno.test("recoverWebWallet returns a new healthy wallet after a latch and keeps the durable prefix", async () => {
  const p = page();
  const first = await p.open();
  first.inventory.credentials.pin(["durable"], "yes");
  await run(() => first.opener.queue.flushed());
  await latch(p, first);
  assertEquals(first.health().status, "latched");

  const recovered = await recoverWebWallet(first, { open: p.options() });
  try {
    assertEquals([recovered.rejoin, recovered.skipped], [null, "no-group"]);
    const second = recovered.wallet;
    assert(second !== first && second.opener !== first.opener);
    assertEquals(second.health(), { status: "ok" });
    assertEquals(second.persistenceStatus(), "healthy");
    assertEquals(second.inventory.credentials.get(["durable"]), "yes");
    assertEquals(second.inventory.credentials.get(["lost"]), null);
  } finally {
    await recovered.wallet.close();
  }
  assertEquals(p.held.size, 0);
});

Deno.test("calls on the old handle fail after recovery", async () => {
  const p = page();
  const first = await p.open();
  const { pre } = await first.identifiers.incept({ alias: "main" });
  await run(() => first.opener.queue.flushed());
  await latch(p, first);
  const { wallet } = await recoverWebWallet(first, { open: p.options() });
  try {
    assertEquals(first.health(), { status: "closed" });
    await assertRejects(() => first.identifiers.incept({ alias: "late" }), WalletStoppedError);
    await assertRejects(() => first.oobis.resolve("http://agent.test/oobi"), WalletStoppedError);
    await assertRejects(() => first.readPersisted(() => Promise.resolve("read")), WalletStoppedError);
    // Synchronous reads reach the closed stores, which refuse them.
    assertThrows(() => first.identifiers.status(pre, 0), DatabaseNotOpenError);
    assertThrows(() => first.credentials.list(), DatabaseNotOpenError);
    assertEquals(wallet.identifiers.status(pre, 0), { state: "complete" });
  } finally {
    await wallet.close();
  }
});

Deno.test("recoverWebWallet throws WalletRecoveryError after its reopen attempts", async () => {
  const p = page();
  const first = await p.open();
  let requests = 0;
  // Another tab holds the wallet at every attempt.
  const locks: StoreLockManager = {
    async request(_name, _options, callback) {
      requests++;
      return await callback(null);
    },
  };
  const error = await assertRejects(
    () => recoverWebWallet(first, { open: p.options({ host: { ...p.host, locks } }), attempts: 2 }),
    WalletRecoveryError,
  );
  assertInstanceOf(error.cause, StoreLockHeldError);
  assertEquals(requests, 2);
  assertEquals(first.health(), { status: "closed" });
  await assertRejects(() => recoverWebWallet(first, { open: p.options(), attempts: 0 }), Error, "positive integer");
});

Deno.test("recoverWebWallet rejoins the group when its record is missing", async () => {
  const { agent, signer, serder, sigers, a, smids, gid, oobi, memberOobi, http, fetched } = await groupAgent();
  const p = page();
  const options = p.options({ host: { ...p.host, http }, heldSigners: [signer] });
  const first = await openWebWallet(options);
  const member = first.hby.makeSignedHab("member", undefined, { serder, sigers });
  await run(() => first.opener.queue.flushed());
  await latch(p, first);
  const group = { oobi, group: gid, alias: "group", member: member.pre, memberOobis: [memberOobi] };
  const recovered = await recoverWebWallet(first, { open: options, group });
  try {
    assertEquals(recovered.rejoin, {
      outcome: "joined",
      group: gid,
      alias: "group",
      smids,
      rmids: [a.pre],
      written: true,
    });
    assertEquals(recovered.wallet.hby.db.getHab(gid)?.mid, member.pre);
    assertEquals(fetched.toSorted(), [memberOobi, oobi].toSorted());
  } finally {
    await recovered.wallet.close();
    await run(() => agent.close(true));
  }
});

Deno.test("recoverWebWallet skips rejoin when the member habitat is missing and says why", async () => {
  const { agent, signer, serder, sigers, a, smids, gid, oobi, memberOobi, http, fetched } = await groupAgent();
  const p = page();
  // A wiped store: the wallet has never adopted its member.
  const options = p.options({ host: { ...p.host, http }, heldSigners: [signer] });
  const first = await openWebWallet(options);
  const group = { oobi, group: gid, alias: "group", member: serder.pre!, memberOobis: [memberOobi] };
  const recovered = await recoverWebWallet(first, { open: options, group });
  const w = recovered.wallet;
  try {
    assertEquals([recovered.rejoin, recovered.skipped], [null, "member-missing"]);
    assertEquals(fetched, []);
    // The host's path: adopt the keyless member, resolve the co-members, rejoin.
    w.hby.makeSignedHab("member", undefined, { serder, sigers });
    assertEquals((await w.oobis.resolve(memberOobi)).outcome, "resolved");
    const joined = await w.groups.rejoin({ oobi, group: gid, alias: "group", member: serder.pre! });
    assertEquals(joined, { outcome: "joined", group: gid, alias: "group", smids, rmids: [a.pre], written: true });
  } finally {
    await w.close();
    await run(() => agent.close(true));
  }
});

Deno.test("recoverWebWallet skips rejoin when the group record is present", async () => {
  const { agent, signer, serder, sigers, gid, oobi, memberOobi, http, fetched } = await groupAgent();
  const p = page();
  const options = p.options({ host: { ...p.host, http }, heldSigners: [signer] });
  const first = await openWebWallet(options);
  const member = first.hby.makeSignedHab("member", undefined, { serder, sigers });
  await first.oobis.resolve(memberOobi);
  const group = { oobi, group: gid, alias: "group", member: member.pre, memberOobis: [memberOobi] };
  assertEquals((await first.groups.rejoin(group)).outcome, "joined");
  const before = fetched.length;
  const recovered = await recoverWebWallet(first, { open: options, group });
  try {
    assertEquals([recovered.rejoin, recovered.skipped], [null, "group-recorded"]);
    assertEquals(recovered.wallet.hby.db.getHab(gid)?.mid, member.pre);
    assertEquals(fetched.length, before);
  } finally {
    await recovered.wallet.close();
    await run(() => agent.close(true));
  }
});
