---
"keri-ts": patch
---

Map group rotation signatures to their prior next-key commitments independently of current member order. Use current-only signatures for newly added keys and non-rotation events so threshold recovery can replace an unavailable member without weakening either acceptance threshold.
