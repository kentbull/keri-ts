---
"cesr-ts": patch
"keri-ts": patch
---

Use pinned libsodium Argon2id for faster byte-compatible Salter derivation, wiping owned WASM buffers before release. Preserve KERIpy tier parameters and enforce its 16-byte minimum output; whole-process erasure is not claimed.
