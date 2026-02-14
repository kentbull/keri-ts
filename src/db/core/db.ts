import { Key, open, RootDatabase } from "npm:lmdb@^3.4.4";
import { DatabaseOperationError } from "../../core/errors.ts";

// Legacy lightweight DB helper used by HTTP server paths.
// Preferred DB access for richer flows is LMDBer/Baser.
let db: RootDatabase<any, Key> | null = null;

export function openDB(path: string = "./data.mdb"): RootDatabase<any, Key> {
  try {
    if (!db) {
      db = open({ path, mapSize: 2e9 }); // 2GB map; tune for KERI events.
    }
    return db;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new DatabaseOperationError(`Failed to open DB: ${message}`, { path });
  }
}

export function readValue(db: RootDatabase, key: string): string | null {
  // sync get
  return db.get(key) ?? null;
}

export function writeValue(db: RootDatabase, key: string, value: string) {
  try {
    // sync write
    db.transactionSync(() => {
      db.putSync(key, value);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new DatabaseOperationError(`Failed to write DB value: ${message}`, {
      key,
    });
  }
}
