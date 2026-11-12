/** LMDB-backed wallet inventory acquisition; the only wallet module that names the native backend. */
import type { Operation } from "effection";
import { openOwner } from "keri-ts/db";
import { lmdbDefaultsFor, LMDBer, type LMDBerOptions } from "keri-ts/db/lmdb";
import { WalletBaser } from "./storing.ts";

/** Acquire a wallet environment; callers join close after all borrowed users finish. */
export function* createWalletBaser(options: LMDBerOptions = {}): Operation<WalletBaser> {
  const store = new LMDBer(options, lmdbDefaultsFor(WalletBaser.Family));
  return yield* openOwner(new WalletBaser(store), "WalletBaser");
}
