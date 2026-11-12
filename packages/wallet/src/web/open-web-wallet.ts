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
 * which `openWebWallet()` with the same name loads exactly the durable prefix.
 */
import { call, createScope, type Operation, run, spawn, suspend } from "effection";
import type { WebStoreOpener } from "keri-ts/db";
import { indexedDbOpener, type IndexedDbOpenerOptions } from "keri-ts/db/indexeddb";
import {
  type AgentRuntime,
  type AgentRuntimeOptions,
  AppError,
  createAgentRuntime,
  FetchHttpClient,
  type Habery,
  type HttpClient,
  openHabery,
  runAgentRuntime,
  type RuntimeClock,
  systemClock,
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

/** The keeper would hold plaintext seeds in IndexedDB, so the wallet refuses to open it. */
export class UnencryptedKeeperError extends AppError {}

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
   * Passed to `createAgentRuntime`. The wallet enables `ipexOwners: "per-identifier"` and KRAM by
   * default, because DH and Unblind owners need KRAM; obtain them per identifier after open with
   * `runtime.ipex.dhke(hab)` and `runtime.ipex.unblind(hab, states)`. Disabling KRAM fails the open.
   */
  runtime?: Pick<AgentRuntimeOptions, "kram" | "ipexAuxiliary" | "ipexOwners" | "operationStores">;
  host?: WebWalletHost;
};

/** `ok`, or the failed persistence write that latched the composition. */
export type WebWalletHealth = { status: "ok" } | { status: "latched"; cause: unknown };

/** An open browser wallet. */
export interface WebWallet {
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
   * Whether persistence is still accepting commits. After one failed write every store of the
   * composition refuses commits; reads continue. Recover with `close()` then `openWebWallet()`.
   */
  health(): WebWalletHealth;
  /**
   * Stop the runtime, flush and close every store, then release the lock, in that order, even
   * if one step fails. Rejects with the failures after all steps ran. Idempotent.
   */
  close(): Promise<void>;
}

/** What the composition hands back once it is running. */
type Composed = Omit<WebWallet, "health" | "close"> & { readonly flush: () => Operation<void> };

/** Refuse arguments that cannot encrypt the keeper, before any store is touched. */
function assertSecret({ bran, seed, aeid }: WebWalletSecret): void {
  if (!bran && !(seed && aeid)) {
    throw new UnencryptedKeeperError("A web wallet needs a passcode (bran), or a seed with its aeid");
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
    });
    const storage = requestPersistentStorage(host.storage);
    try {
      // Arguments alone do not prove encryption. The Manager encrypts only when the keeper stores an
      // AEID and holds the matching seed, so check that state, which is what protects seeds at rest.
      if (!hby.mgr.aeid || !hby.mgr.seed) {
        throw new UnencryptedKeeperError("The keeper holds no AEID, so it would store plaintext seeds");
      }
      const inventory = yield* openWalletBaser(hby.opener, hby.storeIdentity());
      try {
        yield* scoped(function*() {
          const http = barrierHttpClient(host.http ?? new FetchHttpClient(), () => opener.queue.flushed());
          const runtime = yield* createAgentRuntime(hby, http, host.clock ?? systemClock, {
            ipexOwners: "per-identifier",
            ...options.runtime,
            // The operation owners record blind-derivation coordinates where the wallet's own custody
            // reads them back; a process-local default would hide them from `recordIssued`.
            operationStores: { derived: new WalletDerivedUpdates(inventory), ...options.runtime?.operationStores },
            kram: options.runtime?.kram ?? { enabled: true },
          });
          try {
            const worker = yield* spawn(() => runAgentRuntime(runtime, { pollMailbox: true }));
            try {
              const wallet = new Wallet({ hby, registry: runtime.acdc!.store, exc: runtime.exc, db: inventory });
              deliver({
                hby,
                runtime,
                wallet,
                inventory,
                opener,
                storage,
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
 * store lock before it loads anything; request persistent storage; refuse an unencrypted keeper; open the inventory on the same queue; create the
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
  const { flush, ...parts } = composed;
  const lifecycle = options.host?.lifecycle === undefined ? pageTargets() : options.host.lifecycle;
  const requestFlush = () => void run(flush).then(undefined, () => {});
  const onHide = () => requestFlush();
  const onVisibility = () => {
    if (lifecycle?.document.visibilityState === "hidden") requestFlush();
  };
  lifecycle?.page.addEventListener("pagehide", onHide);
  lifecycle?.document.addEventListener("visibilitychange", onVisibility);
  let closing: Promise<void> | undefined;
  return {
    ...parts,
    health(): WebWalletHealth {
      try {
        parts.opener.queue.assertHealthy();
        return { status: "ok" };
      } catch (error) {
        return { status: "latched", cause: (error as Error).cause };
      }
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
