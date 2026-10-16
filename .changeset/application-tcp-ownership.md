---
"cesr-ts": patch
"keri-ts": patch
"@keri-ts/tufa": patch
---

Compose TCP receive/send tasks over actual socket resources in the application,
remove TcpRead and the CESR Effection adapter/export, and delete TCP output quota
formulas. Preserve half-close, native write backpressure, fixed deadlines and joined
cleanup, including late source failures during cancellation.
