---
"cesr-ts": patch
---

Use one attachment loop for streaming and bounded frames, and replace the stateless frame parser and attachment collector objects with functions. Preserve explicit exhaustion, enclosure, and genus boundaries.

Complete v1 attachment enclosures now reject truncated inner items immediately, matching the bounded-input rule already applied to v2.
