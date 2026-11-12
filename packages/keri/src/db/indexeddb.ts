/**
 * Browser IndexedDB backend surface for `keri-ts/db/indexeddb`.
 *
 * Kept off `keri-ts/db` because `IndexedDbPersistence` names DOM types
 * (`IDBFactory`, `IDBKeyRange`) that Node consumers should not have to type-check.
 */

import type { StoreIdentity } from "./core/dber.ts";
import { IndexedDbPersistence } from "./core/indexeddb-persistence.ts";
import type { StoreFamily } from "./core/store-owner.ts";
import { WebStoreOpener } from "./core/webdber.ts";

export { IndexedDbPersistence };

/** Optional IndexedDB implementation; both default to the browser globals. */
export interface IndexedDbOpenerOptions {
  factory?: IDBFactory;
  keyRange?: typeof IDBKeyRange;
}

/**
 * A `WebStoreOpener` whose stores persist to IndexedDB, one database per store
 * family and identity. Inject `factory` and `keyRange` together outside a browser.
 */
export function indexedDbOpener(options: IndexedDbOpenerOptions = {}): WebStoreOpener {
  return new WebStoreOpener((family: StoreFamily, identity: StoreIdentity) =>
    new IndexedDbPersistence(family, identity, options.factory, options.keyRange)
  );
}
