---
"keri-ts": patch
---

An idle agent runtime no longer opens LMDB write transactions. Work-finding passes now read first and open a
writer only for rows that will change: TEL publication advance, KRAM pruning, exchange escrow expiry, KEL escrow
replay of an escrow that is still waiting, and the no-op keeper encryption change. `LMDBer` answers `putVal`
of an existing row, `delVal` of an absent row or duplicate, and `putVals` of stored duplicates from a read.
`writeActivity` now counts the write transactions a handle opened.
