---
"keri-ts": patch
---

A pending exchange no longer opens an LMDB write transaction on each escrow retry. The `Exchanger` now decides an
admission attempt by reads first (`decide`) and persists it separately (`persist`). A retry that is still waiting on
the same dependency, finds the exchange gone, or is rejected with its escrow kept answers without a writer. A decision
that does write is reused inside the writer when no commit came between, and made again when one did. What is accepted,
escrowed or rejected, the cues emitted and the deadlines are unchanged. An idle runtime holding a pending IPEX Grant
no longer re-runs its escrow pass every tock.
