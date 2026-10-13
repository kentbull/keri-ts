---
"cesr-ts": patch
---

Bound non-native body primitives to their declared enclosure before decoding. Truncated matter inside a complete enclosure now raises a boundary error immediately, without waiting for or reading peer bytes.
