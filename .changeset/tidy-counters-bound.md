---
"cesr-ts": minor
---

Fix v2 attachment parsing to honor payload quadlet/triplet counts, including nested signature groups and tuple families. Reject incomplete items within complete declared payloads without consuming following groups. Previously accepted v2 item-count encodings are invalid; v1 item counts and v1 enclosure lengths retain their existing meaning.
