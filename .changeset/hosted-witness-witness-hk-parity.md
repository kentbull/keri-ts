---
"keri-ts": patch
"@keri-ts/hosting": patch
"@keri-ts/tufa": minor
---

Make the Tufa hosted witness backend follow upstream witness-hk for the whole TOTP workflow. `POST /aids` accepts the controller's full KEL (as KERIpy `kli witness authenticate` and Locksmith send it), so controllers can register or re-register after rotation; the parser alone authenticates events, and a supplied `secret` is used as given. On `POST /receipts` an invalid or missing code no longer returns 403: the event is processed as remote input (202 while escrowed, 200 with the receipt once accepted). A multi-event `/receipts` body is 400, and an unknown destination on `/aids` or `/receipts` is 400. Core `witnessReceiptPost` and hosting `handleWitnessReceiptPost` gain an optional `{ local }` option (default `true`), and hosting exports `handleWitnessReceiptPost`.
