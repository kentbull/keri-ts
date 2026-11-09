---
"keri-ts": patch
---

Add `MemStore`, an in-memory `DBer` that keeps every table in unsigned bytewise order with real commit, savepoint and rollback behavior, and `MemStoreOpener` to compose stores over it. Both are exported from `keri-ts/db`.
