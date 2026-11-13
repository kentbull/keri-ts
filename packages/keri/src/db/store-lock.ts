/**
 * Single-writer lock for a browser store identity.
 *
 * `WebDBer` holds a snapshot of its persisted rows taken at open, so two tabs
 * writing the same identity would each overwrite the other's commits. `indexedDbOpener`
 * takes this lock in its first store's `reopen`, before anything loads, and holds it
 * until its last store of the identity closes; `acquireStoreLock` is public for hosts
 * that compose stores their own way.
 */

import { AppError } from "../core/errors.ts";
import type { StoreIdentity } from "./core/dber.ts";

/** Another tab, worker or window holds the store; `key`, `storeName` and `storeBase` support a UI message. */
export class StoreLockHeldError extends AppError {
  override readonly name: string = "StoreLockHeldError";
  constructor(readonly key: string, readonly storeName: string | undefined, readonly storeBase: string | undefined) {
    super(`Store ${JSON.stringify(storeName ?? "")} is already open in another tab or window`);
  }
}

/** `navigator.locks` is absent (insecure context or old engine), so single-writer cannot be enforced. */
export class StoreLockUnsupportedError extends AppError {
  override readonly name: string = "StoreLockUnsupportedError";
  constructor() {
    super("Web Locks API unavailable; refusing to open the store without a single-writer lock");
  }
}

/** The part of `LockManager` this module uses, so tests can inject a fake. */
export interface StoreLockManager {
  request(
    name: string,
    options: { mode: "exclusive"; ifAvailable: true },
    callback: (lock: unknown) => Promise<void> | void,
  ): Promise<unknown>;
}

export interface AcquireStoreLockOptions {
  /** Defaults to `navigator.locks`; `null` simulates an engine without it. */
  locks?: StoreLockManager | null;
}

/** A held store lock. */
export interface StoreLock {
  readonly key: string;
  /** Release the lock; idempotent. Resolves once the lock manager has let go. */
  release(): Promise<void>;
}

/**
 * The lock name for a store identity. It matches `IndexedDbPersistence`'s database
 * naming minus the family, so one lock covers every store family of the identity.
 */
export function storeLockKey(identity: Pick<StoreIdentity, "base" | "name" | "temp">): string {
  return `keri-ts:store:${
    JSON.stringify([identity.base ?? "", identity.name ?? "", identity.temp ? "temp" : "durable"])
  }`;
}

/**
 * Take the exclusive lock for `identity` without waiting.
 *
 * @throws StoreLockHeldError when another holder has it.
 * @throws StoreLockUnsupportedError when no lock manager exists; never proceeds unlocked.
 */
export async function acquireStoreLock(
  identity: Pick<StoreIdentity, "base" | "name" | "temp">,
  options: AcquireStoreLockOptions = {},
): Promise<StoreLock> {
  const locks = options.locks === undefined
    ? globalThis.navigator?.locks as StoreLockManager | undefined
    : options.locks;
  if (!locks) throw new StoreLockUnsupportedError();
  const key = storeLockKey(identity);
  let letGo!: () => void;
  const held = new Promise<void>((resolve) => letGo = resolve);
  let done!: Promise<unknown>;
  const acquired = await new Promise<boolean>((resolve, reject) => {
    done = locks.request(key, { mode: "exclusive", ifAvailable: true }, (lock) => {
      resolve(lock !== null);
      return lock === null ? undefined : held;
    });
    done.catch(reject);
  });
  if (!acquired) throw new StoreLockHeldError(key, identity.name, identity.base);
  return {
    key,
    release: () => {
      letGo();
      return done.then(() => {});
    },
  };
}

/** One reference on a shared store lock; `release` is idempotent. */
export interface StoreLockRef {
  release(): Promise<void>;
}

interface GroupEntry {
  refs: number;
  readonly lock: Promise<StoreLock>;
  /** Set while the last reference is letting go, so a re-acquire waits for it. */
  releasing?: Promise<void>;
}

/**
 * Reference-counted store locks for one opener: every store of an identity shares
 * one lock, taken by the first reference and released by the last.
 */
export class StoreLockGroup {
  readonly #entries = new Map<string, GroupEntry>();

  constructor(private readonly options: AcquireStoreLockOptions = {}) {}

  /**
   * Take a reference, acquiring the lock if no other store of the identity holds it.
   *
   * @throws StoreLockHeldError when another holder has the identity.
   * @throws StoreLockUnsupportedError when no lock manager exists.
   */
  async acquire(identity: Pick<StoreIdentity, "base" | "name" | "temp">): Promise<StoreLockRef> {
    const key = storeLockKey(identity);
    let entry = this.#entries.get(key);
    while (entry?.releasing) {
      await entry.releasing;
      entry = this.#entries.get(key);
    }
    if (!entry) {
      entry = { refs: 0, lock: acquireStoreLock(identity, this.options) };
      this.#entries.set(key, entry);
    }
    const mine = entry;
    mine.refs++;
    try {
      await mine.lock;
    } catch (error) {
      mine.refs--;
      if (this.#entries.get(key) === mine) this.#entries.delete(key);
      throw error;
    }
    let released = false;
    return {
      release: async () => {
        if (released) return;
        released = true;
        if (--mine.refs > 0) return;
        const lock = await mine.lock;
        mine.releasing = lock.release();
        try {
          await mine.releasing;
        } finally {
          if (this.#entries.get(key) === mine) this.#entries.delete(key);
        }
      },
    };
  }
}
