---
"keri-ts": patch
"@keri-ts/tufa": patch
---

Honor the caller HTTP signal through headers and response-body ownership, keeping
external cancellation distinct from timeout. Report late foreign AbortError body
failures from the Node host instead of mistaking them for its own cancellation.
