/**
 * Browser IndexedDB backend surface for `keri-ts/db/indexeddb`.
 *
 * Kept off `keri-ts/db` because `IndexedDbPersistence` names DOM types
 * (`IDBFactory`, `IDBKeyRange`) that Node consumers should not have to type-check.
 */

import { call, type Operation } from "npm:effection@^3.6.0";
import type { StoreIdentity } from "./core/dber.ts";
import { IndexedDbPersistence } from "./core/indexeddb-persistence.ts";
import type { StoreFamily } from "./core/store-owner.ts";
import { type Persistence, WebDBer, WebStoreOpener } from "./core/webdber.ts";
import {
  acquireStoreLock,
  type AcquireStoreLockOptions,
  type StoreLock,
  StoreLockGroup,
  StoreLockHeldError,
  storeLockKey,
  type StoreLockManager,
  StoreLockUnsupportedError,
} from "./store-lock.ts";

export {
  acquireStoreLock,
  type AcquireStoreLockOptions,
  IndexedDbPersistence,
  type StoreLock,
  StoreLockHeldError,
  storeLockKey,
  type StoreLockManager,
  StoreLockUnsupportedError,
};

/** Optional IndexedDB implementation and single-writer lock settings. */
export interface IndexedDbOpenerOptions {
  /** Defaults to the browser global. */
  factory?: IDBFactory;
  /** Defaults to the browser global; inject with `factory`. */
  keyRange?: typeof IDBKeyRange;
  /** Defaults to `navigator.locks`; `null` simulates an engine without it, which refuses every open. */
  locks?: StoreLockManager | null;
  /**
   * Open without the single-writer lock. Each store is a snapshot taken at open, so two writers on
   * one identity silently overwrite each other's commits. Only for hosts that serialize writers
   * themselves (a SharedWorker owner) and tests that open one database twice on purpose.
   */
  unsafeSkipStoreLock?: boolean;
}

/** A `WebDBer` that holds a reference on its opener's lock for as long as it is open. */
class LockedWebDBer extends WebDBer {
  readonly #group: StoreLockGroup;
  readonly #identity: StoreIdentity;
  #ref: { release(): Promise<void> } | undefined;
  #reopening = false;

  constructor(
    identity: StoreIdentity,
    persistence: Persistence,
    queue: WebStoreOpener["queue"],
    group: StoreLockGroup,
  ) {
    super(identity, persistence, queue);
    this.#group = group;
    this.#identity = identity;
  }

  /** Take the lock before `WebDBer.reopen` loads anything; any failure or refusal to open lets it go. */
  override *reopen(options: StoreIdentity = {}): Operation<boolean> {
    // Assigned inside the promise so a halt while waiting cannot orphan the reference.
    yield* call(async () => {
      this.#ref ??= await this.#group.acquire(this.#identity);
    });
    this.#reopening = true;
    let opened = false;
    try {
      opened = yield* super.reopen(options);
      return opened;
    } finally {
      this.#reopening = false;
      if (!opened) yield* this.#letGo();
    }
  }

  /** Close, then release the lock even when closing fails. `reopen`'s own inner close keeps it. */
  override *close(clear = false): Operation<boolean> {
    try {
      return yield* super.close(clear);
    } finally {
      if (!this.#reopening) yield* this.#letGo();
    }
  }

  *#letGo(): Operation<void> {
    const ref = this.#ref;
    this.#ref = undefined;
    if (ref) yield* call(() => ref.release());
  }
}

/** `WebStoreOpener` whose stores share one reference-counted lock per store identity. */
class LockedStoreOpener extends WebStoreOpener {
  readonly #group: StoreLockGroup;

  constructor(persistenceFor: WebStoreOpener["persistenceFor"], locks: AcquireStoreLockOptions) {
    super(persistenceFor);
    this.#group = new StoreLockGroup(locks);
  }

  override create(family: StoreFamily, identity: StoreIdentity): WebDBer {
    return new LockedWebDBer(identity, this.persistenceFor(family, identity), this.queue, this.#group);
  }
}

/**
 * A `WebStoreOpener` whose stores persist to IndexedDB, one database per store
 * family and identity. Inject `factory` and `keyRange` together outside a browser.
 *
 * Single-writer by default: the first store to open an identity (`base`, `name`, `temp`) takes a
 * Web Locks lock, shared by every family the opener creates for it and released when the last of
 * them closes. A second opener, tab or window on that identity is refused with
 * `StoreLockHeldError`, and an engine without `navigator.locks` with `StoreLockUnsupportedError`;
 * nothing runs unlocked unless `unsafeSkipStoreLock` says so.
 */
export function indexedDbOpener(options: IndexedDbOpenerOptions = {}): WebStoreOpener {
  const persistenceFor = (family: StoreFamily, identity: StoreIdentity) =>
    new IndexedDbPersistence(family, identity, options.factory, options.keyRange);
  return options.unsafeSkipStoreLock
    ? new WebStoreOpener(persistenceFor)
    : new LockedStoreOpener(persistenceFor, options.locks === undefined ? {} : { locks: options.locks });
}
