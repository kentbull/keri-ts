/**
 * LMDB-backed construction of the domain stores.
 *
 * These helpers bind each `StoreOwner` to an `LMDBer` at its established paths.
 * Everything here reaches the native addon; backend-neutral callers use the
 * store classes with an injected `DBer` instead.
 */

import type { Operation } from "npm:effection@^3.6.0";
import { RegBaser } from "../acdc/regbasing.ts";
import { adoptRegistry, type OpenRegistryOptions } from "../acdc/registering.ts";
import { ValidationError } from "../core/errors.ts";
import { Baser, type BaserOptions } from "./basing.ts";
import { lmdbDefaultsFor } from "./core/lmdb-opener.ts";
import { LMDBer } from "./core/lmdber.ts";
import { openOwner } from "./core/store-owner.ts";
import { Keeper, type KeeperOptions } from "./keeping.ts";
import { Mailboxer, type MailboxerOptions } from "./mailbox/mailboxing.ts";
import { Noter, type NoterOptions } from "./noting.ts";
import { Reger, type RegerOptions } from "./reger.ts";

/** Construct a closed LMDB-backed `Baser` at its established paths. */
export function lmdbBaser({ compat, ...options }: BaserOptions = {}): Baser {
  return new Baser(new LMDBer(options, lmdbDefaultsFor(Baser.Family, compat)), options.logger);
}

/** Constructor-safe async factory for a fully reopened `Baser`. */
export function* createBaser(options: BaserOptions = {}): Operation<Baser> {
  return yield* openOwner(lmdbBaser(options), "Baser", options);
}

/** Construct a closed LMDB-backed `Keeper` at its established paths. */
export function lmdbKeeper({ compat, ...options }: KeeperOptions = {}): Keeper {
  return new Keeper(new LMDBer(options, lmdbDefaultsFor(Keeper.Family, compat)), options.logger);
}

/** Constructor-safe async factory for a fully reopened `Keeper`. */
export function* createKeeper(options: KeeperOptions = {}): Operation<Keeper> {
  return yield* openOwner(lmdbKeeper(options), "Keeper", options);
}

/** Construct a closed LMDB-backed `Noter` at its established paths. */
export function lmdbNoter({ compat, ...options }: NoterOptions = {}): Noter {
  return new Noter(new LMDBer(options, lmdbDefaultsFor(Noter.Family, compat)));
}

/** Open a notification sidecar and return the ready-to-use databaser. */
export function* createNoter(options: NoterOptions = {}): Operation<Noter> {
  return yield* openOwner(lmdbNoter(options), "Noter", options);
}

/** Construct a closed LMDB-backed `Mailboxer` at its established paths. */
export function lmdbMailboxer({ compat, ...options }: MailboxerOptions = {}): Mailboxer {
  return new Mailboxer(new LMDBer(options, lmdbDefaultsFor(Mailboxer.Family, compat)));
}

/**
 * Open a mailbox environment and return the ready-to-use databaser.
 *
 * Compatibility rule:
 * - explicit mailbox opens stay strict
 * - missing additive sidecars are tolerated only by higher-level habery open
 *   flows that are inspecting compat stores readonly
 */
export function* createMailboxer(options: MailboxerOptions = {}): Operation<Mailboxer> {
  return yield* openOwner(lmdbMailboxer(options), "Mailboxer", options);
}

/** Transfer a ready `Reger` to its caller, closing unreturned acquisitions on failure or cancellation. */
export function* createReger({ compat, ...options }: RegerOptions = {}): Operation<Reger> {
  const store = new LMDBer(options, lmdbDefaultsFor(Reger.Family, compat));
  return yield* openOwner(new Reger(store), "Reger", options);
}

/** Open a registry store on LMDB at its established paths; the reference web backend remains unsupported. */
export function* openLmdbRegistry(
  { web = false, reopen = true, compat, opener: _opener, ...options }: OpenRegistryOptions & { web?: boolean } = {},
): Operation<RegBaser> {
  if (web) throw new ValidationError("web registry backend is not yet supported by V2 Regery");
  return yield* adoptRegistry(new RegBaser(new LMDBer(options, lmdbDefaultsFor(RegBaser.Family, compat))), reopen);
}
