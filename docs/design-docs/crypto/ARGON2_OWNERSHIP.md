# Argon2id backend and memory posture

`pwhash.ts` derives Argon2id (version 0x13, parallelism 1) through one shared hasher from `@keri-ts/hash-wasm`.
`Salter` owns work factors and tier selection; this module owns only the derivation seam. Sealed boxes, key conversion
and raw X25519 agreement use `@noble/*` and are covered by `test/fixtures/sodium-parity-vectors.json` (see the
[replacement report](../../reports/crypto/SODIUM_REPLACEMENT_2026-11-08.md)).

## Dependency pin

| Field             | Value                                                                                               |
| ----------------- | --------------------------------------------------------------------------------------------------- |
| Package           | `@keri-ts/hash-wasm@4.14.0`, a published fork of `hash-wasm` 4.13.0                                 |
| Fork commit       | `2214e3ae59e45e080bf17c774a5e5fc8fa033829` on `kentbull/hash-wasm` `release/keri-ts`, tag `v4.14.0` |
| Tarball integrity | `sha512-yKjWch79qGHM9pLKjSMKbWOnfKghb/CarG5wXcYkdMVheoS101yWQONjHBFSY3VKjIZxfVqQZ5b0c0zZg+oEJw==`   |
| Argon2 WASM hash  | `2b50b0d6`, identical to published upstream 4.13.0                                                  |
| BLAKE2b WASM hash | `22cf500a`, identical to published upstream 4.13.0                                                  |

The fork carries two changes upstream has not released: accepting empty passwords
([Daninet/hash-wasm#86](https://github.com/Daninet/hash-wasm/pull/86)), which KERIpy's default `Salter.stretch(path="")`
needs, and the synchronous `createArgon2` API ([Daninet/hash-wasm#87](https://github.com/Daninet/hash-wasm/pull/87)).
`deno.lock` records the tarball integrity and Deno checks it on resolution; the lock is not frozen, so a changed
specifier updates the entry instead of failing. dnt carries the exact version into the generated `dependencies`.

When upstream releases both changes, switch to `hash-wasm@<version>`, remove the scoped dependency, and
`npm deprecate @keri-ts/hash-wasm` with a pointer to upstream.

## Contract

`deriveArgon2id(password, salt, size, operations, memoryBytes)` returns a new `Uint8Array` the caller owns. It requires a
`Uint8Array` password of at most 2147483647 bytes, a 16-byte `Uint8Array` salt, and safe-integer `size` (16, the
libsodium/KERIpy minimum, through 2147483647), `operations` (1 through 2147483647) and `memoryBytes` (8192 through
2147483647), and rejects anything else with `RangeError` before deriving. The effective memory ceiling is lower; see
Memory. `memoryBytes` becomes whole KiB by truncation, as libsodium
does. Backend failures propagate. There is no derived-key cache or provider selection.

The module's one top-level await instantiates the WebAssembly modules, so importing it fails where WebAssembly is
unavailable; primitive APIs are synchronous after that.
Derivation runs to completion on the JavaScript thread with no suspension point, so calls cannot interleave. Each worker
or module instance has its own hasher.

## Memory

**Before each derivation** the hasher zeroes its Argon2 working memory. Argon2's first pass XORs into that matrix, so a
reused instance would otherwise return a wrong result without an error. This is a correctness step that also overwrites
the previous derivation's matrix within the new working set; it is not an erasure guarantee.

**After each derivation nothing is erased.** Until a later call happens to overwrite them, WebAssembly linear memory
retains the Argon2 matrix (with the final block also copied to block 0) and, in the separate BLAKE2b instance's 16 KiB
input buffer, the derived bytes and the rest of the final block, plus the tail of any password longer than 1 KiB. The
salt and the first 1 KiB of the password are overwritten during the derivation itself, and the BLAKE2b state is zeroed
on every init, ending with only the final digest state. A smaller derivation does not overwrite the area beyond its own working set. JavaScript intermediates, including
an immutable hexadecimal string of the final block, stay until garbage collection and cannot be cleared; the
interface's 2 KiB hex scratch buffer also holds the final block's hex until the next derivation overwrites it. The
password is passed by view, not copied, and the seam does not clear the caller's array or the returned bytes.

This is a reduction from the former libsodium path, which zeroed its owned password, salt and output allocations before
freeing them. That path never established whole-memory erasure either: another complete derived-seed copy was observed
in an unowned native temporary. No secret-erasure claim applies to Argon2id in `cesr-ts`.

**Capacity does not shrink.** WebAssembly memory only grows, and the shared hasher lives as long as its module, so one
high-tier derivation keeps about 1 GiB allocated for the process lifetime. The libsodium backend had the same high-water
behavior. Growth replaces the underlying buffer; the interface takes a new view each time it sets the memory size. The
module's memory maximum is 2 GiB; after its 128 KiB static region and the 1 KiB parameter block, `memoryBytes` of
2147352576 or more fails, as does any growth the host refuses. The interface ignores the failed grow, so the caller sees
a `RangeError` from its typed-array view before any input is written, and the hasher remains usable.

## Upgrades

Any change of backend or version must repeat the independent all-tier vectors in `sodium-parity-vectors.json` and
`salter-pwhash-vectors.ts`, the isolated `scripts/qualify-salter-derivation.ts --allow-high-memory` run, and the built
Node and browser checks.
