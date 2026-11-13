---
"keri-ts": patch
"@keri-ts/hosting": patch
"@keri-ts/wallet": patch
---

A remote message that this receiver's KRAM refuses after its sender authenticated now reaches the application. `Kramer.intake` publishes a `kramRefused` cue (`KramRefusedCue`: `said`, `sender`, `ilk`, `route`, `reason`, `stamp`, and `deadline` and `xid` when they exist) for the reasons `timeliness`, `lifetime` and `unknownThread`, which KRAM decides only after a signature or anchored seal verified. `processCuesOnce` pushes it to the new `AgentRuntime.changes` sink as a `KramRefusedChange`, so the host's `ChangeSink` or the Signaler (topic `/workflow/kramRefused`, collapsed per SAID) receives it. `ChangeSink.push` now takes a `RuntimeChange`, either a `WorkflowChange` or a `KramRefusedChange`, and the wallet's sink forwards both. `timestamp`, `replay` and `authentication` refusals and local envelopes publish nothing; the cue is transient, with no durable record. `isKramLateReason`, `KramLateReason` and `kramExchangeId` live beside `KramRefusalReason`, and the generic ingress 422 uses the shared predicate.
