---
"cesr-ts": patch
---

Build X25519 sealed boxes, Ed25519-to-X25519 key conversion and raw X25519 agreement from `@noble/curves`, `@noble/ciphers` and `@noble/hashes` instead of libsodium, verified byte-for-byte against pysodium vectors in both directions. `Decrypter.open` still returns null only for authentication failure.
