---
"keri-ts": patch
"@keri-ts/wallet": patch
---

A group IPEX contribution that the member's own KRAM refuses no longer stalls until timeout. Consent calls
(`proposeGroupIpex`, `approveGroupIpex`) throw `KramRefusedError`, a group IPEX operation whose collection is refused
ends `expired` with the KRAM reason and deadline, and `waitForGroupIpex` settles on it.
