---
"cesr-ts": patch
"keri-ts": patch
---

Preserve typed seal SADs in native KERI event construction and parsing, including homogeneous seal runs and current KERIpy numeric encoding. Share automatic numeric code selection through NumberPrimitive.fromNum across seal, Serder, and threshold projections. Restrict native seal lists to event fields and reject unsupported entries before they can be lost.
