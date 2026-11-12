/**
 * Browser host surface: the output barrier, single-writer store lock and
 * persistence request that any browser composition needs.
 *
 * Mirrors `keri-ts/runtime/node` for the browser. Nothing here may reach
 * `node:` modules, sockets or the `Deno` global.
 */
export { barrierHttpClient, OutputBarrierError } from "./web/output-barrier.ts";
export {
  type PersistentStorageManager,
  type PersistentStorageResult,
  requestPersistentStorage,
} from "./web/persistent-storage.ts";
export {
  acquireStoreLock,
  type AcquireStoreLockOptions,
  type StoreLock,
  StoreLockHeldError,
  storeLockKey,
  type StoreLockManager,
  StoreLockUnsupportedError,
} from "./web/store-lock.ts";
