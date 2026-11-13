/**
 * Counterparty-side building blocks of the group lanes: the Tufa CLI members and holder the control server runs, and
 * the helpers that start commands in the background, join them, and read their JSON output. The lanes
 * (`group-scenario.ts`, `keripy-member-scenario.ts`) compose these into named steps.
 */

import type { Context, PeerResult } from "./scenario.ts";

/** Passcode of every counterparty store. */
export const BRAN = "abcdefghijklmnopqrstu";
/** KRAM windows long enough for a live multi-process group exchange (the interop tests' `LIVE_KRAM_CACHES`). */
const LIVE_KRAM_CACHES = [1000, 60000, 60000, 300000, 60000, 60000, 300000];

/** One Tufa identifier on the control server: its own LMDB store under /work/peer. */
export interface TufaParty {
  alias: string;
  store: string[];
  pre: string;
}

/** `tufa` store options for the store `name` on the control server. */
export function tufaStore(name: string): string[] {
  return ["-n", name, "--head-dir", "/work/peer", "-p", BRAN];
}

/** Every JSON object line a command printed. */
export function jsonLines(output: string): Record<string, unknown>[] {
  return output.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith("{")).map((line) =>
    JSON.parse(line)
  );
}

/** The last JSON line of a command's output, or a failure naming the command. */
export function lastJson(label: string, result: PeerResult): Record<string, unknown> {
  const line = jsonLines(result.stdout).at(-1);
  if (!line) throw new Error(`${label} printed no JSON result:\n${result.stdout}\n${result.stderr}`.slice(0, 3000));
  return line;
}

/** First capture of `pattern` in `text`. */
export function capture(text: string, pattern: RegExp): string {
  const match = text.match(pattern);
  if (!match) throw new Error(`no ${pattern} in output:\n${text}`);
  return match[1] ?? match[0];
}

/** A command or page call started now; its outcome is read later and an unread failure is never unhandled. */
export interface Started<T> {
  label: string;
  outcome: Promise<PromiseSettledResult<T>>;
}

/** Start `work` and keep its outcome. */
export function start<T>(label: string, work: Promise<T>): Started<T> {
  return { label, outcome: Promise.allSettled([work]).then(([settled]) => settled) };
}

/** Wait for every started side; one error names every side that failed, so one failure does not hide another. */
export async function finish<T>(...sides: Started<T>[]): Promise<T[]> {
  const outcomes = await Promise.all(sides.map((side) => side.outcome));
  const failures = outcomes.flatMap((outcome, index) =>
    outcome.status === "rejected"
      ? [`${sides[index].label}: ${outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)}`]
      : []
  );
  if (failures.length) throw new Error(failures.join("\n---\n"));
  return outcomes.map((outcome) => (outcome as PromiseFulfilledResult<T>).value);
}

/** `<mailbox origin>/oobi/<pre>/mailbox/<mailbox>`: the OOBI that names the shared mailbox. */
export function mailboxOobi(ctx: Context, pre: string): string {
  const { mailbox } = ctx.servers;
  return `${mailbox.origin}/oobi/${pre}/mailbox/${mailbox.pre}`;
}

/** `<witness origin>/oobi/<pre>/witness/<witness>`: where a witnessed KEL, including its rotations, is fetched. */
export function witnessOobi(ctx: Context, pre: string): string {
  const { witness } = ctx.servers;
  return `${witness.origin}/oobi/${pre}/witness/${witness.pre}`;
}

/**
 * Provision a witnessed v2 Tufa identifier on the shared mailbox with live KRAM, as an operator would before the
 * first v2 IPEX Grant: init, KRAM, resolve the witness and the mailbox, incept, authorize the mailbox.
 */
export async function provisionTufa(ctx: Context, name: string, alias: string): Promise<TufaParty> {
  const { peer, servers } = ctx, store = tufaStore(name);
  await peer(["init", ...store]);
  await ctx.peerConfig({ kram: { enabled: true, denials: [], caches: { "~": LIVE_KRAM_CACHES } } }, name);
  await peer(["oobi", "resolve", ...store, "-u", `${servers.witness.origin}/oobi/${servers.witness.pre}/controller`]);
  await peer(["oobi", "resolve", ...store, "-u", `${servers.mailbox.origin}/oobi/${servers.mailbox.pre}/controller`]);
  const incepted = await peer([
    ...["incept", ...store, "--version", "2.0", "--alias", alias, "--transferable"],
    ...["--icount", "1", "--ncount", "1", "--toad", "1", "--wits", servers.witness.pre, "--receipt-endpoint"],
  ]);
  const pre = capture(incepted.stdout, /Prefix\s+(\S+)/);
  await peer(["mailbox", "add", ...store, "-a", alias, "-w", servers.mailbox.pre]);
  return { alias, store, pre };
}

/** Make `party` learn each OOBI. */
export async function resolveAll(ctx: Context, party: TufaParty, urls: string[]): Promise<void> {
  for (const url of urls) await ctx.peer(["oobi", "resolve", ...party.store, "-u", url]);
}

/** The accepted key state of `pre` in `party`'s store: sequence number and latest event SAID. */
export async function keyStateOf(ctx: Context, party: TufaParty, pre: string): Promise<{ sn: number; said: string }> {
  const dumped = await ctx.peer(["db", "dump", "baser.states", ...party.store.slice(0, 4), "--prefix", pre]);
  return { sn: parseInt(capture(dumped.stdout, /"s": "(\w+)"/), 16), said: capture(dumped.stdout, /"d": "(\S+)"/) };
}

/** `multisig join --auto` for the group alias `group`, waiting up to `seconds` for a proposal and its acceptance. */
export function joinGroup(ctx: Context, party: TufaParty, seconds: number): Promise<PeerResult> {
  return ctx.peer(
    [
      ...["multisig", "join", ...party.store, "--group", "group", "--auto"],
      ...["--approval-timeout", String(seconds), "--receipt-endpoint"],
    ],
    (seconds + 40) * 1000,
  );
}
