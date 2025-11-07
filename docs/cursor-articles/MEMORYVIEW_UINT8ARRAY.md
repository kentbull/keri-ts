# Python memoryview vs JavaScript Uint8Array in LMDB

## Overview

KERIpy uses Python's `memoryview` with `buffers=True` for zero-copy access. JavaScript's `Uint8Array` provides equivalent zero-copy behavior by default.

## Key Mapping

| Python (KERIpy) | JavaScript/TypeScript |
|----------------|----------------------|
| `memoryview` | `Uint8Array` |
| `buffers=True` | Default behavior (no flag needed) |
| `isinstance(val, memoryview)` | `val instanceof Uint8Array` |
| `bytes(val)` | `new Uint8Array(val)` (creates copy) |
| `val.decode("utf-8")` | `new TextDecoder().decode(val)` |
| `val.encode("utf-8")` | `new TextEncoder().encode(val)` |

## Implementation

```typescript
import { type Operation } from 'effection';
import { RootDatabase } from 'lmdb';

// Get value - returns Uint8Array (zero-copy, like Python memoryview)
function* getVal(
  db: RootDatabase,
  subDb: RootDatabase | null,
  key: Uint8Array | string
): Operation<Uint8Array | null> {
  const targetDb = subDb || db;
  const val = targetDb.get(key);
  
  // JavaScript lmdb returns Uint8Array for binary data (zero-copy by default)
  return val === undefined ? null : (val instanceof Uint8Array ? val : new Uint8Array(val));
}

// Set value - accepts Uint8Array directly
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

## Key Differences

1. **No flag needed**: JavaScript lmdb returns `Uint8Array` by default (equivalent to Python's `buffers=True`)
2. **Type checking**: Use `instanceof Uint8Array` instead of `isinstance(val, memoryview)`
3. **Encoding/decoding**: Use `TextEncoder`/`TextDecoder` instead of `.encode()`/`.decode()` methods

## When to Copy

**Copy when**:
- Modifying data (Uint8Array views are read-only for underlying buffer)
- Keeping data beyond transaction lifetime

**Don't copy when**:
- Just reading/processing data
- Data only used within transaction scope

## Summary

JavaScript lmdb **already provides zero-copy behavior by default** via `Uint8Array`. No special configuration needed - equivalent to Python's `buffers=True` mode.
