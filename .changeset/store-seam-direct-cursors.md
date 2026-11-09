---
"keri-ts": patch
---

Route KERI storage and registry cursor reads through the `DBer` contract with new `scanKeys`, `seekVal` and `hasTable` primitives. Readonly `Baser` opening now also recognizes schema-escrow tables stored under lmdb-js's NUL-terminated name.
