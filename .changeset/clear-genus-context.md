---
"cesr-ts": patch
---

Keep an explicit CESR genus selection independent of message protocol versions.
A v1 KERI body under genus 2 now retains v2 attachment decoding across chunks
and following messages. Nested selectors stay local to their enclosure.

Reject incompatible body versions and alternate-major counter reinterpretation
in selected contexts, while preserving unselected legacy v1 parsing. Correct
selector fixtures to encode the full two-character minor version.
