---
"cesr-ts": minor
"keri-ts": minor
"@keri-ts/tufa": minor
---

Align attachment counter serialization with KERIpy genus-version handling.

Adds CESR `Counter.makeGVC` and `Counter.enclose`, replaces the KERI attachment
`counterProfile` option with `gvrsn`, and updates Tufa IPEX credential commands
to use `--gvrsn`.
