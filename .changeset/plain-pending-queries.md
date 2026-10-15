---
"keri-ts": minor
---

Use a private ordinary Deck for pending QueryRequest records. Remove unused pending-query/continuation caps and metadata byte reservations while preserving failed-send retry, finite processing passes, signer deferral and joined shutdown. Keep actual wire and transport ownership separate.
