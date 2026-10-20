---
"keri-ts": major
"@keri-ts/tufa": patch
---

Reserve keyStateSaved for validated and persisted remote KSN replies. Ordinary KEL acceptance no longer emits a remote-notice cue; query workflows wait for a genuine saved KSN before comparing its target with accepted local state.
