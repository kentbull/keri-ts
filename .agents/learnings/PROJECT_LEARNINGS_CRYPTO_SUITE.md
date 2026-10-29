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

## Sodium ownership

Salter and sealed boxes share one initialized sodium backend. Wrapper and raw
distribution identity both matter for the private wasm32 ABI. The frozen Deno lock
and generated npm vendor hashes bind the exact distribution; do not rely on an
upstream semver range or instantiate a second heap as an identity check.
Bilateral X25519 uses the same initialized sodium backend as sealed boxes.
The application registry-salt profile hashes exact authenticated init/bind bytes
with uint32 length prefixes; constructors and KDF helpers do not confer protocol
authority. Keep its local-profile vectors distinct from primitive-only byte tests,
and never log private Matter objects: their TypeScript inspection is not redacted.

The npm loader supplies native Web Crypto only when its global is absent,
before evaluating either pinned distribution. Existing globals and browser randomness
remain authoritative. Record the loader hash separately; wrapper/raw cryptographic bytes stay pinned.

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
