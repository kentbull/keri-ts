---
"keri-ts": patch
---

Load persisted remote key state before classifying incoming events as unknown. Observers can accept valid rotations immediately after restart without an unrelated query first warming their key-state cache.
