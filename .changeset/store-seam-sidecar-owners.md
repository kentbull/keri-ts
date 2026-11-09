---
"keri-ts": patch
---

Compose `Noter`, `Mailboxer` and `RegBaser` over an injected `DBer` instead of extending `LMDBer`. `createNoter`, `createMailboxer` and `openRegistry` keep their signatures and paths; direct construction now takes a store or uses `lmdbNoter` and `lmdbMailboxer`.
