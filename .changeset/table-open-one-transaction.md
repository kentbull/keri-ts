---
"keri-ts": patch
"@keri-ts/wallet": patch
"@keri-ts/verifier": patch
---

Creating a store now makes all of its named tables in one write transaction instead of one synced commit per table. A fresh agent keystore and runtime drop from 191 synced commits to 24, and reopening drops from 173 clean commits to 6. A crash during first creation leaves a store with all of its tables or none, and the next open completes it. Key creation and other data writes are unchanged.
