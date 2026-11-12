---
"@keri-ts/wallet": minor
---

Add `openWebWallet` to `@keri-ts/wallet/web`: the browser composition root. It takes the single-writer store lock, opens one IndexedDB opener and a Habery that must be encrypted, runs the agent runtime behind the output barrier, requests persistent storage, and exposes `health()` and an ordered `close()`. After a latched persistence failure, `close()` then `openWebWallet()` again recovers the last durable state.
