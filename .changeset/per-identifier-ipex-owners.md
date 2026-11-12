---
"keri-ts": minor
---

Add `createAgentRuntime` option `ipexOwners: "per-identifier"` and `runtime.ipex`, a runtime-owned registry of IPEX auxiliary owners keyed by local identifier. `runtime.ipex.dhke(hab)` and `runtime.ipex.unblind(hab, states)` create and register an owner on first use, even after the runtime loop is running, and `release(pre)` removes both. DH and Unblind query and reply routes dispatch to the owner of the addressed transaction; a message for an identifier without an owner is handled as before. The mode requires a v2 registry and explicitly enabled KRAM. `ipexAuxiliary` is unchanged and now runs on the same registry. `Dhke` and `Unblind` gain `inTransaction(sender, xid)`, and `AuxiliaryQueryProcessor` gains an optional `claims(serder)`.
