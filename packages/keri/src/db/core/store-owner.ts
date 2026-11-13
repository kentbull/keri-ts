/**
 * Composition seam between typed domain stores and a `DBer` backend.
 *
 * ADR-0015 owns the store contract. A `StoreOwner` is a domain store such as
 * `Noter` or `Reger`: it borrows no backend knowledge and delegates lifecycle
 * and transactions to the one store it composes over.
 */

import type { Operation } from "npm:effection@^3.6.0";
import { DatabaseNotOpenError } from "../../core/errors.ts";
import type { DBer, StoreIdentity } from "./dber.ts";
import type { LMDBer } from "./lmdber.ts";

/** Names one kind of store so an opener can place it, without saying how. */
export interface StoreFamily {
  /** Family path segment, such as `reg` or `acdc/reg`. */
  tail: string;
  /** Upper bound on named tables, for backends that need one up front. */
  maxTables?: number;
  /** True for a family that never uses the `.keri` compatibility layout. */
  noCompat?: boolean;
}

/**
 * Creates closed stores for one composition.
 *
 * The caller owns each returned store: opening happens through its owner's
 * `reopen`, and whoever constructs an owner closes it.
 */
export interface StoreOpener {
  create(family: StoreFamily, identity: StoreIdentity): DBer;
}

/** A domain store composed over one `DBer`. */
export abstract class StoreOwner {
  constructor(readonly store: DBer) {}

  /** Open the store and rebind this owner's typed tables. */
  abstract reopen(options?: StoreIdentity): Operation<boolean>;

  get name(): string {
    return this.store.name;
  }

  get base(): string {
    return this.store.base;
  }

  get opened(): boolean {
    return this.store.opened;
  }

  get readonly(): boolean {
    return this.store.readonly;
  }

  get temp(): boolean {
    return this.store.temp;
  }

  get inWriteTransaction(): boolean {
    return this.store.inWriteTransaction;
  }

  /** Filesystem path on an LMDB-backed store; `null` elsewhere. */
  get path(): string | null {
    return (this.store as Partial<LMDBer>).path ?? null;
  }

  /** Native LMDB environment for low-level tests only; `null` on other backends. */
  get env(): LMDBer["env"] {
    return (this.store as Partial<LMDBer>).env ?? null;
  }

  get writeVersion(): number {
    return this.store.writeVersion;
  }

  /** Writes made through this handle, counted without a store read (see `Dber.writeActivity`). */
  get writeActivity(): number {
    return this.store.writeActivity;
  }

  transaction<T>(fn: () => T): T {
    return this.store.transaction(fn);
  }

  flushed(): Operation<void> {
    return this.store.flushed();
  }

  refreshRead(): void {
    this.store.refreshRead();
  }

  hasTable(name: string): boolean {
    return this.store.hasTable(name);
  }

  getVer(): string | null {
    return this.store.getVer();
  }

  setVer(val: string): void {
    this.store.setVer(val);
  }

  close(clear = false): Operation<boolean> {
    return this.store.close(clear);
  }
}

/**
 * Open a ready owner for its caller, closing an unreturned acquisition on
 * failure or cancellation without masking the original error.
 */
export function* openOwner<T extends StoreOwner>(
  owner: T,
  label: string,
  options?: StoreIdentity,
): Operation<T> {
  let delivered = false;
  let failure: { error: unknown } | undefined;
  try {
    if (!(yield* owner.reopen(options))) throw new DatabaseNotOpenError(`Failed to open ${label}`);
    delivered = true;
    return owner;
  } catch (error) {
    failure = { error };
    throw error;
  } finally {
    if (!delivered) {
      try {
        yield* owner.close();
      } catch (error) {
        if (failure) {
          // deno-lint-ignore no-unsafe-finally -- Preserve the operation failure alongside shutdown failure.
          throw new AggregateError([failure.error, error], "Database acquisition and close failed", {
            cause: failure.error,
          });
        }
        // deno-lint-ignore no-unsafe-finally -- A cancelled acquisition still reports its close failure.
        throw error;
      }
    }
  }
}
