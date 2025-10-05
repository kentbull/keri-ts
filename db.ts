import {open, RootDatabase} from 'npm:lmdb@3.4.2'; // Zero-dep wrapper; bindings handle mmap.
import { Operation, action } from 'npm:effection@3.6.0';

// Singleton db-lazy open - not thread safe
let db: RootDatabase | null = null;

export function* openDB(path: string = './data.mdb'): Operation<RootDatabase> {
  if (!db) {
    db = open({ path, mapSize: 2e9 }); // 2GB map; tune for KERI events.
  }
  return db;
}

/** Effection helper: wrap a Promise (or value) into an Operation */
function* toOp<T>(p: Promise<T> | T): Operation<T> {
  // If it's already a value, just return it.
  const maybe = p as any;
  if (!maybe || typeof maybe.then !== 'function') {
    return p as T; // plain sync value
  }
  return yield* action<T>(function* (resolve) {
    let done = false;
    p.then((v) => { if (!done) resolve(v); },
      (e) => { if (!done) resolve.raise(e); }
    );
    // No way to abort lmdb's transaction mid-flight; this just drops the resolution.
    return () => { done = true;};
  });
}

export function* readValue(db: RootDatabase, key: string): string | null {
  // sync get
  return db.get<string>(key) ?? null;
}

export function* writeValue(db: RootDatabase, key: string, value: string): Operation<void> {
  // sync write
  return db.transactionSync(() => {
    db.putSync(key, value);
  });
}

