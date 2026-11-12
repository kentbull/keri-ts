/**
 * Single-writer lock for a browser store identity.
 *
 * `WebDBer` holds a snapshot of its persisted rows taken at open, so two tabs
 * writing the same identity would each overwrite the other's commits. Take this
 * lock before any store `reopen` and hold it until every store is closed.
 */

import { AppError } from "../../core/errors.ts";
import type { StoreIdentity } from "../../db/core/dber.ts";

/** Another tab, worker or window holds the store; `key`, `storeName` and `storeBase` support a UI message. */
export class StoreLockHeldError extends AppError {
  constructor(readonly key: string, readonly storeName: string | undefined, readonly storeBase: string | undefined) {
    super(`Store ${JSON.stringify(storeName ?? "")} is already open in another tab or window`);
  }
}

/** `navigator.locks` is absent (insecure context or old engine), so single-writer cannot be enforced. */
export class StoreLockUnsupportedError extends AppError {
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
