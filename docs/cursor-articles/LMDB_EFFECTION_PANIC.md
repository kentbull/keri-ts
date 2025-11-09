# LMDB + Effection Cleanup Hook Panic

## Issue

When using LMDB with Effection, Deno panics with:
```
Cannot remove cleanup hook which was not registered
```

This occurs in `ext/napi/lib.rs:502:15`, which is Deno's FFI layer.

## Root Cause

LMDB's native bindings register cleanup hooks when the database is opened. When we wrap synchronous LMDB operations in Effection's `action()`, there's a conflict:
1. LMDB registers native cleanup hooks
2. Effection's `action()` also manages cleanup hooks
3. When operations complete synchronously, cleanup hooks may not be registered properly
4. Deno panics when trying to clean up

## Current Workaround

We've tried:
1. Returning cleanup function before calling `resolve()` - didn't help
2. Using `queueMicrotask()` to defer resolution - didn't help
3. The panic persists, suggesting it's a deeper issue with LMDB's native bindings

## Potential Solutions

1. **Don't wrap synchronous LMDB operations in `action()`**: Return values directly from generator functions (breaks Operation type contract)
2. **Use LMDB's async API**: If available, use async operations that naturally work with Effection
3. **Report to Deno**: This appears to be a Deno bug with FFI cleanup hooks
4. **Use a different LMDB binding**: Try a different LMDB library that doesn't use native bindings

## Next Steps

1. Check if LMDB has async APIs we can use
2. Consider reporting this to Deno as a bug
3. Test if the panic occurs with a minimal reproduction case
4. Consider using a different database library if this can't be resolved

