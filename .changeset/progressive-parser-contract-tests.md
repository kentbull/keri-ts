---
"cesr-ts": minor
---

Separate finite body hydration from progressive enclosure traversal and normalize
invalid base64 into parser deserialization errors. Move parser coverage to async
input and remove tests for obsolete feed/flush/reset API behavior while retaining
v1/v2 wire, genus selection, and enclosure-boundary assertions.
