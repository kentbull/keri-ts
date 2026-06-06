---
"@keri-ts/tufa": patch
---

Normalize the Tufa npm `bin.tufa` entry to a bare relative path so npm publish
does not rewrite package metadata.
