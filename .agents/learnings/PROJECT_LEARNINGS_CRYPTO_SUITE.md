# Crypto learnings

## Primitive boundaries

Signer/Verfer own executable suite dispatch; higher layers call primitives or
Manager orchestration, never concrete curve implementations. Salter owns signer
derivation and work factors. Matter owns derivation-code meaning and variable
size promotion. Shared codex subsets prevent lossy aliases across semantic roles.
Indexed signatures must preserve implicit `ondex=index` in the small both-index
families and distinguish current-only signatures.

Cipher, Encrypter, Decrypter and Streamer own sealed-box semantics. Cipher hydration
accepts QualifiedPrimitive or Streamer; parser fallback UnknownPrimitive is not a
decrypt result. ESSR Texters contain raw ciphertext, not Cipher qb64.

`Decrypter.open`/`Manager.open` return null only for the pinned raw authentication
failure. Unexpected backend errors, corrupt keeper state and missing keys propagate.
Qualified `decrypt` still throws on failed authentication. The [ESSR recipient][essr]
owns admission, digest/SCS checks and plaintext staging after durable EXN acceptance;
the parser never decrypts.

Diger owns the shared incremental algorithm registry. Hash ordered concatenated
decoded Texter bytes, not qualified text. EXN `a` may be a string digest even
though `.seals` is array-only; verify it after signatures and before acceptance.

## Sealed boxes, X25519 and the remaining sodium backend

Sealed boxes, Ed25519-to-X25519 conversion and raw X25519 agreement are pure `@noble/*`
(`sealed-box.ts`, `x25519.ts`): HSalsa20 `beforenm`, BLAKE2b-192 nonce, XSalsa20-Poly1305 with
the tag first. Only noble's `invalid private or public key received` (low-order peer) and
`invalid tag` map to null; short ciphertext and wrong-length keys throw. Do not reintroduce
sodium calls there. `sodium-parity-vectors.json` holds pysodium vectors for every former
libsodium call, including fixed-ephemeral constructions that must match byte for byte;
regenerate with `scripts/reference-sodium-parity-vectors.py` when KERIpy or the seam changes.
The IPEX DHKE owner supplies fresh independent keys and Python's local `/v1` HKDF-SHA256
context; carrying it in v2 messages does not standardize the KDF. Owned ephemeral/shared
arrays are cleared best effort, without an erasure claim.

`pwhash.ts` is now the only consumer of the initialized sodium backend, so the libsodium blob
(about 188 KB gzipped bundled) is still shipped until Argon2id moves. Wrapper and raw
distribution identity both matter for its private wasm32 ABI. The frozen Deno lock and
generated npm vendor hashes bind the exact distribution; do not rely on an upstream semver
range or instantiate a second heap as an identity check. The npm loader supplies native Web
Crypto only when its global is absent, before evaluating either pinned distribution. Measured
alternatives are byte-identical but trade differently: `@noble/hashes/argon2` is about 13x
slower, `hash-wasm` matches libsodium speed but rejects the empty password KERIpy's default
path produces. See the [replacement report](../../docs/reports/crypto/SODIUM_REPLACEMENT_2026-11-08.md).

`pwhash.ts` owns password/salt/output allocations and reloads HEAPU8 after growth.
Zero-before-free applies only to owned ranges. Native temporaries and JS copies
can remain, and WASM retains its high-water memory after free. No process-erasure
or memory-shrink guarantee follows. KERIpy Argon2id13 work factors remain unchanged;
output is a safe integer of at least 16 bytes, not the old Noble-only 4–15 range.

Any upgrade must repeat ABI/authentication-failure mapping, independent all-tier
vectors, allocation/cleanup failures and built Node/browser bindings. Run high-tier
vectors in an explicit isolated process. Faster derivation does not change key-cache
authority or LMDB reopen/close requirements.

See [Argon2 ownership](../../docs/design-docs/crypto/ARGON2_OWNERSHIP.md).
Remaining shared admission belongs to the [ESSR plan](../../docs/plans/essr/ESSR_PLAN.md).
Primitive evidence uses the selected frozen reference, not moving upstream main.

[essr]: ../../docs/design-docs/essr/RECIPIENT.md
