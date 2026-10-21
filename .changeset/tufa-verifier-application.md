---
"keri-ts": major
"@keri-ts/tufa": minor
---

Move the verifier webhook application, its business policy and workflow database into Tufa. Import VerifierAgent and createVerifierCueBaser from @keri-ts/tufa/runtime. The keri-ts runtime application-agent and CLI verifier command exports are removed without aliases; protocol Verifier, IPEX and evidence APIs remain in keri-ts. Preserve the existing legacy-Reger application profile and workflow storage encoding.

Verifier run --once now reports final success only after its cue store, runtime and Habery close. Unexpected shutdown failures propagate, preserving simultaneous operation/cleanup failures. HTTP success still requires joined response cleanup before a local delivered marker.
