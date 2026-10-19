---
"keri-ts": major
"@keri-ts/tufa": major
---

Move reply delivery progress and joined transport cleanup from Respondant to Poster.
Callers now drive Poster.process(), inspect Poster.hasPending, and close Poster;
Respondant constructs and publishes replies without owning transport services.
Existing reply ordering and retry behavior are preserved for this ownership step.
