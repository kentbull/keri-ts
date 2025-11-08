import {open, RootDatabase, Key} from 'lmdb';

// Singleton db-lazy open - not thread safe
let db: RootDatabase<any, Key> | null = null;

export function openDB(path: string = './data.mdb'): RootDatabase<any, Key> {
  if (!db) {
    db = open({ path, mapSize: 2e9 }); // 2GB map; tune for KERI events.
  }
  return db;
}

export function readValue(db: RootDatabase, key: string): string | null {
  // sync get
  return db.get(key) ?? null;
}

export function writeValue(db: RootDatabase, key: string, value: string) {
  // sync write
  db.transactionSync(() => {
    db.putSync(key, value);
  });
}

