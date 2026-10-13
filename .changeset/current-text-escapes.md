---
"cesr-ts": patch
"keri-ts": patch
---

Align Bexter and Labeler with current KERIpy text escaping so leading A and
hyphen values survive encoding and decoding. Preserve Pather's separate path
escape convention, and avoid expanded byte arrays when decoding large Bexters.
