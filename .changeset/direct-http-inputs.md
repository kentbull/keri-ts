---
"keri-ts": patch
"@keri-ts/tufa": patch
---

Move HTTP, witness and multisig replay parsing into their concrete input scopes.
Remove the HTTP parser-options bag and preserve foreign cleanup failures while
joining cancellation, without an Effection frame-channel dependency.
