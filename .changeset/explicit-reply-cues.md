---
"keri-ts": minor
---

Make reply cues disjoint: prebuilt replies carry only their authoritative serder, while TSN replies carry the matching complete state record and destination. Serialize TSN records at Hab interpretation and preserve registry-first tuple types. Remove duplicate prebuilt route fields and optional empty-body fallbacks; update cue callers to the explicit forms.
