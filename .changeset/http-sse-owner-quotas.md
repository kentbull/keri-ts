---
"keri-ts": patch
"@keri-ts/tufa": patch
---

Remove HTTP request reservations, client Fetch/SSE and attachment-header size
ceilings, and static-artifact allowances. Retain native backpressure, poll
and request cancellation, file extent correctness and joined I/O cleanup.
