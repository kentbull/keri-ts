/**
 * Page side of the group wallet lanes (15c, 15d). The browser is one member of a group whose other members are Tufa
 * CLI members. Every step is one thing an app does through the wallet surface (`identifiers`, `oobis`, `mailboxes`,
 * `groups`, `proposals`, `credentials`, `health()`) and asserts the typed outcome it gets back. Nothing here drives the
 * runtime: the few reads of `wallet.hby` are evidence only, named where they occur.
 *
 * The page keeps only the open wallet. A reload loses it, so every step takes the identifiers it needs as arguments
 * and `reopenWallet` rebuilds nothing but the wallet.
 */

import { openWebWallet, type WalletProposal, type WebWallet } from "../../../wallet/web.ts";
import { assert, describe, waitUntil } from "./page-support.ts";

/** Servers and identities the runner passes to every step. */
export interface GroupStepArgs {
  witness: { origin: string; pre: string };
  mailbox: { origin: string; pre: string };
  /** Wallet store name and passcode. */
  name: string;
  bran: string;
  /** Step specific values. */
  [key: string]: unknown;
}

let wallet: WebWallet | undefined;

/** The open wallet, or a failure naming the missing precondition. */
function open(): WebWallet {
  assert(wallet, "the wallet is not open");
  return wallet;
}

/** The wallet's health as text for a failure message. */
function healthNote(): string {
  return wallet
    ? `\nwallet health: ${JSON.stringify(wallet.health(), (_k, v) => v instanceof Error ? describe(v) : v)}`
    : "";
}

/** A status's `failure` field (a retrying delivery) as text, when it has one. */
function failureNote(status: unknown): string {
  const failure = (status as { failure?: unknown } | null)?.failure;
  return failure ? `\nstatus failure: ${JSON.stringify(failure)}` : "";
}

/** Poll a library read; the failure message carries the wallet's health. */
function until<T>(label: string, read: () => T | undefined, timeoutMs = 90_000): Promise<T> {
  return waitUntil(label, read, healthNote, timeoutMs);
}

/** Resolve an OOBI through the wallet; fail on any other outcome. */
async function resolveOobiUrl(url: string, alias?: string): Promise<void> {
  const result = await open().oobis.resolve(url, { alias });
  assert(result.outcome === "resolved", `OOBI ${url} did not resolve: ${JSON.stringify(result)}${healthNote()}`);
}

/** Step: open a new wallet with a passcode. */
async function openWallet({ name, bran }: GroupStepArgs) {
  assert(!wallet, "a wallet is already open");
  wallet = await openWebWallet({ name, bran, delivery: "direct" });
  return { health: wallet.health().status };
}

/**
 * Step: after a tab reload, open the same store again. The old page's lock is released when its document unloads,
 * which can lag the new page's start, so a held lock is retried for a few seconds.
 */
async function reopenWallet({ name, bran, member, group }: GroupStepArgs) {
  assert(!wallet, "a wallet is already open in this page");
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      wallet = await openWebWallet({ name, bran, delivery: "direct" });
      break;
    } catch (error) {
      if (Date.now() > deadline || !describe(error).includes("already open")) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  const { identifiers, hby } = open();
  // Evidence only: the identifiers are in the reopened store.
  assert(hby.habs.get(member as string), "the browser member is gone after the reload");
  assert(hby.habs.get(group as string), "the group is gone after the reload");
  const status = identifiers.status(member as string, 0);
  assert(status.state === "complete", `member inception after reload: ${JSON.stringify(status)}${healthNote()}`);
  return { health: open().health().status };
}

/** Step: resolve the witness and incept the browser member with it. */
async function inceptMember({ witness }: GroupStepArgs) {
  const { identifiers } = open();
  await resolveOobiUrl(`${witness.origin}/oobi/${witness.pre}/controller`, "witness");
  const incepted = await identifiers.incept({ alias: "browser-member", witnesses: [witness.pre], toad: 1 });
  assert(incepted.outcome === "complete", `member inception ${JSON.stringify(incepted.status)}${healthNote()}`);
  return { member: incepted.pre, sn: incepted.sn, status: incepted.status.state };
}

/** Step: resolve the mailbox host and authorize it for the browser member. */
async function addMailboxHost({ mailbox, member }: GroupStepArgs) {
  await resolveOobiUrl(`${mailbox.origin}/oobi/${mailbox.pre}/controller`, "mailbox");
  const added = await open().mailboxes.add(member as string, mailbox.pre, { timeoutMs: 15_000 });
  assert(added.outcome === "authorized", `mailbox ${JSON.stringify(added)}${healthNote()}`);
  return { mailbox: mailbox.pre, state: added.status.state };
}

/** Step: resolve each OOBI; every one must resolve. */
async function resolveOobis({ oobis }: GroupStepArgs) {
  for (const { url, alias } of oobis as { url: string; alias?: string }[]) await resolveOobiUrl(url, alias);
  return { resolved: (oobis as unknown[]).length };
}

/** A proposal as plain data. */
function summary(proposal: WalletProposal) {
  const { id, family, type, group, proposer, local, complete } = proposal as WalletProposal & { type: string };
  return { id, family, type, group, proposer, local, complete };
}

/** Step: wait for a proposal of `family` and `type` this member has not consented to. */
async function awaitProposal({ family, type, proposer }: GroupStepArgs) {
  const found = await until(
    `proposal ${family}/${type}`,
    () =>
      open().proposals.list().find((item) =>
        item.family === family && item.type === type && (!proposer || item.proposer === proposer)
      ),
  );
  assert(found.local === "unapproved", `proposal already consented: ${JSON.stringify(summary(found))}`);
  return { ...summary(found), event: "event" in found ? found.event : undefined };
}

/** Step: join the proposed group under the alias "group" and wait for the Counselor to complete it. */
async function approveGroupInception({ id }: GroupStepArgs) {
  const approved = await open().proposals.approve(id as string, { groupAlias: "group", timeoutMs: 120_000 });
  assert(
    approved.outcome === "complete",
    `group inception ${JSON.stringify(approved)}${failureNote(approved.status)}${healthNote()}`,
  );
  const listed = open().proposals.list({ all: true }).find((item) => item.id === id);
  const event = listed && "event" in listed ? listed.event : undefined;
  assert(event, "the inception proposal carries no group event");
  return { group: event.pre, sn: event.sn, said: event.said, status: approved.status?.state };
}

/**
 * Step: give this member's one consent to a proposal. `expect` lists the outcomes the lane accepts; the result is
 * the outcome and the status the wallet read at return.
 */
async function approveProposal({ id, expect, registryName, timeoutMs }: GroupStepArgs) {
  const approved = await open().proposals.approve(id as string, {
    registryName: registryName as string | undefined,
    timeoutMs: timeoutMs as number | undefined,
  });
  const outcomes = expect as string[];
  assert(
    outcomes.includes(approved.outcome),
    `proposal ${id}: outcome ${approved.outcome}, wanted ${outcomes.join("|")}: ${JSON.stringify(approved)}${
      failureNote(approved.status)
    }${healthNote()}`,
  );
  return { id: approved.id, family: approved.family, outcome: approved.outcome, status: approved.status?.state };
}

/** Step: post the group's accepted mailbox role to the provider, retrying while the other members' approvals arrive. */
async function completeGroupMailbox({ group, mailbox }: GroupStepArgs) {
  const { groups } = open();
  const deadline = Date.now() + 90_000;
  let last: unknown;
  while (Date.now() < deadline) {
    const done = await groups.completeMailbox(group as string, mailbox.pre, { timeoutMs: 15_000 });
    if (done.outcome === "authorized") return { outcome: done.outcome, state: done.status.state };
    last = done;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`group mailbox not authorized: ${JSON.stringify(last)}${healthNote()}`);
}

/** Step: consent to the group's issuance Grant; the issuance stays active until the registry update is approved. */
async function consentIssuance({ grant, timeoutMs }: GroupStepArgs) {
  const approved = await open().proposals.approve(grant as string, { timeoutMs: timeoutMs as number });
  assert(
    approved.outcome === "timed-out" || approved.outcome === "approved" || approved.outcome === "complete",
    `issuance consent ${JSON.stringify(approved)}${failureNote(approved.status)}${healthNote()}`,
  );
  return { outcome: approved.outcome, status: approved.status?.state };
}

/** Step: wait for the issuance to complete and the browser to hold the registry root and record the credential. */
async function awaitIssued({ grant, group, registry }: GroupStepArgs) {
  const done = await open().proposals.approve(grant as string, { timeoutMs: 150_000 });
  assert(
    done.outcome === "complete",
    `issuance did not complete: ${JSON.stringify(done)}${failureNote(done.status)}${healthNote()}`,
  );
  // Evidence read: the surface has no call for "do I hold this registry's root" (see the report).
  const rooted = await until(
    "registry root copy",
    () => open().hby.mgr.getRegistryRoot(group as string, registry as string) ? true : undefined,
  );
  const issued = await until("inventory record of the group issuance", () => {
    const row = open().credentials.list().issued.find((item) => item.registry === registry);
    return row ? row : undefined;
  });
  return {
    rooted,
    credential: issued.credential,
    registry: issued.registry,
    issued: open().credentials.list().issued.length,
  };
}

/** Step: rotate the browser member's own keys (a group rotation uses its members' current keys). */
async function rotateMember({ member }: GroupStepArgs) {
  const rotated = await open().identifiers.rotate(member as string);
  assert(rotated.outcome === "complete", `member rotation ${JSON.stringify(rotated.status)}${healthNote()}`);
  return { sn: rotated.sn, status: rotated.status.state };
}

/** Step: propose the group rotation as the browser and wait for the others. */
async function rotateGroup({ group }: GroupStepArgs) {
  const rotated = await open().groups.rotate(group as string, { isith: "2", nsith: "2", timeoutMs: 150_000 });
  assert(
    rotated.outcome === "complete",
    `group rotation ${JSON.stringify(rotated)}${failureNote(rotated.status)}${healthNote()}`,
  );
  return { sn: rotated.event.sn, said: rotated.event.said, status: rotated.status.state };
}

/** Step: the wallet told the group's and the member's mailboxes about the rotation. */
async function awaitPublication({ group, member }: GroupStepArgs) {
  const states: Record<string, string[]> = {};
  for (const pre of [member as string, group as string]) {
    const waited = await open().mailboxes.waitForPublication(pre, { timeoutMs: 60_000 });
    states[pre] = waited.entries.map((entry) => entry.state);
    assert(
      waited.outcome === "settled" && waited.entries.length > 0 && waited.entries.every((e) => e.state === "published"),
      `KEL publication of ${pre}: ${JSON.stringify(waited)}${healthNote()}`,
    );
  }
  return { published: states };
}

/** Step: group mail after the rotation: a Grant sent to the group shows up as pending for the group. */
async function awaitGroupGrant({ group, grant }: GroupStepArgs) {
  const found = await until(
    "pending Grant addressed to the group",
    () => open().credentials.pending(group as string).find((pending) => pending.grant === grant),
  );
  return { grant: found.grant };
}

/** Step: close and check that the wallet's Web Lock is free. */
async function closeAndCheckLock({ name }: GroupStepArgs) {
  await open().close();
  wallet = undefined;
  const { storeLockKey } = await import("../../runtime-web.ts");
  const key = storeLockKey({ name, base: "", temp: false });
  const held = await navigator.locks.query();
  const holders = (held.held ?? []).filter((lock) => lock.name === key);
  assert(holders.length === 0, `the store lock is still held: ${JSON.stringify(holders)}`);
  return { lock: key, held: false };
}

/** Why a step is stuck, for the entry point to append to a failure. */
export function crashCause(): Promise<string> {
  const health = wallet?.health();
  return Promise.resolve(health && health.status !== "ok" ? healthNote() : "");
}

/** Steps by name, as the runner calls them. */
export const steps: Record<string, (args: GroupStepArgs) => Promise<unknown>> = {
  openWallet,
  reopenWallet,
  inceptMember,
  addMailboxHost,
  resolveOobis,
  awaitProposal,
  approveGroupInception,
  approveProposal,
  completeGroupMailbox,
  consentIssuance,
  awaitIssued,
  rotateMember,
  rotateGroup,
  awaitPublication,
  awaitGroupGrant,
  closeAndCheckLock,
};
