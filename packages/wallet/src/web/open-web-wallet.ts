/**
 * `openWebWallet`: the one composition root a browser app calls.
 *
 * It only sequences pieces `keri-ts` already owns: one IndexedDB opener (so one persistence
 * queue and one commit order, and the opener's single-writer lock), `openHabery`,
 * the wallet inventory, `createAgentRuntime` over the output-barrier HTTP client,
 * and `runAgentRuntime`. It wires no protocol processor itself.
 *
 * Recovery from a latched composition (ADR-0015 rule 3): `close()` reports the
 * persistence failure but still stops everything and releases the lock, after
 * which `openWebWallet()` with the same name loads exactly the durable prefix. `recoverWebWallet()`
 * (recover-web-wallet.ts) performs that sequence and returns the new handle.
 */
import { Salter } from "cesr-ts";
import { call, createScope, type Operation, run, spawn, suspend } from "effection";
import type { PersistenceStatus, WebStoreOpener } from "keri-ts/db";
import { indexedDbOpener, type IndexedDbOpenerOptions } from "keri-ts/db/indexeddb";
import {
  type AgentRuntime,
  type AgentRuntimeOptions,
  AppError,
  type ChangeSink,
  createAgentRuntime,
  type CredentialViews,
  FetchHttpClient,
  type Habery,
  type HeldSigners,
  type HttpClient,
  type KramConfig,
  openHabery,
  type OwnerFault,
  runAgentRuntime,
  type RuntimeClock,
  signalerChangeSink,
  systemClock,
  type UnsignableHab,
  ValidationError,
} from "keri-ts/runtime";
import {
  barrierHttpClient,
  type PersistentStorageManager,
  type PersistentStorageResult,
  requestPersistentStorage,
  type StoreLockManager,
} from "keri-ts/runtime/web";
import { WalletDerivedUpdates } from "../custody.ts";
import { openWalletBaser, type WalletBaser } from "../storing.ts";
import { Wallet } from "../wallet.ts";
import {
  createWalletApi,
  type TrackedIssuances,
  type WalletApi,
  walletChangeSink,
  WalletStoppedError,
} from "./wallet-api.ts";

/**
 * KRAM windows a web wallet uses unless its host passes `runtime.kram`, as one catchall row in milliseconds in
 * the order `[d, sl, ll, xl, psl, pll, pxl]` of `KramWindows`. A mailbox wallet may be offline for hours and then
 * drain its mailbox, so strictness would drop Grants that were stamped long before they were read:
 * - `d`, clock drift: 5 minutes;
 * - `sl`, `ll`, `xl`, the single-key, multi-key and exchange acceptance (lag/replay) windows: 24 hours each;
 * - `psl`, `pll`, `pxl`, the pruning windows, which may not be shorter than the acceptance windows: 24 hours each.
 * No field is left at a library default. KERIpy requires explicit windows; these are looser than its tests use.
 */
export const WALLET_KRAM_CACHES: NonNullable<KramConfig["caches"]> = Object.freeze({
  "~": Object.freeze([300_000, 86_400_000, 86_400_000, 86_400_000, 86_400_000, 86_400_000, 86_400_000] as const),
});

/** The keeper would hold plaintext seeds in IndexedDB, so the wallet refuses to open it. */
export class UnencryptedKeeperError extends AppError {
  override readonly name: string = "UnencryptedKeeperError";
}

/**
 * A salt was supplied at open, but the keeper already stores a different root salt. The Manager writes its root
 * salt only into a store that has none, so the supplied salt would silently not be the one in use. The wallet is
 * closed before this is thrown; neither salt appears in the message.
 */
export class KeeperSaltMismatchError extends AppError {
  override readonly name: string = "KeeperSaltMismatchError";
}

/** Page events that ask for a best-effort flush. */
export interface PageLifecycleTargets {
  /** Receives `pagehide`. */
  page: EventTarget;
  /** Receives `visibilitychange`; a flush is requested when `visibilityState` is `"hidden"`. */
  document: EventTarget & { readonly visibilityState?: string };
}

/** Browser services, each defaulting to the page's own. Tests and non-page hosts inject them. */
export interface WebWalletHost {
  /** IndexedDB implementation; defaults to the browser globals. */
  indexedDb?: IndexedDbOpenerOptions;
  /** Web Locks; `null` simulates an engine without them and fails the open. */
  locks?: StoreLockManager | null;
  /** `navigator.storage`; the persistence request never fails the open. */
  storage?: PersistentStorageManager;
  /** Network beneath the output barrier; defaults to `fetch`. */
  http?: HttpClient;
  clock?: RuntimeClock;
  /** `null` registers no lifecycle handlers; the default is `globalThis` and `document` when present. */
  lifecycle?: PageLifecycleTargets | null;
}

/** Secret material that makes the keeper encrypted: a passcode, or the seed and its AEID. */
export type WebWalletSecret = { bran: string; seed?: undefined; aeid?: undefined } | {
  bran?: undefined;
  seed: string;
  aeid: string;
};

/** Everything `openWebWallet` takes. */
export type OpenWebWalletOptions = WebWalletSecret & {
  /** Store identity: one wallet per `name` and `base`, in one tab at a time. */
  name: string;
  base?: string;
  /**
   * Passed to `createAgentRuntime`. Every runtime composes the per-identifier DH and Unblind owners;
   * the wallet enables KRAM by default because their `approve` needs it, with wallet-sized windows.
   * Obtain the owners per identifier after open with `runtime.ipex.dhke(hab)` and
   * `runtime.ipex.unblind(hab)`.
   */
  runtime?: Pick<AgentRuntimeOptions, "kram" | "operationStores">;
  /**
   * Signers for identifiers whose keys the host keeps (`makeSignedHab`), held in the Manager as the Habery opens,
   * before the runtime starts: the first mailbox poll of such an identifier is signed. Held signers are not
   * stored; pass them again at every open.
   */
  heldSigners?: HeldSigners;
  /**
   * The keeper's root salt, as the qb64 of a 128-bit salt. A fresh store stores it as its root salt, so the
   * identifiers derived from it (the signator and every salty habitat by name) come back from the same
   * passcode and salt on a new store. A store that already has a root salt must hold this one:
   * `openWebWallet` rejects with `KeeperSaltMismatchError` otherwise. Omitted, a fresh store makes a random
   * salt and an existing store keeps its own. A malformed salt rejects with `ValidationError` before any
   * store opens.
   */
  salt?: string;
  host?: WebWalletHost;
};

/**
 * What the wallet can still do:
 * - `ok`;
 * - `latched`: a persistence write failed, so every store refuses commits (reads continue);
 * - `faulted`: the runtime runs, but an operations owner pass failed outside any single operation
 *   (`faults` of them, the latest in `last`);
 * - `stopped`: the runtime task ended without `close()`, so the stores are closed and the lock released;
 *   `cause` is the failure that ended it;
 * - `closed`: `close()` was called.
 * - `mailbox-unreachable`: the runtime gave up telling a mailbox an identifier's rotated KEL (five minutes of
 *   backed-off attempts), so the wallet cannot receive from it until it is told; a new rotation, a successful poll
 *   of that mailbox or reopening the wallet tries again.
 * - `signer-unavailable`: a local identifier cannot sign because the host has not held its signer (the wallet was
 *   opened without it); `identifiers` names each with the public keys it lacks (`Habery.unsignable`, read now).
 *   Background loops skip such an identifier and act for it on the next tock after `Manager.hold`.
 * Precedence: `closed`, `stopped`, `latched`, `faulted`, `mailbox-unreachable`, `signer-unavailable`, `ok`.
 */
export type WebWalletHealth =
  | { status: "ok" }
  | { status: "latched"; cause: unknown }
  | { status: "faulted"; faults: number; last: OwnerFault | null }
  | { status: "mailbox-unreachable"; mailboxes: readonly { pre: string; mailbox: string; reason: string | null }[] }
  | { status: "signer-unavailable"; identifiers: readonly UnsignableHab[] }
  | { status: "stopped"; cause: unknown }
  | { status: "closed" };

/** An open browser wallet. */
export interface WebWallet extends WalletApi {
  readonly hby: Habery;
  readonly runtime: AgentRuntime;
  /** Protocol-side wallet over `hby`, the runtime's exchanger and v2 registry, and `inventory`. */
  readonly wallet: Wallet;
  /** Application inventory on the composition's shared queue. */
  readonly inventory: WalletBaser;
  /** The composition's opener; `opener.queue` orders every commit. */
  readonly opener: WebStoreOpener;
  /**
   * Outcome of the persistence request made at open; warn the user when `persisted` is false. A
   * promise because some engines (Firefox) hold the request on a permission prompt, and a prompt
   * must not hold the wallet closed. It never rejects.
   */
  readonly storage: Promise<PersistentStorageResult>;
  /**
   * Whether persistence is still accepting commits. A failed write is retried in place for about half a
   * second; if it still fails, every store of the composition refuses commits and reads continue.
   * Recover with `recoverWebWallet()`, which closes this handle, reopens and returns a new one.
   */
  health(): WebWalletHealth;
  /**
   * The composition's persistence queue now: `healthy`, `retrying` while a failed write is retried in
   * place (later commits wait behind it), or `latched` once it gave up, which `health()` reports with
   * the cause.
   */
  persistenceStatus(): PersistenceStatus;
  /**
   * Run `task` on the composition's persistence queue, after every commit made before this call is
   * durable, and resolve with its result; for reading what the stores persisted. A throwing `task`
   * rejects only this call, with `PersistenceReadError`, and never latches the wallet. After a latch it
   * still runs, against the durable prefix only. After `close()` or a runtime stop it rejects with
   * `WalletStoppedError` and does not run `task`.
   */
  readPersisted<T>(task: () => Promise<T>): Promise<T>;
  /**
   * Stop the runtime, flush and close every store, then release the lock, in that order, even
   * if one step fails. Rejects with the failures after all steps ran. Idempotent.
   */
  close(): Promise<void>;
}

/** What the composition hands back once it is running. */
type Composed = Omit<WebWallet, "health" | "persistenceStatus" | "readPersisted" | "close" | keyof WalletApi> & {
  readonly flush: () => Operation<void>;
  readonly changes: ChangeSink;
  readonly tracked: TrackedIssuances;
};

/** Refuse arguments that cannot encrypt the keeper, before any store is touched. */
function assertSecret({ bran, seed, aeid }: WebWalletSecret): void {
  if (!bran && !(seed && aeid)) {
    throw new UnencryptedKeeperError("A web wallet needs a passcode (bran), or a seed with its aeid");
  }
}

/**
 * Parse a caller's keeper salt into canonical qb64, before any store opens.
 *
 * `Salter` accepts only the 128-bit salt code, so text that is not a salt primitive, or a salt of another size,
 * is refused here instead of being normalized by the keeper into a different 128-bit salt.
 */
function parseSalt(salt: string): string {
  try {
    return new Salter({ qb64: salt }).qb64;
  } catch (cause) {
    throw new ValidationError("The keeper salt is not the qb64 of a 128-bit salt", { cause });
  }
}

/** Run `step`, recording a failure instead of throwing, so later steps still run. */
function* settle(failures: unknown[], step: () => Operation<unknown>): Operation<void> {
  try {
    yield* step();
  } catch (error) {
    failures.push(error);
  }
}

/**
 * The composition. It owns its lifetime: halting it closes everything in reverse acquisition
 * order. It never throws; `finish` receives the opening failure, a runtime crash, or the close
 * failures (all steps still run), because a halted task does not report a failing finalizer.
 */
function* compose(
  options: OpenWebWalletOptions,
  deliver: (composed: Composed) => void,
  finish: (error?: unknown) => void,
): Operation<void> {
  const { name, base = "", host = {} } = options;
  const failures: unknown[] = [];
  let opening: { error: unknown } | undefined;
  try {
    assertSecret(options);
    const salt = options.salt === undefined ? undefined : parseSalt(options.salt);
    // The opener takes the single-writer lock in the first store's reopen, before any store loads,
    // and releases it when the last store closes.
    const opener = indexedDbOpener({
      ...host.indexedDb,
      ...(host.locks === undefined ? {} : { locks: host.locks }),
    });
    const hby = yield* openHabery({
      name,
      base,
      opener,
      skipConfig: true,
      bran: options.bran,
      seed: options.seed,
      aeid: options.aeid,
      heldSigners: options.heldSigners,
      salt,
    });
    const storage = requestPersistentStorage(host.storage);
    try {
      // Arguments alone do not prove encryption. The Manager encrypts only when the keeper stores an
      // AEID and holds the matching seed, so check that state, which is what protects seeds at rest.
      if (!hby.mgr.aeid || !hby.mgr.seed) {
        throw new UnencryptedKeeperError("The keeper holds no AEID, so it would store plaintext seeds");
      }
      // The Manager keeps a stored root salt over a supplied one, so a salt that was not stored is not in use.
      if (salt !== undefined && hby.mgr.salt !== salt) {
        throw new KeeperSaltMismatchError("The keeper stores a root salt other than the one supplied");
      }
      const inventory = yield* openWalletBaser(hby.opener, hby.storeIdentity());
      try {
        yield* scoped(function*() {
          const http = barrierHttpClient(host.http ?? new FetchHttpClient(), () => opener.queue.flushed());
          // Owners publish to the wallet's sink, which forwards to the host's (or else the runtime's
          // Signaler) and records finished issuances in the inventory.
          const tracked: TrackedIssuances = new Map();
          let signaler: AgentRuntime["signaler"] = null;
          const hostChanges = options.runtime?.operationStores?.changes;
          const changes = walletChangeSink(
            tracked,
            () => hostChanges ?? (signaler ? signalerChangeSink(signaler) : undefined),
          );
          // Presentation selects credentials from the wallet's inventory, which needs the runtime to exist first.
          let inventoryWallet: Wallet | undefined;
          const views: CredentialViews = {
            issued: (said) => inventoryWallet!.issued(said),
            issuedRegistry: (said) => inventoryWallet!.issuedRegistry(said),
            held: (grant, held) => inventoryWallet!.held(grant, held),
          };
          const runtime = yield* createAgentRuntime(hby, http, host.clock ?? systemClock, {
            ...options.runtime,
            // The operation owners record blind-derivation coordinates where the wallet's own custody
            // reads them back; a process-local default would hide them from `recordIssued`.
            operationStores: {
              derived: new WalletDerivedUpdates(inventory),
              views,
              ...options.runtime?.operationStores,
              changes,
            },
            kram: options.runtime?.kram ?? { enabled: true, caches: WALLET_KRAM_CACHES },
          });
          signaler = runtime.signaler;
          try {
            const worker = yield* spawn(() => runAgentRuntime(runtime, { pollMailbox: true }));
            try {
              const wallet = inventoryWallet = new Wallet({
                hby,
                registry: runtime.acdc!.store,
                exc: runtime.exc,
                db: inventory,
              });
              deliver({
                hby,
                runtime,
                wallet,
                inventory,
                opener,
                storage,
                changes,
                tracked,
                flush: function*() {
                  yield* hby.db.flushed();
                  yield* hby.ks.flushed();
                  yield* inventory.flushed();
                },
              });
              yield* suspend();
            } finally {
              yield* settle(failures, () => worker.halt());
            }
          } finally {
            yield* settle(failures, () => runtime.close());
          }
        });
      } finally {
        yield* settle(failures, () => inventory.close());
      }
    } finally {
      yield* settle(failures, () => hby.close());
    }
  } catch (error) {
    opening = { error };
  } finally {
    const all = opening ? [opening.error, ...failures] : failures;
    finish(all.length <= 1 ? all[0] : new AggregateError(all, "Web wallet failed", { cause: all[0] }));
  }
}

/** Run `body` in a child scope whose resources are released when it returns or is halted. */
function* scoped(body: () => Operation<void>): Operation<void> {
  const [scope, destroy] = createScope();
  try {
    yield* call(() => scope.run(body));
  } finally {
    yield* call(() => destroy());
  }
}

/**
 * Open (or create) a browser wallet. See {@link OpenWebWalletOptions}.
 *
 * Order: create one IndexedDB opener; open the Habery, whose first store takes the opener's
 * store lock before it loads anything; request persistent storage; refuse an unencrypted keeper, or a supplied
 * salt other than the stored one; open the inventory on the same queue; create the
 * runtime over the output-barrier HTTP client; run it with mailbox polling. A failure at any
 * step closes what was opened, releases the lock and rejects.
 *
 * Page `pagehide` and hidden `visibilitychange` request a flush of the stores. That is best
 * effort only (ADR-0015 rule 5): a browser need not wait for it. The output barrier on the
 * runtime's HTTP client is the real protection, so nothing leaves the page ahead of its commit.
 *
 * @throws StoreLockHeldError when another tab holds this wallet.
 * @throws StoreLockUnsupportedError when Web Locks are unavailable.
 * @throws UnencryptedKeeperError when the keeper would not be encrypted.
 * @throws ValidationError when `salt` is not a 128-bit qb64 salt, before any store opens.
 * @throws KeeperSaltMismatchError when `salt` differs from the root salt the keeper already stores.
 */
export async function openWebWallet(options: OpenWebWalletOptions): Promise<WebWallet> {
  let delivered!: (composed: Composed) => void;
  let refused!: (error: unknown) => void;
  let finished!: (error?: unknown) => void;
  const ready = new Promise<Composed>((resolve, reject) => {
    delivered = resolve;
    refused = reject;
  });
  const done = new Promise<unknown>((resolve) => finished = resolve);
  let running = false;
  const task = run(() =>
    compose(options, (composed) => {
      running = true;
      delivered(composed);
    }, (error) => {
      if (!running && error !== undefined) refused(error);
      finished(error);
    })
  );
  const composed = await ready;
  const { flush, changes, tracked, ...parts } = composed;
  // The composition ends on its own only when the runtime crashed; `close()` ends it deliberately.
  let stopped: { cause: unknown } | undefined;
  let closing: Promise<void> | undefined;
  void done.then((cause) => {
    if (!closing) stopped = { cause };
  });
  const assertRunning = () => {
    if (closing) throw new WalletStoppedError("The web wallet is closed.");
    if (stopped) throw new WalletStoppedError("The web wallet's runtime stopped.", { cause: stopped.cause });
  };
  const api = createWalletApi({
    hby: parts.hby,
    runtime: parts.runtime,
    wallet: parts.wallet,
    inventory: parts.inventory,
    changes,
    tracked,
    assertRunning,
  });
  const lifecycle = options.host?.lifecycle === undefined ? pageTargets() : options.host.lifecycle;
  const requestFlush = () => void run(flush).then(undefined, () => {});
  const onHide = () => requestFlush();
  const onVisibility = () => {
    if (lifecycle?.document.visibilityState === "hidden") requestFlush();
  };
  lifecycle?.page.addEventListener("pagehide", onHide);
  lifecycle?.document.addEventListener("visibilitychange", onVisibility);
  return {
    ...parts,
    ...api,
    health(): WebWalletHealth {
      if (closing) return { status: "closed" };
      if (stopped) return { status: "stopped", cause: stopped.cause };
      try {
        parts.opener.queue.assertHealthy();
      } catch (error) {
        return { status: "latched", cause: (error as Error).cause };
      }
      const owners = parts.runtime.operations?.health;
      if (owners?.faults) return { status: "faulted", faults: owners.faults, last: owners.last };
      const unreachable = parts.runtime.kelPublisher.status().entries.filter((entry) => entry.state === "timed-out");
      if (unreachable.length) {
        return {
          status: "mailbox-unreachable",
          mailboxes: unreachable.map(({ pre, mailbox, lastFailure }) => ({
            pre,
            mailbox,
            reason: lastFailure ?? null,
          })),
        };
      }
      const unsignable = parts.runtime.hby.unsignable();
      if (unsignable.length) return { status: "signer-unavailable", identifiers: unsignable };
      return { status: "ok" };
    },
    persistenceStatus: () => parts.opener.queue.status(),
    readPersisted: async (task) => {
      // A closed or stopped wallet has released its stores; reading would see whatever the connections left.
      assertRunning();
      return await parts.opener.queue.read(task);
    },
    close: () =>
      closing ??= (async () => {
        lifecycle?.page.removeEventListener("pagehide", onHide);
        lifecycle?.document.removeEventListener("visibilitychange", onVisibility);
        await task.halt();
        const error = await done;
        if (error !== undefined) throw error;
      })(),
  };
}

/** The page and document when running in one. Not `globalThis`: the npm build would shim it for Node. */
function pageTargets(): PageLifecycleTargets | null {
  return typeof document === "undefined" ? null : { page: self, document };
}
