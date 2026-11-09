---
"cesr-ts": minor
"keri-ts": minor
---

Remove libsodium from the published packages. Argon2id `Salter` stretching now runs on `@keri-ts/hash-wasm`, a fork of `hash-wasm` with empty-password support and a synchronous API, and stays byte-identical to KERIpy on every tier. The crypto layer's browser payload falls from about 188 KB gzipped to about 31 KB.
