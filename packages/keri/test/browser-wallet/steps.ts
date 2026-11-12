/**
 * Page side of the browser wallet scenario. Each exported step is one named piece of what an app
 * does with `openWebWallet` and the library workflows; the Deno runner (`run_browser_wallet.ts`)
 * calls them in order, interleaving the counterparty's actions. A step asserts through the library's
 * status reads (`eventStatus`, `oobiStatus`, `mailboxStatus`, `issuanceStatus`), never a sleep, and
 * returns plain JSON for the report. The wallet and its identifier live in module state so a step
 * can span the close and reopen the scenario performs.
 */

import type { SerderACDC } from "cesr-ts";
import { call, run, sleep } from "npm:effection@^3.6.0";
import { openWebWallet, RegistryCustody, WalletAuthor, type WebWallet } from "../../../wallet/web.ts";
import {
  addMailbox,
  admitIssuance,
  approveIssuanceExchange,
  beginIssuance,
  beginOobi,
  completeEvent,
  deliverIssuanceAdmit,
  type EventCompletionDeps,
  eventStatus,
  type Hab,
  type IssuanceOperations,
  issuanceStatus,
  type KramConfig,
  mailboxStatus,
  oobiStatus,
  Receiptor,
  waitForIssuance,
  waitForMailboxState,
  waitForOobi,
} from "../../runtime.ts";
import { dgKey } from "../../src/db/core/keys.ts";

/** Servers and identities the runner passes to every step. */
export interface StepArgs {
  /** KERIpy witness. */
  witness: { origin: string; pre: string };
  /** Tufa mailbox host. */
  mailbox: { origin: string; pre: string };
  /** Wallet store name and passcode. */
  name: string;
  bran: string;
  /** Step specific values, e.g. the counterparty's OOBI. */
  [key: string]: unknown;
}

let wallet: WebWallet | undefined;
let hab: Hab | undefined;
/** Custody over the open wallet's derivation store; dropped when the wallet closes. */
let custody: RegistryCustody | undefined;
/** The credential and registry of the issuance in flight, kept for the step that records it. */
const inFlight: { credential?: SerderACDC; registry?: string } = {};

/** Fail the step with `message` unless `condition` holds. */
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** The open wallet, or a failure naming the step that needs it. */
function open(): WebWallet {
  assert(wallet, "the wallet is not open");
  return wallet;
}

/** The scenario identifier. */
function identifier(): Hab {
  assert(hab, "the scenario identifier does not exist yet");
  return hab;
}

/** Collaborators for event completion, taken from the open wallet's runtime. */
function completion(): EventCompletionDeps {
  const { hby, runtime } = open();
  return {
    hby,
    protocol: runtime.protocol,
    http: runtime.http,
    clock: runtime.clock,
    *withDelegation() {
      throw new Error("the scenario identifier is not delegated");
    },
  };
}

/** Queue an OOBI with the running Oobiery and wait until it is resolved; fail on any other outcome. */
async function resolveOobiUrl(url: string, alias?: string): Promise<void> {
  const { hby, runtime } = open();
  beginOobi({ oobiery: runtime.oobiery }, url, { alias });
  const result = await run(() => waitForOobi({ db: hby.db }, url, { timeoutMs: 30_000 }));
  assert(
    result.outcome === "settled" && result.status.state === "resolved",
    `OOBI ${url} did not resolve: ${JSON.stringify(result.status)}`,
  );
}

/** Count the witness receipts stored for one event. */
function receiptCount(pre: string, sn: number): number {
  const { hby } = open();
  const said = hby.db.kels.getLast(pre, sn);
  assert(said, `no accepted event ${pre}:${sn}`);
  return hby.db.wigs.get(dgKey(pre, said)).length;
}

/** The identifier's key state as plain data. */
function keyState(): { pre: string; sn: number; said: string; wits: string[]; toad: number } {
  const kever = identifier().kever;
  assert(kever, "the identifier has no accepted key state");
  return {
    pre: identifier().pre!,
    sn: kever.sn,
    said: kever.serder.said!,
    wits: [...kever.wits],
    toad: Number(kever.toader.num),
  };
}

/**
 * The runtime-driven issuance owner of the open wallet and a custody over the wallet's own
 * derivation store. The runtime loop calls `processOnce` and creates the DH owners itself.
 */
function issuing(): { ops: IssuanceOperations; custody: RegistryCustody } {
  const { hby, runtime, inventory } = open();
  const ops = runtime.operations?.issuance;
  assert(ops, "the runtime has no issuance owner");
  custody ??= new RegistryCustody({ hby, hab: identifier(), registry: runtime.acdc!.store, db: inventory });
  return { ops, custody };
}

/** Error text including causes, for the report. */
function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return `${error.name}: ${error.message}${error.cause ? ` <- ${describe(error.cause)}` : ""}`;
}

/**
 * Why a step is stuck: a runtime that crashed closes the wallet's stores and releases its lock, and
 * `openWebWallet` reports the crash only from `close()`, so closing is the one way to read the cause.
 */
async function crashCause(): Promise<string> {
  if (!wallet) return "";
  try {
    wallet.hby.db.kels.getLast(identifier().pre!, 0);
    return "";
  } catch {
    // The stores are closed: the runtime is gone.
  }
  const current = wallet;
  wallet = undefined;
  try {
    await current.close();
    return "";
  } catch (error) {
    return `\nruntime failure reported by close(): ${describe(error)}\n${(error as Error).stack ?? ""}`;
  }
}

/** Wait until `read` returns a value, polling the library status; fail at the deadline. */
async function until<T>(label: string, read: () => T | undefined, timeoutMs = 60_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const value = read();
      if (value !== undefined) return value;
    } catch (error) {
      last = error;
    }
    await run(() => sleep(100));
  }
  throw new Error(`${label} not reached in ${timeoutMs} ms${last ? `: ${describe(last)}` : ""}${await crashCause()}`);
}

/** Step 4b (holder): wait for the counterparty's Grant, consent to DH, wait for the Grant to finish, then admit it. */
async function receiveCredential({ grant }: StepArgs) {
  const { ops } = issuing();
  const said = grant as string;
  await until("pending Grant", () => {
    const status = issuanceStatus(ops, said);
    return status.state === "active" && status.needs === "exchange" ? status : undefined;
  });
  approveIssuanceExchange(ops, { hab: identifier(), grant: said });
  const waited = await run(() =>
    waitForIssuance(ops, said, {
      timeoutMs: 90_000,
      until: (status) => status.state !== "active" || status.needs === "admit",
    })
  );
  assert(
    waited.status.state === "active" && waited.status.needs === "admit",
    `issuance did not reach the admit consent: ${JSON.stringify(waited)}`,
  );
  const { wallet: protocolWallet } = open();
  const admitted = await run(function*() {
    const done = yield* admitIssuance(ops.deps, { hab: identifier(), grant: said });
    // The inventory record precedes delivery: the embedder reacts to the accepted Admit.
    yield* call(() => protocolWallet.recordAdmission(said, done.admit.said!, { consent: true }));
    const deliveries = yield* deliverIssuanceAdmit(ops.deps, identifier(), done);
    return { admit: done.admit.said!, deliveries };
  });
  const final = issuanceStatus(ops, said);
  assert(final.state === "done" && final.phase === "admitted", `issuance after admit: ${JSON.stringify(final)}`);
  const held = protocolWallet.inventory().held;
  assert(held.some((row) => row.grant === said), "the admitted credential is not in the wallet inventory");
  return { grant: said, ...admitted, held: held.length };
}

/** Step 4c (issuer): registry, credential and Grant for the counterparty; the issuance loop does the rest. */
async function issueCredential({ peerPre }: StepArgs) {
  const { hby, runtime, wallet: protocolWallet } = open();
  const { ops, custody } = issuing();
  const receiptor = new Receiptor(hby, runtime.protocol, runtime.http, runtime.clock);
  const author = new WalletAuthor(protocolWallet, runtime.acdc!, receiptor, custody);
  const pre = identifier().pre!;
  const inception = await run(() => author.incept("browser-registry", pre));
  // No createCustody here: a DH-issued registry root is derived with the recipient, and a custody root conflicts with it.
  const reg = author.registry("browser-registry", pre);
  const credential = author.create(reg, { issuee: peerPre as string, attribute: { role: "browser issued reader" } });
  const begun = await run(() =>
    beginIssuance(ops, {
      hab: identifier(),
      credential,
      options: { recipient: peerPre as string, message: "", artifacts: [] },
    })
  );
  inFlight.credential = credential;
  inFlight.registry = inception.said!;
  return { grant: begun.grant, xid: begun.xid, registry: inception.said, credential: credential.said };
}

/** Step 4d (issuer): wait for DH, the registry update and the final proof; record the issuance in the inventory. */
async function finishIssuance({ grant }: StepArgs) {
  const { ops, custody } = issuing();
  const said = grant as string;
  const waited = await run(() => waitForIssuance(ops, said, { timeoutMs: 120_000 }));
  assert(
    waited.outcome === "settled" && waited.status.state === "done",
    `issuance did not complete: ${JSON.stringify(waited)}`,
  );
  const { runtime, wallet: protocolWallet } = open();
  const head = runtime.acdc!.store.headEvent(inFlight.registry!)!;
  protocolWallet.recordIssued(inFlight.credential!, head.said!, { blinder: custody.derivedOpening(head) });
  return { grant: said, status: waited.status, issued: protocolWallet.inventory().issued.length };
}

/** Step 4e (issuer): the counterparty's Admit reached this wallet. */
async function awaitAdmit({ grant }: StepArgs) {
  const { hby } = open();
  const admit = await until("Admit from the counterparty", () => hby.db.erpy.get([grant as string])?.qb64);
  return { admit };
}

/** Step 5c: the credentials the wallet holds and issued, read from the inventory. */
function readInventory({ mailbox }: StepArgs) {
  const rows = open().wallet.inventory();
  return Promise.resolve({
    issued: rows.issued.map((row) => row.credential),
    held: rows.held.map((row) => row.credential),
    state: keyState(),
    cursor: open().hby.db.tops.get([identifier().pre!, mailbox.pre])?.topics ?? {},
  });
}

/** Step 5d: wait until the mailbox cursor for `topic` is past `above`, i.e. the reopened poller read new mail. */
async function awaitMailboxCursor({ mailbox, topic, above }: StepArgs) {
  const { hby } = open();
  const cursor = await until(`mailbox cursor ${topic} past ${above}`, () => {
    const topics = hby.db.tops.get([identifier().pre!, mailbox.pre])?.topics ?? {};
    return (topics[topic as string] ?? -1) > (above as number) ? topics : undefined;
  });
  return { cursor };
}

/**
 * TEMPORARY WORKAROUND for a keri-ts defect: `openWebWallet` enables KRAM without cache windows, so
 * the first timely v2 exn or qry on a fresh store throws "No KRAM cache type for message"
 * (kram-policy.ts). A fix with built-in default windows is in progress in another PR; remove this
 * option when it merges. The windows are mailbox sized (60 s lag, as the mailbox interop tests use):
 * a wallet reads mail some time after it was stamped, so short windows would drop a Grant.
 */
const KRAM: KramConfig = { enabled: true, caches: { "~": [1000, 60000, 60000, 300000, 60000, 60000, 300000] } };

/** Step 1: open a new wallet with a passcode and record the persistence request. */
async function openWallet({ name, bran }: StepArgs) {
  assert(!wallet, "a wallet is already open");
  wallet = await openWebWallet({ name, bran, runtime: { kram: KRAM } });
  // Firefox holds the persistence request on a permission prompt that headless runs never answer, so
  // record "still pending" instead of waiting; the open itself has already returned.
  const pending = Symbol("pending");
  const storage = await Promise.race([
    wallet.storage,
    new Promise<typeof pending>((resolve) => setTimeout(() => resolve(pending), 10_000)),
  ]);
  return { storage: storage === pending ? "pending after 10 s" : storage, health: wallet.health().status };
}

/** Step 2: resolve the witness, incept with it, collect its receipt and read the event status. */
async function inceptWithWitness({ witness }: StepArgs) {
  const { hby } = open();
  await resolveOobiUrl(`${witness.origin}/oobi/${witness.pre}/controller`, "witness");
  // The lane serves its witness at KERI v2; v2 issuance needs the holder's and issuer's KELs to be v2.
  hab = hby.makeHab("browser", undefined, {
    transferable: true,
    icount: 1,
    isith: "1",
    ncount: 1,
    nsith: "1",
    wits: [witness.pre],
    toad: 1,
  });
  const completed = await run(() => completeEvent(completion(), identifier(), 0));
  const status = eventStatus(hby, identifier().pre!, 0);
  assert(completed.outcome === "settled" && status.state === "complete", `inception ${JSON.stringify(status)}`);
  const receipts = receiptCount(identifier().pre!, 0);
  assert(receipts === 1, `expected 1 witness receipt, found ${receipts}`);
  return { ...keyState(), status: status.state, receipts };
}

/** Step 3a: resolve the mailbox host, authorize it and wait for the accepted end role. */
async function addMailboxHost({ mailbox }: StepArgs) {
  const { hby, runtime } = open();
  await resolveOobiUrl(`${mailbox.origin}/oobi/${mailbox.pre}/controller`, "mailbox");
  const pre = identifier().pre!;
  const added = await run(() =>
    addMailbox(
      { hby, http: runtime.http, reactor: runtime.reactor, protocol: runtime.protocol },
      identifier(),
      mailbox.pre,
    )
  );
  const waited = await run(() =>
    waitForMailboxState(() => mailboxStatus(hby, pre, mailbox.pre), {
      want: "authorized",
      deadline: runtime.clock.now() + 15_000,
      clock: runtime.clock,
    })
  );
  assert(added.state === "authorized" && waited.outcome === "settled", `mailbox ${JSON.stringify(waited)}`);
  return { mailbox: mailbox.pre, state: waited.status.state };
}

/** Step 3b: resolve the counterparty's OOBI (it names the shared mailbox) and wait for its key state. */
async function resolvePeer({ peerOobi, peerPre }: StepArgs) {
  const { hby } = open();
  await resolveOobiUrl(peerOobi as string, "peer");
  assert(hby.db.getKever(peerPre as string), "the counterparty's key state was not learned");
  return { peer: peerPre, oobi: oobiStatus(hby, peerOobi as string).state };
}

/** Step 5a: close the wallet and report whether it released its lock. */
async function closeWallet() {
  custody = undefined;
  await open().close();
  wallet = undefined;
  return { closed: true };
}

/** Step 5b: reopen the same wallet in the same page and check the durable state is there. */
async function reopenWallet(args: StepArgs) {
  const { name, bran, mailbox } = args;
  const expect = args.expect as {
    pre: string;
    sn: number;
    said: string;
    issued: string[];
    held: string[];
    cursor: Record<string, number>;
  };
  wallet = await openWebWallet({ name, bran, runtime: { kram: KRAM } });
  const { hby } = open();
  const pre = expect.pre;
  hab = hby.habs.get(pre);
  assert(hab, "the identifier is gone after reopen");
  const state = keyState();
  assert(state.sn === expect.sn && state.said === expect.said, `key state changed: ${JSON.stringify(state)}`);
  const receipts = receiptCount(pre, 0);
  assert(receipts === 1, `expected 1 receipt after reopen, found ${receipts}`);
  for (let sn = 0; sn <= expect.sn; sn++) {
    const status = eventStatus(hby, pre, sn);
    assert(status.state === "complete", `event ${sn} status after reopen ${JSON.stringify(status)}`);
  }
  const box = mailboxStatus(hby, pre, mailbox.pre);
  assert(box.state === "authorized", `mailbox after reopen ${JSON.stringify(box)}`);
  const cursor = hby.db.tops.get([pre, mailbox.pre])?.topics ?? {};
  // The poller may have read mail between the snapshot and the close, so a stored index may only have moved forward.
  const behind = Object.entries(expect.cursor).filter(([topic, index]) => (cursor[topic] ?? -1) < index);
  assert(
    !behind.length,
    `mailbox cursor went back across reopen: ${JSON.stringify(expect.cursor)} -> ${JSON.stringify(cursor)}`,
  );
  const rows = open().wallet.inventory();
  const issued = rows.issued.map((row) => row.credential), held = rows.held.map((row) => row.credential);
  assert(
    JSON.stringify([issued, held]) === JSON.stringify([expect.issued, expect.held]),
    `inventory after reopen: issued ${issued}, held ${held}`,
  );
  return { ...state, receipts, mailbox: box.state, cursor, issued, held };
}

/** Step 6: rotate, collect receipts and report the new key state. */
async function rotate() {
  const { hby } = open();
  const before = keyState();
  identifier().rotate({});
  const sn = identifier().kever!.sn;
  assert(sn === before.sn + 1, `rotation did not advance the sequence number (${before.sn} -> ${sn})`);
  const completed = await run(() => completeEvent(completion(), identifier(), sn));
  const status = eventStatus(hby, identifier().pre!, sn);
  assert(completed.outcome === "settled" && status.state === "complete", `rotation ${JSON.stringify(status)}`);
  const receipts = receiptCount(identifier().pre!, sn);
  assert(receipts === 1, `expected 1 witness receipt for the rotation, found ${receipts}`);
  return { ...keyState(), status: status.state, receipts };
}

/** Step 7: close and check that the wallet's Web Lock is free. */
async function closeAndCheckLock({ name }: StepArgs) {
  custody = undefined;
  await open().close();
  wallet = undefined;
  const { storeLockKey } = await import("../../runtime-web.ts");
  const key = storeLockKey({ name, base: "", temp: false });
  const held = await navigator.locks.query();
  const holders = (held.held ?? []).filter((lock) => lock.name === key);
  assert(holders.length === 0, `the store lock is still held: ${JSON.stringify(holders)}`);
  return { lock: key, held: false };
}

/** Wait that other steps can use while a library wait finishes in the background. */
export async function pause(ms: number): Promise<void> {
  await run(function*() {
    yield* sleep(ms);
    yield* call(async () => {});
  });
}

/** Steps by name, as the runner calls them. */
export const steps: Record<string, (args: StepArgs & Record<string, any>) => Promise<unknown>> = {
  openWallet,
  inceptWithWitness,
  addMailboxHost,
  resolvePeer,
  receiveCredential,
  issueCredential,
  finishIssuance,
  awaitAdmit,
  readInventory,
  awaitMailboxCursor,
  closeWallet,
  reopenWallet,
  rotate,
  closeAndCheckLock,
};
