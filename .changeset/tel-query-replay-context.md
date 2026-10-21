---
"keri-ts": patch
"@keri-ts/tufa": patch
---

Use parsed request attachment context for legacy TEL replay, serving v1-compatible source seals/counters without a v2 selector to unselected legacy requests while retaining explicit v2 framing. Preserve signed bodies and proof meaning.

Replay APIs now honor the selected version exactly and expose UnsupportedTelReplayError instead of silently raising it. TCP confines this expected refusal to the requesting connection and reports unsupported-replay locally; whole-cue responders publish nothing from an incompatible cue. No remote refusal protocol is added. See the 2.0.0 breaking guide for iterator-prefix and callback result changes.
