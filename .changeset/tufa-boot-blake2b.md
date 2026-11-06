---
"@keri-ts/tufa": patch
---

The kf boot service selects witness backends with `cesr-ts`'s `blake2bDigest` instead of importing `@noble/hashes` directly, so the Tufa npm package passes its forbidden-dependency guard again.
