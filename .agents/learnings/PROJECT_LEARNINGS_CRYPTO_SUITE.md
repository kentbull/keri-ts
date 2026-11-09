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

## Sealed boxes, X25519 and Argon2id

Sealed boxes, Ed25519-to-X25519 conversion and raw X25519 agreement are pure `@noble/*`
(`sealed-box.ts`, `x25519.ts`): HSalsa20 `beforenm`, BLAKE2b-192 nonce, XSalsa20-Poly1305 with
the tag first. Only noble's `invalid private or public key received` (low-order peer) and
`invalid tag` map to null; short ciphertext and wrong-length keys throw.
`sodium-parity-vectors.json` holds pysodium vectors for every former libsodium call, including
fixed-ephemeral constructions that must match byte for byte; regenerate with
`scripts/reference-sodium-parity-vectors.py` when KERIpy or a seam changes.
The IPEX DHKE owner supplies fresh independent keys and Python's local `/v1` HKDF-SHA256
context; carrying it in v2 messages does not standardize the KDF. Owned ephemeral/shared
arrays are cleared best effort, without an erasure claim.

Argon2id runs on the published `@keri-ts/hash-wasm` fork through one shared hasher, preloaded by
`pwhash.ts`'s top-level await, so derivation stays synchronous. A reused Argon2 instance must
zero its matrix before each call or it silently returns a wrong hash; the fork's `createArgon2`
does this. It leaves the Argon2 matrix, final block and derived bytes (and the tail of a password
over 1 KiB) in WebAssembly memory after a call, and memory stays at its high-water mark, so make no erasure or memory-shrink claim. KERIpy Argon2id13
work factors remain unchanged; output is a safe integer of at least 16 bytes.
Switch to upstream `hash-wasm` once it releases both fork changes.

Any backend change must repeat independent all-tier vectors and built Node/browser bindings.
Run high-tier vectors in an explicit isolated process. Faster derivation does not change
key-cache authority or LMDB reopen/close requirements.

See [Argon2 ownership](../../docs/design-docs/crypto/ARGON2_OWNERSHIP.md).
Remaining shared admission belongs to the [ESSR plan](../../docs/plans/essr/ESSR_PLAN.md).
Primitive evidence uses the selected frozen reference, not moving upstream main.

[essr]: ../../docs/design-docs/essr/RECIPIENT.md
