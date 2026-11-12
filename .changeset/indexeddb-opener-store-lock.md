---
"keri-ts": minor
---

`indexedDbOpener()` is now single-writer by default. Its first store takes a Web Locks lock per store identity before it loads, every store family shares it, and the last close releases it. A second opener or tab gets `StoreLockHeldError`, and an engine without `navigator.locks` gets `StoreLockUnsupportedError`. Pass `unsafeSkipStoreLock: true` to open without the lock, or `locks` to inject a lock manager. `acquireStoreLock`, `storeLockKey` and the lock types are also exported from `keri-ts/db/indexeddb`; `keri-ts/runtime/web` still exports them.
