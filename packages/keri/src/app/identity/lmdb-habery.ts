/** Default LMDB-backed `Habery` construction, kept apart so `openHabery` stays backend-neutral. */

import type { Operation } from "npm:effection@^3.6.0";
import { LmdbStoreOpener } from "../../db/core/lmdb-opener.ts";
import { type Habery, type HaberyArgs, openHabery } from "./habbing.ts";

/** Open a `Habery` on LMDB at its established paths, unless the caller supplies stores or an opener. */
export function* createHabery(args: HaberyArgs): Operation<Habery> {
  return yield* openHabery({
    opener: new LmdbStoreOpener({ headDirPath: args.headDirPath, compat: args.compat }),
    ...args,
  });
}
