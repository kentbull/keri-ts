---
"@keri-ts/verifier": patch
"@keri-ts/tufa": patch
---

Use the runtime HTTP client and ordinary HTTPS certificate validation for ACDC v2 observer requests. Move observer selection, observation age and request timeout into the verifier application configuration, removing the dedicated observer and TLS command-line options.
