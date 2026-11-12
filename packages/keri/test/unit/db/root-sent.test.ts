/** `Baser.rrsn` (sent `/registry/root` markers) survives a reopen on the LMDB and IndexedDB backends. */
import { assertEquals } from "jsr:@std/assert";
import { run } from "npm:effection@^3.6.0";
import { IDBFactory, IDBKeyRange } from "npm:fake-indexeddb@6.2.5";
import { indexedDbOpener, type StoreLockManager } from "../../../db-indexeddb.ts";
import { createHabery } from "../../../src/app/identity/lmdb-habery.ts";
import { Baser } from "../../../src/db/basing.ts";

const keys = ["EGroup", "ERegistry", "ERecipient"];
const sent = { key: "DRecipientKey", dt: "2026-11-12T00:00:00.000000+00:00" };

Deno.test("db/basing - rrsn markers survive closing and reopening the Habery", async () => {
  const headDirPath = Deno.makeTempDirSync({ prefix: "root-sent-" });
  const options = { name: "rrsn", temp: false, headDirPath, skipConfig: true };
  try {
    await run(function*() {
      const first = yield* createHabery(options);
      first.db.rrsn.pin(keys, sent);
      yield* first.close();
      const second = yield* createHabery(options);
      try {
        assertEquals(second.db.rrsn.get(keys)?.asDict(), sent);
      } finally {
        yield* second.close(true);
      }
    });
  } finally {
    Deno.removeSync(headDirPath, { recursive: true });
  }
});

/** A single-process lock manager honouring exclusive + ifAvailable. */
function fakeLocks(): StoreLockManager {
  const held = new Set<string>();
  return {
    async request(name, _options, callback) {
      if (held.has(name)) return await callback(null);
      held.add(name);
      try {
        return await callback({});
      } finally {
        held.delete(name);
      }
    },
  };
}

Deno.test("db/basing - rrsn markers survive a flush and a reload through the IndexedDB opener", async () => {
  const factory = new IDBFactory() as unknown as IDBFactory;
  const keyRange = IDBKeyRange as unknown as typeof globalThis.IDBKeyRange;
  const locks = fakeLocks();
  await run(function*() {
    const open = function*() {
      const opener = indexedDbOpener({ factory, keyRange, locks });
      const baser = new Baser(opener.create(Baser.Family, { name: "wallet" }));
      yield* baser.reopen();
      return baser;
    };
    const first = yield* open();
    first.rrsn.pin(keys, sent);
    yield* first.store.flushed();
    yield* first.close();
    const second = yield* open();
    try {
      assertEquals(second.rrsn.get(keys)?.asDict(), sent);
    } finally {
      yield* second.close();
    }
  });
});
