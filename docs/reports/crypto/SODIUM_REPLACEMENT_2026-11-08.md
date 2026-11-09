# libsodium replacement evidence (2026-11-08)

Dated observations for replacing `libsodium-wrappers-sumo` in `cesr-ts` while keeping
byte-identical KERIpy/pysodium behavior. This report records what was measured; the
[crypto learnings](../../../.agents/learnings/PROJECT_LEARNINGS_CRYPTO_SUITE.md) own the resulting rules.

## Sources

| Item                  | Identity                                                                                                                           |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| keri-ts base          | `9d2d3f94` (master, PR #822 merge)                                                                                                 |
| KERIpy reference      | `/Users/kbull/enc/keri/core/python/keripy` at `f05d200c`, version `2.1.0-dev1`, pysodium over libsodium `1.0.22`                   |
| Runtime               | Deno 2.9.8, aarch64-apple-darwin; Node 25.9.0 for the npm smoke test                                                               |
| Pure-JS candidates    | `@noble/curves@1.9.7`, `@noble/hashes@1.8.0` (already shipped), `@noble/ciphers@1.3.0` (new)                                       |
| WASM Argon2 candidate | `hash-wasm@4.13.0`                                                                                                                 |
| Incumbent             | `libsodium-wrappers-sumo@0.8.4` / `libsodium-sumo@0.8.4`                                                                           |
| Adopted Argon2        | `@keri-ts/hash-wasm@4.14.0`, fork commit `2214e3ae`, integrity in [Argon2 ownership](../../design-docs/crypto/ARGON2_OWNERSHIP.md) |

## Vector matrix

`packages/cesr/scripts/reference-sodium-parity-vectors.py` runs in the KERIpy venv and writes
`packages/cesr/test/fixtures/sodium-parity-vectors.json`. Every libsodium call keri-ts makes has a
section; deterministic calls store outputs, the random sealed box stores both pysodium ciphertexts
(keri-ts must open) and fixed-ephemeral constructions built from `crypto_box` + BLAKE2b-192 and
verified with `crypto_box_seal_open` (keri-ts must reproduce byte for byte).

| Section                      | Covers                                                                                                         | Cases                          |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `ed25519_to_x25519`          | `crypto_sign_seed_keypair`, `pk_to_curve25519`, `sk_to_curve25519`, `scalarmult_base` consistency              | 4 seeds                        |
| `x25519`                     | `scalarmult_base`, symmetric `scalarmult`, clamping edge scalars, 7 low-order peers (all rejected by pysodium) | 5 keys, 10 agreements, 7 peers |
| `sealed_boxes`               | pysodium `crypto_box_seal`, plaintexts 0 to 1024 bytes including qb64 seed/salt                                | 14                             |
| `deterministic_sealed_boxes` | fixed ephemeral scalar, nonce, ciphertext                                                                      | 14                             |
| `qualified`                  | KERIpy `Encrypter`/`Decrypter`/`Cipher` qb64 for seed, salt and `L0` stream plaintexts, `verifySeed`           | 2 recipients x 3               |
| `argon2id`                   | KERIpy `Salter.stretch` temp/low/med/high with paths `""`, `"0"`, `"a\0b"` and sizes 16/32/64                  | 10                             |

`packages/cesr/test/unit/primitives/crypto/sodium-parity.test.ts` checks every section except
medium/high Argon2 tiers; `packages/cesr/scripts/qualify-salter-derivation.ts --allow-high-memory`
checks those in isolation together with the older `salter-pwhash-vectors.ts`.

## Baseline (libsodium, before any change)

All sections exact, including isolated medium/high tiers. Argon2id timings on this machine:
low ~80 ms, med ~540 ms, high ~3.1 s for 32-byte output.

## Sealed box, key conversion and X25519 on noble

`sealed-box.ts` and `x25519.ts` were rewritten over `@noble/curves` (X25519, Ed25519 to Montgomery),
`@noble/ciphers` (HSalsa20, XSalsa20-Poly1305) and `@noble/hashes` (BLAKE2b nonce). Results:

- All parity sections exact, including the 14 fixed-ephemeral constructions (byte-identical ciphertext).
- Reverse direction: 42 boxes sealed by the noble code (14 plaintexts x 3 fresh ephemeral keys) all
  opened by `pysodium.crypto_box_seal_open`; all 42 last-byte tamper cases raised.
- Low-order peers: noble throws `invalid private or public key received` exactly where libsodium
  returned -1; the seam maps that and `invalid tag` to null, and throws for short ciphertext or
  wrong-length keys, preserving the existing `Decrypter.open` contract.
- cesr crypto unit tests: 100 passed. `dhking.test.ts` and `essr.test.ts`: 8 passed.
- Generated npm package builds (dnt) with `@noble/ciphers@1.3.0` added automatically; Node 25.9.0
  encrypt/decrypt round trip and vendored-libsodium `Salter.stretch` both run.

## Argon2id backends

`packages/cesr/scripts/qualify-argon2-backends.ts --allow-high-memory` ran all three backends over
both fixtures in one process (18 vectors each). Elapsed is min to max per tier.

| Backend                          | temp   | low (64 MiB, t=2) | med (256 MiB, t=3) | high (1 GiB, t=4) | Exact                         |
| -------------------------------- | ------ | ----------------- | ------------------ | ----------------- | ----------------------------- |
| libsodium (current `pwhash.ts`)  | 0–1 ms | 80–147 ms         | 531–614 ms         | 3.0–3.3 s         | 18/18                         |
| `@noble/hashes/argon2` (pure JS) | 0–4 ms | 1.08–1.12 s       | 6.4–6.6 s          | 34.7–35.4 s       | 18/18                         |
| `hash-wasm`                      | 0–3 ms | 0–106 ms          | 0–637 ms           | 3.6 s             | 12/12 where it ran; 6 refused |

hash-wasm refused every vector whose path is the empty string with `Password must be specified`.
That is a deliberate check in its public API (`lib/argon2.ts`), not an Argon2 limitation; the
internal function is not exported. KERIpy's default `Salter.stretch(path="")` uses an empty
password, so hash-wasm cannot be adopted without a fork, vendored patch or upstream option.

## Browser payload

`deno bundle --platform browser --minify` from the worktree root; gzip -9. No module was left
external, so the libsodium figures are complete.

| Entry                                           | Minified  | Gzipped   | Embedded WASM  |
| ----------------------------------------------- | --------- | --------- | -------------- |
| libsodium sealed box + X25519 (before)          | 536,331 B | 188,480 B | yes            |
| noble sealed box + X25519 (after)               | 50,753 B  | 19,760 B  | no             |
| `@noble/curves` ed25519 alone (already shipped) | 30,653 B  | 12,936 B  | no             |
| noble sealed box + ed25519 together             | 50,766 B  | 19,779 B  | no             |
| libsodium `pwhash.ts` (Argon2 only)             | 536,311 B | 188,643 B | yes, same blob |
| `@noble/hashes` argon2                          | 12,516 B  | 5,024 B   | no             |
| `hash-wasm` argon2id                            | 29,130 B  | 11,372 B  | yes            |
| `libsodium-wrappers@0.8.4` standard (non-sumo)  | 948,834 B | 299,419 B | yes            |

Marginal cost of the noble sealed box over what keri-ts already ships is about 20 KB minified,
6.8 KB gzipped. The raw `libsodium-sumo.js` file is 1.2 MB / 391 KB gzipped; the bundler's
536 KB figure is what a consumer actually ships. The standard non-sumo build is larger, not smaller.

## Argon2id on the published fork

`hash-wasm` was forked to accept empty passwords and to add a synchronous `createArgon2` API, both proposed upstream
([#86](https://github.com/Daninet/hash-wasm/pull/86), [#87](https://github.com/Daninet/hash-wasm/pull/87)). `pwhash.ts`
now runs on `@keri-ts/hash-wasm@4.14.0` and libsodium is gone from `cesr-ts`. A reused Argon2 instance returned a wrong
hash until its working memory was zeroed before each call; the fork does this.

`packages/cesr/scripts/qualify-argon2-backends.ts --allow-high-memory`, 18 vectors per backend, all exact:

| Backend                        | temp   | low (64 MiB, t=2) | med (256 MiB, t=3) | high (1 GiB, t=4) |
| ------------------------------ | ------ | ----------------- | ------------------ | ----------------- |
| `pwhash.ts` on the fork (sync) | 0–2 ms | 91–116 ms         | 590–614 ms         | 3.4–3.6 s         |
| fork async `argon2id`          | 0–1 ms | 94–99 ms          | 618–660 ms         | 3.4–3.6 s         |
| `@noble/hashes/argon2`         | 0–5 ms | 1.06–1.11 s       | 6.4–6.6 s          | 34.3–35.4 s       |

The isolated `qualify-salter-derivation.ts --allow-high-memory` run matched all 18 vectors with peak RSS of about 1.07 GiB,
the same as the libsodium baseline. Node 25.9.0 reproduced the temp and low `Salter.stretch` vectors from the built npm
package.

Final browser payload, measured as above:

| Entry                                               | Minified | Gzipped  | `libsodium` occurrences |
| --------------------------------------------------- | -------- | -------- | ----------------------- |
| crypto layer: sealed box, X25519, `pwhash`, ed25519 | 80,829 B | 31,277 B | 0                       |
| `pwhash.ts` alone                                   | 29,982 B | 11,748 B | 0                       |

## Conclusions

1. Sealed boxes, Ed25519 to X25519 conversion and raw X25519 agreement do not need libsodium. The noble implementation
   is byte-identical in both directions.
2. Removing `pwhash.ts`'s libsodium import reduces the crypto layer's browser payload from about 188 KB to about 31 KB
   gzipped.
3. The Argon2id options were all byte-identical where they ran. `hash-wasm` was chosen over `@noble/hashes/argon2`,
   which is smaller by about 6 KB gzipped but about 10x slower (35 s at the high tier), at the cost of carrying a fork
   until upstream releases both changes and of losing libsodium's owned-buffer zeroing.

## Limits

- Timings are single-machine, single-run observations with other processes active; use them for
  order of magnitude only.
- Peak memory of the pure-JS Argon2 at the high tier was not measured.
- `argon2-browser` and other WASM Argon2 builds were not tested.
- Payload figures are for Deno's bundler; other bundlers will differ slightly but not in ranking.

## Regeneration

```bash
cd /Users/kbull/enc/keri/core/python/keripy && ./venv/bin/python <keri-ts>/packages/cesr/scripts/reference-sodium-parity-vectors.py <out.json>        # add --high for the 1 GiB tier
cd <keri-ts> && deno test -A packages/cesr/test/unit/primitives/crypto/sodium-parity.test.ts
cd <keri-ts> && deno run -A packages/cesr/scripts/qualify-salter-derivation.ts --allow-high-memory
cd <keri-ts> && deno run -A packages/cesr/scripts/qualify-argon2-backends.ts --allow-high-memory
```
