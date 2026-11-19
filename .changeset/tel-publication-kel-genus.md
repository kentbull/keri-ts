---
"keri-ts": patch
---

Fix legacy TEL publication to KERIpy witnesses: registry and credential TEL events (`vcp`, `iss`, `rev`) from a KERI
v2 issuer now go to its witnesses with v2 attachments, the issuer's KEL genus, as KERIpy disseminates them. They used
to carry v1 attachments flagged only by `CESR-Genus: 1`, which KERIpy ignores, so KERIpy 2.x witnesses dropped every
TEL event (and flushed the rest of their shared intake stream with it). The TEL bodies stay KERI v1.
