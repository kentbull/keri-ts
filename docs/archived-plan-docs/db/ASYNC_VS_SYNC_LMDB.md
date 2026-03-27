# Async vs Sync LMDB Transactions

## Executive Summary

For **local, single-user LMDB** (like KERI TS), **synchronous transactions are
recommended** as the default. Async provides negligible performance benefit
while potentially risking data loss.

## Why Sync by Default

**For local, single-user databases:**

1. **LMDB is already fast**: Memory-mapped architecture means reads are
   nanoseconds
2. **Low contention**: Single user means no lock contention
3. **Write performance**: Sync writes are fast (microseconds to milliseconds)
4. **Durability**: Sync ensures data is persisted (important for KERI)

**Conclusion**: Async provides **negligible performance benefit** while
potentially risking data loss.

## KERIpy Pattern: Sync Transactions + Structured Concurrency

**Key Insight**: KERIpy uses **synchronous LMDB transactions** wrapped in
**Hio's structured concurrency**:

```python
# KERIpy: Sync transaction, async task management
def getVal(self, db, key):
    with self.env.begin(db=db, write=False, buffers=True) as txn:  # SYNC
        return txn.get(key)

# Hio: Structured concurrency manages tasks, not transactions
class Doer:
    def recur(self):  # Generator function
        val = self.db.getVal(db, key)  # Sync call
        yield  # Yield control to Hio scheduler
```

**Pattern**:

- **Transactions**: Synchronous (fast, simple, durable)
- **Task Management**: Structured concurrency (Hio generators, Effection
  operations)

## JavaScript lmdb: Both APIs Available

```typescript
import { open, RootDatabase } from "npm:lmdb@3.4.2";

const db = open({ path: "./data.mdb" });

// SYNC (recommended for KERI TS)
db.transactionSync(() => {
  db.putSync(key, value);
});

// ASYNC (available but not needed for single-user)
await db.transaction(async () => {
  await db.put(key, value);
});
```

## Implementation: Default to Sync

```typescript
import { type Operation } from "effection";
import { RootDatabase } from "npm:lmdb@3.4.2";

class LMDBer {
  private env: RootDatabase;

  /**
   * Get value - sync by default (matches KERIpy)
   */
  *getVal(
    subDb: RootDatabase | null,
    key: Uint8Array | string,
  ): Operation<Uint8Array | null> {
    const targetDb = subDb || this.env;
    return targetDb.get(key) ?? null; // Sync read
  }

  /**
   * Set value - sync transaction by default (matches KERIpy)
   */
  *setVal(
    subDb: RootDatabase | null,
    key: Uint8Array | string,
    val: Uint8Array | string,
  ): Operation<boolean> {
    const targetDb = subDb || this.env;
    return targetDb.transactionSync(() => {
      targetDb.putSync(key, val);
      return true;
    });
  }
}
```

## Effection Integration

```typescript
function* getValue(db: LMDBer, key: string): Operation<string | null> {
  // Sync read - fast, simple, matches KERIpy
  return yield* db.getVal(null, key);
}

function* setValue(db: LMDBer, key: string, value: string): Operation<void> {
  // Sync write transaction - atomic, durable, matches KERIpy
  yield* db.setVal(null, key, value);
}
```

## Performance Analysis

**Sync Transaction Performance**:

- Single read: ~100ns - 1μs (memory access)
- Single write: ~10μs - 1ms (disk I/O)
- Batch (100): ~1ms - 10ms

**Async Transaction Performance**: Same as sync (no benefit unless using
`MDB_NOSYNC`, which sacrifices durability).

**Conclusion**: Async provides **no meaningful performance benefit** for KERI
TS's use case.

## Recommendation

1. **Default to sync transactions** (matches KERIpy/Hio pattern)
2. **Performance**: Async provides no meaningful benefit for single-user local
   database
3. **Pattern**: Sync transactions + Effection structured concurrency
4. **Rationale**: Simpler, more durable, fast enough, matches KERIpy

**Key Insight**: Structured concurrency comes from **Effection operations**, not
from async transactions. This matches KERIpy's pattern where Hio provides
structured concurrency while LMDB transactions remain synchronous.
