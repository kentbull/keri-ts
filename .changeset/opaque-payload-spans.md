---
"cesr-ts": minor
---

Replace per-unit UnknownPrimitive placeholders with one OpaqueSpan per uninterpreted payload. Its raw bytes retain their original encoding domain; opaque spans are group entries, not qualified primitives. Update annotation and Structor serialization without decoding opaque material.
