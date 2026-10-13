# Owned Argon2id buffers

`pwhash.ts` is a narrow internal allocation owner for the exact `libsodium-wrappers-sumo@0.8.4` / `libsodium-sumo@0.8.4`
backend. The standard wrapper frees its temporary password, salt, and output allocations without wiping them. This
helper zeroes those three owned WASM ranges before freeing, including native failure and partial allocation. The
returned JavaScript byte array remains caller-owned. There is no derived-key cache or provider selection.

The implementation deliberately uses the private wasm32 C ABI exposed through `libsodium`. Version 0.8.4 lowers
`crypto_pwhash` to eleven arguments: output pointer, output-length low/high, password pointer, password-length low/high,
salt pointer, operation-count low/high, memory bytes, and algorithm. The high halves are zero because supported inputs
are bounded to signed 32-bit lengths. This was checked against the pinned wrapper's actual call and native export. A
dependency upgrade must repeat ABI, independent byte-vector, allocation-failure, and packaged runtime tests; this is not
a promise of ABI stability across versions.

Output lengths must be safe integers between 16 (libsodium/KERIpy's minimum) and 2147483647 (this wrapper ABI's bound).
Noble previously accepted 4–15-byte outputs; that TypeScript-only behavior is intentionally not retained. All currently
supported signer suites use 32 bytes. Work factors and Argon2id13 selection remain owned by Salter and unchanged. Large
allocations can still fail normally.

Every allocation and derivation may replace `HEAPU8` after memory growth. Copying and clearing therefore obtain the
current view, never a view retained before the native call. `_sodium_memzero` is not exported by this build; direct
writes to the owned `HEAPU8` ranges provide observable zeroing before `_free`. No unowned memory is cleared, and one
cleanup failure does not skip cleanup of the remaining owned allocations.

This does **not** establish whole-process or whole-WASM secret erasure. A synthetic characterization found another
complete derived-seed copy in an unowned native temporary range after the owned allocations were wiped. No stack-control
exports are available in this pinned module; its boundaries must not be guessed or wiped. JavaScript copies and native
temporaries remain a process-memory limitation. Additionally, WASM retains its high-water memory capacity after free:
isolated high-tier qualification observed approximately 1.15 GiB RSS. Owned-range zeroing and allocator release do not
claim to shrink that capacity.

The Deno graph binds both packages through its frozen lock. Generated npm builds use `scripts/npm/vendor-sodium.ts` to
authenticate the two exact 0.8.4 ESM distribution files and their ISC license by SHA-256, then copy them into the
generated package. The wrapper's single raw-module import points to that adjacent copy; the private runtime entry points
to the copied wrapper. This preserves one backend and one heap without relying on the wrapper's upstream `^0.8.0`
raw-module dependency. No crypto code is edited. Unexpected hashes or imports fail the build. The generated directory
includes its license and original/rewritten hash provenance. The external wrapper dependency remains for declarations,
not runtime resolution.
