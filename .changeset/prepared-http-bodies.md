---
"keri-ts": major
"@keri-ts/tufa": patch
---

Require prepared HTTP request bodies and remove asynchronous upload-source support. CESR body-mode delivery now serializes each complete frame before starting its request, keeping source failures outside native transport classification and eliminating upload lifecycle machinery.
