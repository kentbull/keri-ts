---
"keri-ts": major
"@keri-ts/tufa": major
---

Remove Reactor's unused complete-record queue and its runtime worker. Callers await
process or processBytes directly; queued-ingress methods, ingestKeriBytes and the
queue-only RuntimePendingState.ingress field are removed without compatibility shims.
