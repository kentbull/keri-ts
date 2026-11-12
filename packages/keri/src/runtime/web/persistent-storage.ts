/**
 * Persistent-storage request for browser wallets.
 *
 * Keys live only in IndexedDB, and Safari may evict script-writable storage
 * that was not granted persistence, so a wallet should ask and surface a refusal.
 */

/** Outcome of a persistence request. */
export interface PersistentStorageResult {
  /** The origin's storage is persistent now. */
  persisted: boolean;
  /** The engine exposes `navigator.storage.persist`. False means nothing was asked. */
  supported: boolean;
  /** Bytes the origin may use, when the engine reports it. */
  quota?: number;
  /** Bytes the origin uses, when the engine reports it. */
  usage?: number;
}

/** The part of `StorageManager` this module uses, so tests can inject a fake. */
export interface PersistentStorageManager {
  persist?(): Promise<boolean>;
  persisted?(): Promise<boolean>;
  estimate?(): Promise<{ quota?: number; usage?: number }>;
}

/**
 * Ask the engine to make this origin's storage persistent, then report the outcome.
 * Never throws: an absent API reports `supported: false`, and a failing or
 * refusing one reports `persisted: false`. Call it from a user gesture where the
 * engine requires one.
 *
 * @param storage Defaults to `navigator.storage`.
 */
export async function requestPersistentStorage(
  storage: PersistentStorageManager | undefined = globalThis.navigator?.storage,
): Promise<PersistentStorageResult> {
  if (typeof storage?.persist !== "function") return { persisted: false, supported: false };
  let persisted = await attempt(() => storage.persisted?.(), false);
  if (!persisted) persisted = await attempt(() => storage.persist!(), false);
  const estimate = await attempt(() => storage.estimate?.(), undefined);
  return {
    persisted,
    supported: true,
    ...(typeof estimate?.quota === "number" ? { quota: estimate.quota } : {}),
    ...(typeof estimate?.usage === "number" ? { usage: estimate.usage } : {}),
  };
}

/** Run one engine call, treating a throw or an absent method as the fallback. */
async function attempt<T>(fn: () => Promise<T> | undefined, fallback: T): Promise<T> {
  try {
    return (await fn()) ?? fallback;
  } catch {
    return fallback;
  }
}
