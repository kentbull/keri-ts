---
"cesr-ts": patch
"keri-ts": patch
---

Keep finite nested/ESSR hydration and wire formatting independent of cancellation.
Payload readers and replay operations own cancellation before publishing bytes;
archive/file readers retain their actual I/O signals.
