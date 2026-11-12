---
"cesr-ts": minor
"keri-ts": patch
---

ACDC v2 attribute, edge and rule sections without a top-level `d` now match KERIpy. Such a section is a valid form: `d` is reserved in these sections, not required, and `kli vc create --version 2.0 --data` emits it whenever the data carries no `d`. `SerderACDC` previously inserted `d` at the end of the map while authoring, producing different bytes and a different SAID from KERIpy, and rejected KERIpy's bytes with "Invalid disclosed <label> section commitment." It now never inserts the label. The section stays expanded in both the displayed and the hashed message, also under `compactify`, while nested maps that carry their own `d` are still saidified. Sections that carry `d`, the schema section and v1 bodies are unchanged. Bodies keri-ts authored earlier carry the inserted `d` and still verify; the same input now yields KERIpy's SAID instead.
