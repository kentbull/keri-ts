---
"keri-ts": minor
---

The runtime's operation owners now run on one fiber with an adaptive cadence instead of four fibers polling every 50 ms. An owner passes only while it has live work (or an Unblind reply is owed, or the replicator has copies owed), every 50 ms (`OWNER_BUSY_MS`); otherwise the loop sleeps 1 s (`OWNER_IDLE_MS`), and beginning an operation wakes it at once through `runtime.operations.wake`. An idle pass reads no protocol store. `OWNER_LOOP_MS` is removed. The issuance and Unblind owners now call `requery`: the signed query is resent unchanged until it is older than the sender's single-key KRAM window, then re-dated (new date, SAID and signatures, same keys and scope) inside the live consent, because KRAM drops an identical resend of an aged query as a replay. Group queries cannot be re-dated by one member. Wire formats are unchanged.
