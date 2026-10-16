---
"keri-ts": minor
---

Move queued reply interpretation, atomic correlation publication, live replay cursors and exact retry packets into Respondant. Remove the generic cue/direct-reply delivery classes and their callbacks; runtime construction and hosts drive the concrete reply owner and join its output before stores close.
