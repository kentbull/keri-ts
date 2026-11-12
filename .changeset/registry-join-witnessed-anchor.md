---
"keri-ts": patch
---

`tufa multisig join` now settles an approved v2 `/multisig/rip` or `/multisig/bup` the way KERIpy's join does: once the group anchor event is accepted it collects that anchor's witness receipts, reprocesses escrows and reports the registry event `accepted` only when its own TEL accepts it. Before, the join receipted only after TEL acceptance, which itself needs a fully witnessed anchor, so a Tufa member approving a KERIpy-proposed RIP or BUP left that event in missing-anchor escrow and could not issue from the registry.
