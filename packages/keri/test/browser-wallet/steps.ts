/**
 * Page side of the browser wallet scenario. Each exported step is one named piece of what an app
 * does with `openWebWallet` and the library workflows; the Deno runner (`run_browser_wallet.ts`)
 * calls them in order, interleaving the counterparty's actions. A step calls the wallet-level API
 * (`identifiers`, `oobis`, `mailboxes`, `credentials`), asserts on its typed results and status reads (`identifiers.status`, `oobiStatus`, `mailboxStatus`) and
 * returns plain JSON for the report. The wallet and its identifier live in module state so a step
 * can span the close and reopen the scenario performs.
 */

import { openWebWallet, type WebWallet } from "../../../wallet/web.ts";
import { type Hab, mailboxStatus, oobiStatus } from "../../runtime.ts";
import { dgKey } from "../../src/db/core/keys.ts";
import { assert, describe, waitUntil } from "./page-support.ts";

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
/** The issuance in flight: its call, started by step 4c and finished by step 4d. */
let issuing: Promise<unknown> | undefined;

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

/** Resolve an OOBI through the wallet; fail on any other outcome. */
async function resolveOobiUrl(url: string, alias?: string): Promise<void> {
  const result = await open().oobis.resolve(url, { alias });
  assert(result.outcome === "resolved", `OOBI ${url} did not resolve: ${JSON.stringify(result)}`);
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

/** Why a step is stuck: the wallet reports a stopped runtime and its cause through `health()`. */
export function crashCause(): Promise<string> {
  const health = wallet?.health();
  if (health?.status === "stopped" || health?.status === "faulted") {
    return Promise.resolve(
      `\nwallet health: ${JSON.stringify(health, (_k, v) => v instanceof Error ? describe(v) : v)}`,
    );
  }
  return Promise.resolve("");
}

/** Wait until `read` returns a value, polling the library status; fail at the deadline. */
function until<T>(label: string, read: () => T | undefined, timeoutMs = 60_000): Promise<T> {
  return waitUntil(label, read, () => "", timeoutMs).catch(async (error) => {
    throw new Error(`${error.message}${await crashCause()}`);
  });
}

/** Step 4a (holder): wait for the counterparty's Grant, then take the credential in one call. */
async function receiveCredential({ grant }: StepArgs) {
  const { credentials } = open();
  const said = grant as string;
  await until("pending Grant", () => credentials.pending(identifier().pre!).find((pending) => pending.grant === said));
  const received = await credentials.receive(said, { timeoutMs: 90_000 });
  assert(received.outcome === "admitted", `receive: ${JSON.stringify(received)}`);
  assert(received.delivery.state === "delivered", `the Admit was not delivered: ${JSON.stringify(received.delivery)}`);
  const held = credentials.list().held;
  assert(held.some((row) => row.grant === said), "the admitted credential is not in the wallet inventory");
  return { grant: said, admit: received.admit, deliveries: received.delivery.to, held: held.length };
}

/**
 * Step 4b (issuer): start the issuance for the counterparty and return as soon as the Grant exists. The call
 * keeps waiting for the holder; step 4c collects it.
 */
async function issueCredential({ peerPre }: StepArgs) {
  const begun = Promise.withResolvers<{ grant: string; credential: string }>();
  issuing = open().credentials.issue({
    pre: identifier().pre!,
    registry: "browser-registry",
    credential: { issuee: peerPre as string, attribute: { role: "browser issued reader" } },
    timeoutMs: 120_000,
    onBegun: begun.resolve,
  });
  // A failure before the Grant exists settles the call, not `begun`.
  const early = issuing.then((result) => {
    throw new Error(`issuance ended before a Grant: ${JSON.stringify(result)}`);
  });
  early.catch(() => {});
  const { grant, credential } = await Promise.race([begun.promise, early]);
  return { grant, credential };
}

/** Step 4c (issuer): the issuance call returns once DH, the registry update and the proof are done and recorded. */
async function finishIssuance() {
  assert(issuing, "no issuance is in flight");
  const result = await issuing as Awaited<ReturnType<WebWallet["credentials"]["issue"]>>;
  issuing = undefined;
  assert(result.outcome === "issued", `issuance did not complete: ${JSON.stringify(result)}`);
  return { grant: result.grant, credential: result.credential, issued: open().credentials.list().issued.length };
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

/** Step 1: open a new wallet with a passcode and record the persistence request. */
async function openWallet({ name, bran }: StepArgs) {
  assert(!wallet, "a wallet is already open");
  wallet = await openWebWallet({ name, bran, delivery: "direct" });
  // Firefox holds the persistence request on a permission prompt that headless runs never answer, so
  // record "still pending" instead of waiting; the open itself has already returned.
  const pending = Symbol("pending");
  const storage = await Promise.race([
    wallet.storage,
    new Promise<typeof pending>((resolve) => setTimeout(() => resolve(pending), 10_000)),
  ]);
  return { storage: storage === pending ? "pending after 10 s" : storage, health: wallet.health().status };
}

/** Step 2: resolve the witness, incept with it and collect its receipt. */
async function inceptWithWitness({ witness }: StepArgs) {
  const { hby, identifiers } = open();
  await resolveOobiUrl(`${witness.origin}/oobi/${witness.pre}/controller`, "witness");
  // The lane serves its witness at KERI v2; v2 issuance needs the holder's and issuer's KELs to be v2.
  const incepted = await identifiers.incept({ alias: "browser", witnesses: [witness.pre], toad: 1 });
  assert(incepted.outcome === "complete", `inception ${JSON.stringify(incepted.status)}`);
  hab = incepted.hab;
  const receipts = receiptCount(identifier().pre!, 0);
  assert(receipts === 1, `expected 1 witness receipt, found ${receipts}`);
  return { ...keyState(), status: incepted.status.state, receipts };
}

/** Step 3a: resolve the mailbox host and authorize it. */
async function addMailboxHost({ mailbox }: StepArgs) {
  await resolveOobiUrl(`${mailbox.origin}/oobi/${mailbox.pre}/controller`, "mailbox");
  const added = await open().mailboxes.add(identifier().pre!, mailbox.pre, { timeoutMs: 15_000 });
  assert(added.outcome === "authorized", `mailbox ${JSON.stringify(added)}`);
  return { mailbox: mailbox.pre, state: added.status.state };
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
  wallet = await openWebWallet({ name, bran, delivery: "direct" });
  const { hby } = open();
  const pre = expect.pre;
  hab = hby.habs.get(pre);
  assert(hab, "the identifier is gone after reopen");
  const state = keyState();
  assert(state.sn === expect.sn && state.said === expect.said, `key state changed: ${JSON.stringify(state)}`);
  const receipts = receiptCount(pre, 0);
  assert(receipts === 1, `expected 1 receipt after reopen, found ${receipts}`);
  for (let sn = 0; sn <= expect.sn; sn++) {
    const status = open().identifiers.status(pre, sn);
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
  const before = keyState();
  const rotated = await open().identifiers.rotate(identifier().pre!);
  assert(rotated.sn === before.sn + 1, `rotation did not advance the sequence number (${before.sn} -> ${rotated.sn})`);
  assert(rotated.outcome === "complete", `rotation ${JSON.stringify(rotated.status)}`);
  const receipts = receiptCount(identifier().pre!, rotated.sn);
  assert(receipts === 1, `expected 1 witness receipt for the rotation, found ${receipts}`);
  return { ...keyState(), status: rotated.status.state, receipts };
}

/** Step 7: close and check that the wallet's Web Lock is free. */
async function closeAndCheckLock({ name }: StepArgs) {
  await open().close();
  wallet = undefined;
  const { storeLockKey } = await import("../../runtime-web.ts");
  const key = storeLockKey({ name, base: "", temp: false });
  const held = await navigator.locks.query();
  const holders = (held.held ?? []).filter((lock) => lock.name === key);
  assert(holders.length === 0, `the store lock is still held: ${JSON.stringify(holders)}`);
  return { lock: key, held: false };
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
