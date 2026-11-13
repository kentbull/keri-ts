/**
 * `recoverWebWallet`: the documented recovery of a browser wallet, as one call.
 *
 * A latched composition never accepts commits again (ADR-0015 rule 3); recovery is a new composition. This
 * module only sequences what already exists: `WebWallet.close()`, `openWebWallet()` (which loads the durable
 * prefix of the store), and, for a group member whose group record did not survive, `oobis.resolve` for the
 * co-members and `groups.rejoin`. It returns a new `WebWallet`; the old handle stays closed.
 *
 * The embedder decides when to call it, typically when `health()` reports `latched` or `persistenceStatus()`
 * reads `latched`. The wallet never recovers by itself.
 */
import { AppError, type RejoinResult, systemClock, ValidationError } from "keri-ts/runtime";
import { openWebWallet, type OpenWebWalletOptions, type WebWallet } from "./open-web-wallet.ts";
import { WALLET_TIMEOUTS } from "./surface.ts";

/** Reopen attempts made unless `RecoverWebWalletOptions.attempts` says otherwise. */
export const RECOVER_ATTEMPTS = 3;

/** Fixed pause, in milliseconds on the host clock, between two reopen attempts. */
export const RECOVER_RETRY_DELAY_MS = 250;

/** Every reopen attempt of {@link recoverWebWallet} failed; `cause` is the last failure. */
export class WalletRecoveryError extends AppError {
  override readonly name: string = "WalletRecoveryError";
}

/**
 * The group a recovered wallet should belong to, for a host whose store may have lost the group record.
 * `member` is the prefix of the local single-signature member; the other fields are those of `groups.rejoin`.
 */
export interface RecoverGroupOptions {
  /** OOBI of the group, served by a co-member that holds its KEL. */
  oobi: string;
  /** Group prefix. */
  group: string;
  /** Local alias the group record takes. */
  alias: string;
  /** Prefix of the local single-signature member identifier. */
  member: string;
  /** OOBIs of the other members; a group OOBI carries only the group's KEL, and the rejoin needs theirs too. */
  memberOobis: string[];
  /** Budget of each member OOBI resolution and of the rejoin wait; `WALLET_TIMEOUTS.oobi` when absent. */
  timeoutMs?: number;
}

/** Everything `recoverWebWallet` takes. */
export interface RecoverWebWalletOptions {
  /**
   * How to open the wallet again: the same options the host gave `openWebWallet`, held signers and `delivery`
   * included. `delivery` passes through unchanged, so a wallet that delivered through its agent reopens behind the
   * same relay and resolves the member OOBIs and rejoins through it.
   */
  open: OpenWebWalletOptions;
  /** The group to rejoin when its record is missing after the reopen. */
  group?: RecoverGroupOptions;
  /** Reopen attempts, at least 1; {@link RECOVER_ATTEMPTS} when absent. */
  attempts?: number;
}

/**
 * Why a recovery ran no rejoin:
 * - `no-group`: the options named no group;
 * - `group-recorded`: the reopened wallet already holds a record of the group;
 * - `member-missing`: the reopened wallet has no habitat for `member` (a wiped store). The host adopts its
 *   member and then calls `groups.rejoin` itself; see {@link recoverWebWallet}.
 */
export type RecoverSkip = "no-group" | "group-recorded" | "member-missing";

/**
 * A recovered wallet: the new handle, and either the rejoin's typed outcome or why no rejoin ran.
 * A `rejoin` other than `joined` is a remote outcome to act on, not a failed recovery: the wallet is open. A
 * `joined` rejoin that wrote the record (`written: true`) is the signal to refill the store from a co-member.
 */
export type RecoveredWebWallet =
  | { wallet: WebWallet; rejoin: RejoinResult; skipped?: undefined }
  | { wallet: WebWallet; rejoin: null; skipped: RecoverSkip };

/**
 * Close `wallet`, open it again with `options.open`, and rejoin `options.group` when its record is missing.
 *
 * Steps:
 * 1. `wallet.close()`. A latched or stopped wallet rejects its close with the failure it already reported, and a
 *    closed one returns the same settled close; that rejection is expected and ignored, because `close()` still
 *    stopped the runtime, closed every store and released the lock.
 * 2. `openWebWallet(options.open)`, up to `options.attempts` times with a fixed {@link RECOVER_RETRY_DELAY_MS}
 *    pause on the host clock between attempts. The reopened stores hold the durable prefix: every commit made
 *    durable before the latch, and nothing after it.
 * 3. With `options.group`, when the reopened wallet has no record of the group and holds the member habitat:
 *    resolve each of `memberOobis`, then `groups.rejoin`. A member OOBI that fails is not reported on its own;
 *    the rejoin then ends `timed-out` with `waiting: "member-key-state"`.
 *
 * A wiped store (no member habitat) is not repaired here, because adopting the member needs the host's own
 * signed inception: the result is `skipped: "member-missing"`. The host then adopts its keyless member with
 * `wallet.hby.makeSignedHab(alias, undefined, { serder, sigers })`, passing the member's inception and the
 * signatures it kept, holds the member's signer (`heldSigners` at open, or `wallet.hby.mgr.hold([signer])`),
 * resolves the co-members' OOBIs (`wallet.oobis.resolve`) and calls `wallet.groups.rejoin`; behind a relay it also
 * takes the onboarding steps `wallet.relayStatus()` lists again, since the wiped store lost its mailbox roles.
 * Neither path restores
 * credentials, registry state or exchanges. A `joined` rejoin with `written: true` says this identifier was already
 * a member and the store had no record of the group, so it holds none of the group's credentials either: refill
 * them from a co-member (its `listGroupDisclosures` and `exportDisclosureStream`, the registry root copy, then
 * `credentials.importStream` and `credentials.rebuild` here; see the wallet library guide).
 *
 * The returned wallet is a new handle; drop the old one. On the old handle `health()` reads `closed` and every
 * call fails: with `WalletStoppedError` from the wallet (workflow calls, `readPersisted`), or with
 * `DatabaseNotOpenError` when the call reads one of its closed stores first (synchronous reads).
 *
 * @throws ValidationError when `options.attempts` is not a positive integer, or for misuse `groups.rejoin`
 * refuses (the new wallet is closed first).
 * @throws WalletRecoveryError when every reopen attempt failed; `cause` is the last failure.
 */
export async function recoverWebWallet(
  wallet: WebWallet,
  options: RecoverWebWalletOptions,
): Promise<RecoveredWebWallet> {
  const attempts = options.attempts ?? RECOVER_ATTEMPTS;
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new ValidationError(`Recovery attempts must be a positive integer, not ${attempts}.`);
  }
  await wallet.close().catch(() => {});
  const reopened = await reopen(options.open, attempts);
  try {
    return await rejoinMissingGroup(reopened, options.group);
  } catch (error) {
    await reopened.close().catch(() => {});
    throw error;
  }
}

/** Open the wallet, retrying a failure up to `attempts` times in all. */
async function reopen(open: OpenWebWalletOptions, attempts: number): Promise<WebWallet> {
  const clock = open.host?.clock ?? systemClock;
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await openWebWallet(open);
    } catch (error) {
      last = error;
    }
    if (attempt < attempts) {
      await new Promise<void>((resolve) => clock.setTimeout(resolve, RECOVER_RETRY_DELAY_MS));
    }
  }
  throw new WalletRecoveryError(`The web wallet did not reopen in ${attempts} attempt(s).`, { cause: last });
}

/** Rejoin `group` when the reopened wallet lacks its record but holds its member; otherwise say why not. */
async function rejoinMissingGroup(wallet: WebWallet, group?: RecoverGroupOptions): Promise<RecoveredWebWallet> {
  if (!group) return { wallet, rejoin: null, skipped: "no-group" };
  if (wallet.hby.db.getHab(group.group)?.mid) return { wallet, rejoin: null, skipped: "group-recorded" };
  if (!wallet.hby.habs.has(group.member)) return { wallet, rejoin: null, skipped: "member-missing" };
  const timeoutMs = group.timeoutMs ?? WALLET_TIMEOUTS.oobi;
  await Promise.all(group.memberOobis.map((url) => wallet.oobis.resolve(url, { timeoutMs })));
  const rejoin = await wallet.groups.rejoin({
    oobi: group.oobi,
    group: group.group,
    member: group.member,
    alias: group.alias,
    timeoutMs,
  });
  return { wallet, rejoin };
}
