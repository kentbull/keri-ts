---
"cesr-ts": patch
---

Separate v1 item-count and v2 bounded-payload parsing handlers for tuples and signature groups. Select handlers during dispatch construction and remove the tuple-parser cache. Parsing behavior and public APIs are unchanged.
