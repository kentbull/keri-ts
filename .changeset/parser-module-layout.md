---
"cesr-ts": minor
---

Organize parser ownership into stream, frames, and attachments modules, with shared domain widths below the parser. Shorten internal frame-family names, retire stale module references, and document the resulting architecture and API migration.

Remove the unused AttachmentItem and redundant QualifiedPrimitive type aliases. Primitive now describes all qualified primitive values; opaque spans remain separate.
