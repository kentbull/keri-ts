---
"keri-ts": patch
---

`ProtocolProcessor.escrowDo` now waits a fixed `ESCROW_TOCK_MS` (31.25 ms, KERIpy's Doist cycle) on the runtime clock after every pass and never skips or shortens a pass; `escrowDo` takes the runtime clock. `Exchanger.processEscrows` yields to the scheduler after each escrowed message, a retry that learns nothing no longer rewrites the exchange metadata, and an admission that wrote nothing does not wait for a flush.
