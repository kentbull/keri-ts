# LMDB Transaction and Cursor Patterns: KERIpy → TypeScript + Effection

## Overview

Maps KERIpy's LMDB patterns to TypeScript using `npm:lmdb@3.4.2`, integrated with Effection structured concurrency.

## API Mapping

### Transactions
| KERIpy | TypeScript lmdb |
|--------|----------------|
| `with env.begin(write=False)` | `db.transactionSync(() => {...})` |
| `txn.get(key)` | `db.get(key)` |
| `txn.put(key, val)` | `db.putSync(key, val)` |

### Cursors
| KERIpy | TypeScript lmdb |
|--------|----------------|
| `cursor.set_range(key)` | `db.getRange({ start: key })` |
| `cursor.iternext()` | `for (const {key, value} of db.getRange())` |
| `cursor.delete()` | `db.removeSync(key)` |

## Effection Integration

**Core Principle**: All LMDB operations must return `Operation<T>` to participate in structured concurrency.

```typescript
import { type Operation } from 'effection';
import { RootDatabase } from 'npm:lmdb@3.4.2';

// Read operation
function* getVal(
  db: RootDatabase,
  subDb: RootDatabase | null,
  key: Uint8Array | string
): Operation<Uint8Array | null> {
  const targetDb = subDb || db;
  try {
    return targetDb.get(key) ?? null;
  } catch (error) {
    if (error.message.includes('BadValsize')) {
      throw new Error(`Key: \`${key}\` is either empty, too big, or wrong DUPFIXED size.`);
    }
    throw error;
  }
}

// Write operation
function* setVal(
  db: RootDatabase,
  subDb: RootDatabase | null,
  key: Uint8Array | string,
  val: Uint8Array | string
): Operation<boolean> {
  const targetDb = subDb || db;
  return targetDb.transactionSync(() => {
    targetDb.putSync(key, val);
    return true;
  });
}
```

## Key Patterns

### 1. Cursor Iteration

**KERIpy**:
```python
def getAllItemIter(self, db, key=b'', split=True, sep=b'.'):
    with self.env.begin(db=db, write=False, buffers=True) as txn:
        cursor = txn.cursor()
        if not cursor.set_range(key):
            return
        for key, val in cursor.iternext():
            if split:
                splits = bytes(key).split(sep)
                splits.append(val)
            else:
                splits = (bytes(key), val)
            yield tuple(splits)
```

**TypeScript + Effection**:
```typescript
function* getAllItemIter(
  db: RootDatabase,
  subDb: RootDatabase | null,
  startKey: Uint8Array | string = '',
  split: boolean = true,
  sep: Uint8Array = new Uint8Array([0x2E])
): Operation<Generator<{ keys: Uint8Array[]; value: Uint8Array }, void, unknown>> {
  const targetDb = subDb || db;
  
  return function* () {
    for (const { key, value } of targetDb.getRange({ start: startKey })) {
      if (split) {
        const keyBytes = typeof key === 'string' ? new TextEncoder().encode(key) : key;
        const parts = splitKey(keyBytes, sep);
        parts.push(value);
        yield { keys: parts, value };
      } else {
        yield { keys: [key], value };
      }
    }
  }();
}

function splitKey(key: Uint8Array, sep: Uint8Array): Uint8Array[] {
  const parts: Uint8Array[] = [];
  let lastIndex = 0;
  for (let i = 0; i < key.length - sep.length + 1; i++) {
    if (key.slice(i, i + sep.length).every((b, idx) => b === sep[idx])) {
      parts.push(key.slice(lastIndex, i));
      lastIndex = i + sep.length;
    }
  }
  parts.push(key.slice(lastIndex));
  return parts;
}
```

### 2. Cursor-Based Deletion

**KERIpy**:
```python
def delTopVal(self, db, key=b''):
    with self.env.begin(db=db, write=True) as txn:
        cursor = txn.cursor()
        if cursor.set_range(key):
            ckey, cval = cursor.item()
            while ckey:
                if not ckey.startswith(key):
                    break
                cursor.delete()
                ckey, cval = cursor.item()
```

**TypeScript + Effection**:
```typescript
function* delTopVal(
  db: RootDatabase,
  subDb: RootDatabase | null,
  prefixKey: Uint8Array | string
): Operation<boolean> {
  const targetDb = subDb || db;
  const prefix = typeof prefixKey === 'string' 
    ? new TextEncoder().encode(prefixKey) 
    : prefixKey;
  
  return targetDb.transactionSync(() => {
    const keysToDelete: (Uint8Array | string)[] = [];
    
    for (const { key } of targetDb.getRange({ start: prefixKey })) {
      const keyBytes = typeof key === 'string' ? new TextEncoder().encode(key) : key;
      if (keyBytes.length < prefix.length || !prefix.every((b, i) => keyBytes[i] === b)) {
        break;
      }
      keysToDelete.push(key);
    }
    
    for (const key of keysToDelete) {
      targetDb.removeSync(key);
    }
    
    return keysToDelete.length > 0;
  });
}
```

## Key Differences

1. **Transactions**: Python uses context managers (`with env.begin()`), TypeScript uses `transactionSync()` callbacks
2. **Cursors**: Python has explicit cursor objects, TypeScript uses `getRange()` iterators
3. **Navigation**: Python has `cursor.prev()`, `cursor.last()`, TypeScript requires manual iteration or collecting entries

## Best Practices

1. **Wrap all operations**: Return `Operation<T>` for Effection integration
2. **Use transactions for writes**: Always use `transactionSync()` for write operations
3. **Handle iteration**: Use generators for cancellable iteration
4. **Resource cleanup**: Close databases in `finally` blocks or cleanup handlers

## Summary

- **Transactions**: `db.transactionSync(() => {...})` wraps operations
- **Cursors**: `db.getRange({ start, end })` replaces explicit cursors
- **Iteration**: Generator functions yield entries, allowing cancellation
- **Effection**: All operations return `Operation<T>` for structured concurrency
