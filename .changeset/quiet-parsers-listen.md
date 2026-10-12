---
"cesr-ts": minor
---

Remove the parser and attachment-dispatch `onRecoveryDiagnostic` option and all exported recovery diagnostic types. Use normal parser error events for failures; automatic reset and strict/compat wrapper-tail handling are unchanged.
