---
"keri-ts": patch
---

Report KRAM refusals. `Kramer` logs each refused message once (replay at debug), pruning warns when it expires an
incomplete multi-signature message, time refusals carry the last acceptable `deadline`, and `KramRefusedError` plus
the refusal types are exported from the runtime.
