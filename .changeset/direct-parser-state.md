---
"cesr-ts": minor
"keri-ts": minor
---

Move stream state directly into CesrParser and remove the unused public ParserState interface and KERI reexport. Buffering, offsets, reset, and frame completion retain their existing semantics.
