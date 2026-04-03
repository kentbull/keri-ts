# PROJECT_LEARNINGS_CRYPTO_SUITE

## Purpose

Persistent learnings for crypto primitives, key material, and
signing/verification behavior in `keri-ts`.

## Current Status

1. Primitive semantic parity is now tracked against KERIpy `main`, not older
   v1.3.4-era assumptions.
2. Shared primitive codex subsets were added to avoid lossy aliasing when one
   CESR code is valid in multiple semantic domains.
3. `Verser`, `Tagger`, `Decimer`, `Noncer`, `Labeler`, and related hierarchy
   behavior now reflect the current KERIpy primitive model.
4. Primitive-first documentation coverage is in good shape: touched primitive
   modules now carry maintainer-oriented purpose/invariant docstrings rather
   than relying on implicit KERIpy knowledge.
5. Per-primitive test migration surfaced and closed serialization/projection
   parity gaps such as `Matter` qb2 raw extraction and `Dater.dts` projection.
6. Typed attachment-family primitive tests (`Structor`, `Aggor`, `Sealer`,
   `Blinder`, `Mediar`) now use stronger KERIpy-derived vectors rather than
   mostly synthetic smoke cases.
7. A maintainers-first primitive walkthrough and parity matrix now exist for the
   CESR surface, and they are intentionally organized by encoding basis before
   semantic subclass so maintainers can reason from `Matter` / `Indexer` /
   `Counter` outward.
8. `Matter` and `Indexer` should now be treated as infrastructure bases in
   crypto-adjacent code: if a caller knows it is handling a signer seed,
   verifier, digest, indexed signature, or detached signature, it should use the
   corresponding narrow primitive instead of returning the superclass.
9. Primitive execution parity is now the intended model for signer material in
   `keri-ts`: `Signer` is no longer a thin seed wrapper, `Salter` is no longer
   just salt storage, and the public seam should bias toward
   `Signer.sign()` / `Verfer.verify()` / `Salter.signer()` rather than free
   helper calls.
10. Sealed-box encryption parity is now also primitive-owned: `Cipher`,
    `Encrypter`, `Decrypter`, and `Streamer` form one CESR execution seam, and
    variable-family code promotion remains a `Matter` responsibility rather
    than a cipher-local exception.
11. Cipher plaintext hydration now has its own exported semantic union:
    `CipherHydratable = QualifiedPrimitive | Streamer`. This exists because
    `Primitive` is too broad for decrypt typing; it includes
    `UnknownPrimitive`, which parser fallback may produce but sealed-box
    decrypt never should.

## Scope Checklist

Use this doc for:

1. key generation/rotation semantics,
2. signing and verification compatibility,
3. digest algorithm behavior and interop,
4. serialization or encoding behavior tied to crypto primitives.

## Current Follow-Ups

1. Preserve KERIpy-main parity as the authority for primitive semantics.
2. Keep constructor/encoding convenience differences from KERIpy explicit when
   TS contracts intentionally stay narrower.
3. Keep parser-layer follow-ups separate from primitive memory unless the
   primitive contract itself changes.
4. Keep variable-family size/code normalization centralized in `Matter`; do not
   reintroduce one-off code-promotion logic in individual primitive subclasses.

## Milestone Rollup

### 2026-03-14 - Primitive Walkthrough Documentation Added

- Added a maintainers-first walkthrough of the primitive layer with human-scale
  examples, construction/parsing notes, workflow placement, and inline KERIpy
  comparisons.
- Added a compact parity matrix keyed by primitive/family so code review and
  parity checks do not require rediscovering the KERIpy module map each time.
- Documented `CesrBody` as the main intentional TypeScript-local public shape
  difference in an otherwise mostly straight-across primitive comparison story.

### 2026-03-03 - Primitive Hierarchy and Codex Parity Refresh

- Added shared codex subsets to preserve semantic validation across domains.
- Added `Tagger` and `Decimer`.
- Aligned `Verser`, `Ilker`, `Traitor`, `Noncer`, `Labeler`, `Bexter`, `Pather`,
  and `NumberPrimitive` behavior with current KERIpy semantics.

### 2026-03-04 - Primitive Docstring Completion

- Added maintainer-oriented docstrings for the touched primitive families,
  including signer/salter/cipher/encrypter/decrypter/signature/verifier layers.
- Closed remaining documentation gaps in foundational primitive contracts such
  as `Matter`, `Indexer`, and `Counter`.

### 2026-03-04 - Serialization and Structor-Family Parity Hardening

- Fixed `Matter` qb2 hydration parity for non-zero code-pad widths.
- Fixed `Dater.dts` projection to follow KERIpy qualified-text behavior.
- Expanded per-primitive tests and deepened structor-family coverage with
  stronger KERIpy-derived vectors.

### 2026-03-17 - Superclass Construction Was Demoted To Generic Seams Only

- Narrowed app- and CESR-layer constructions that were returning `Matter` or
  `Indexer` even though the semantic type was already known, especially along
  signer/verifier/digest/signature paths.
- Recorded the maintainer rule explicitly: superclass construction is for
  parser/probe seams and genuinely generic payload handling, not for ordinary
  crypto-primitive API returns.

### 2026-03-17 - Primitive Helper Documentation Was Filled In Around The Edges

- Extended the maintainer-doc sweep beyond primitive classes into the helper
  seams that actually explain primitive behavior in practice: `Matter`,
  `Indexer`, and `Counter` inhale/exhale helpers now call out their text/qb2
  normalization responsibilities explicitly.
- Preserved the grouped-doc pattern for codex families. The derived set exports
  in `primitives/codex.ts` remain documented as semantic blocks instead of
  dozens of redundant one-line comments, while callable/type seams now carry
  direct JSDoc.

### 2026-04-02 - Primitive-Owned Signature Suite Dispatch Landed

- Topic docs updated:
  - `.agents/PROJECT_LEARNINGS.md`
  - `.agents/learnings/PROJECT_LEARNINGS_CRYPTO_SUITE.md`
  - `.agents/learnings/PROJECT_LEARNINGS_KELS.md`
- What changed:
  - Added `packages/cesr/src/primitives/signature-suite.ts` as the single CESR
    authority for signer/verifier suite dispatch across Ed25519, secp256k1, and
    secp256r1.
  - Added `Verfer.verify(sig, ser)` so higher layers no longer need to inspect
    verifier codes and import concrete curve implementations themselves.
  - Fixed `Indexer` parity for small indexed “both” signature codes: when the
    code family implies `ondex=index`, `keri-ts` now preserves that implicit
    `ondex` on both construction and parse just like KERIpy.
  - Added KERIpy fixed-vector verification coverage for secp256k1 and
    secp256r1 plus direct primitive coverage for verifier-owned suite dispatch.
- Why:
  - The earlier design was architecturally backwards: runtime layers were
    bypassing the primitive that actually knows the suite encoded by CESR
    material.
  - The `ondex` fix matters just as much as the new verifier seam, because
    prior-next exposure depends on that implicit index relationship and fails
    silently if the primitive drops it.
- Tests:
  - Command:
    `deno test -A --config packages/cesr/deno.json packages/cesr/test/unit/primitives/indexer.test.ts packages/cesr/test/unit/primitives/verfer.test.ts`
  - Result: passed locally (`11 passed, 0 failed`)
- Contracts/plans touched:
  - `packages/cesr/src/primitives/signature-suite.ts`
  - `packages/cesr/src/primitives/verfer.ts`
  - `packages/cesr/src/primitives/indexer.ts`
  - `docs/ARCHITECTURE_MAP.md`
- Risks/TODO:
  - The primitive dispatch seam now covers the KERIpy verifier families in
    scope, but AEID/signator/X25519-adjacent flows remain Ed25519-specific and
    should stay isolated until that separate crypto boundary is deliberately
    widened.

### 2026-04-02 - Full Signer/Salter Mental-Model Port Landed

- Topic docs updated:
  - `.agents/PROJECT_LEARNINGS.md`
  - `.agents/learnings/PROJECT_LEARNINGS_CRYPTO_SUITE.md`
  - `.agents/learnings/PROJECT_LEARNINGS_KELS.md`
- What changed:
  - Rebuilt `packages/cesr/src/primitives/signer.ts` around KERIpy's
    executable signer model: `Signer` now owns `transferable`, `.verfer`,
    `Signer.random(...)`, and suite-driven `sign(...)` returning `Cigar` or
    `Siger` with verifier context attached.
  - Rebuilt `packages/cesr/src/primitives/salter.ts` around deterministic
    derivation behavior: `Salter` now owns `stretch(...)`, `signer(...)`, and
    `signers(...)` across Ed25519, secp256k1, and secp256r1 seed suites.
  - Added in-memory `Cigar.verfer` parity and demoted
    `packages/cesr/src/primitives/signature-suite.ts` to an internal support
    seam instead of part of the CESR public barrel.
  - Deepened Ed25519 coverage across seed -> verifier derivation,
    transferable/non-transferable code selection, detached/indexed signing, and
    deterministic salty derivation paths, while keeping fixed-suite coverage for
    secp256k1 and secp256r1.
- Why:
  - Leaving signing behavior as free helpers while verification lived on
    `Verfer` would preserve the same architectural split-brain that caused the
    original suite-dispatch bug.
  - Ed25519 is the ecosystem's reference-depth suite, so parity here must be
    richer than generic round-trip smoke tests or future suite work will erode
    the most important path first.
- Tests:
  - Command:
    `deno test -A --config packages/cesr/deno.json packages/cesr/test/unit/primitives/signer.test.ts packages/cesr/test/unit/primitives/salter.test.ts packages/cesr/test/unit/primitives/cigar.test.ts packages/cesr/test/unit/primitives/verfer.test.ts`
  - Result: passed locally (`21 passed, 0 failed`)
- Contracts/plans touched:
  - `packages/cesr/src/primitives/signer.ts`
  - `packages/cesr/src/primitives/salter.ts`
  - `packages/cesr/src/primitives/cigar.ts`
  - `packages/cesr/src/primitives/verfer.ts`
  - `packages/cesr/src/index.ts`
- Risks/TODO:
  - `Encrypter` / `Decrypter` / `Cipher` remain separate from the signer-model
    cleanup; do not overread this milestone as "all crypto primitives now own
    their whole workflow."
  - The internal suite seam now also needs the inverse verifier->signer mapping
    used by `Manager.sign({ pre, path })`; keep that table private to CESR so
    app code never reintroduces hard-coded suite branching.

### 2026-04-02 - Sealed-Box Crypto And Variable-Family Promotion Moved To The Right Layer

- Topic docs updated:
  - `.agents/PROJECT_LEARNINGS.md`
  - `.agents/learnings/PROJECT_LEARNINGS_CRYPTO_SUITE.md`
  - `.agents/learnings/PROJECT_LEARNINGS_KELS.md`
  - `docs/ARCHITECTURE_MAP.md`
- What changed:
  - Added executable CESR primitives for KERIpy-style X25519 sealed-box
    behavior: `Cipher.decrypt(...)`, `Encrypter.encrypt(...)`,
    `Encrypter.verifySeed(...)`, `Decrypter.decrypt(...)`, and the new
    `Streamer` primitive.
  - Added internal CESR seams `primitives/sealed-box.ts` and
    `primitives/byte-like.ts` so libsodium-backed box conversion, sealed-box
    open/seal, and TS byte-like normalization live below the public primitive
    API.
  - Widened the earlier cipher-normalization idea into a `Matter` refactor:
    variable-family code promotion from raw size now happens in `Matter`
    encoding/parsing logic, matching KERIpy's actual mental model instead of
    treating cipher families as a one-off special case.
  - Demoted `packages/keri/src/core/keeper-crypto.ts` to a compatibility
    wrapper over CESR primitives so keeper/app code no longer owns a parallel
    crypto implementation.
- Why:
  - A cipher-local normalization shim would have worked mechanically, but it
    would have encoded the wrong architectural rule. In KERIpy, variable-family
    promotion is a `Matter` concern because it is about qualified-material
    encoding, not about one encryption subclass.
  - Once CESR primitives became executable, keeping a second keeper-local
    sealed-box engine in `keri-ts` would have been drift, not safety.
- Tests:
  - Command:
    `deno test -A --config packages/cesr/deno.json packages/cesr/test/unit/primitives/matter.test.ts packages/cesr/test/unit/primitives/cipher.test.ts packages/cesr/test/unit/primitives/encrypter.test.ts packages/cesr/test/unit/primitives/decrypter.test.ts packages/cesr/test/unit/primitives/streamer.test.ts`
  - Result: passed locally (`23 passed, 0 failed`)
  - Command: `deno task cesr:build:npm`
  - Result: passed locally
- Contracts/plans touched:
  - `packages/cesr/src/primitives/matter.ts`
  - `packages/cesr/src/primitives/cipher.ts`
  - `packages/cesr/src/primitives/encrypter.ts`
  - `packages/cesr/src/primitives/decrypter.ts`
  - `packages/cesr/src/primitives/streamer.ts`
  - `packages/cesr/src/primitives/sealed-box.ts`
  - `packages/cesr/scripts/build_npm.ts`
  - `docs/ARCHITECTURE_MAP.md`
- Risks/TODO:
  - The libsodium-backed sealed-box seam now matches KERIpy behavior in scope,
    but maintainers should not infer broader HPKE or non-X25519 support from
    the codex alone.
  - Future primitive work should keep using `Matter` as the shared
    variable-family encoding authority instead of letting individual subclasses
    grow their own size-to-code promotion tables.

### 2026-04-02 - Constructor Vocabulary Was Normalized To `ctor`

- Topic docs updated:
  - `.agents/learnings/PROJECT_LEARNINGS_CRYPTO_SUITE.md`
  - `.agents/learnings/PROJECT_LEARNINGS_KELS.md`
- What changed:
  - Renamed cipher/decrypter constructor-selection options from `klas` to
    `ctor` and introduced the exported `CipherHydratable` /
    `CipherHydratableCtor` typing seam for decrypted plaintext hydration.
  - Kept `Primitive` and `QualifiedPrimitive` as parser/storage-domain unions
    and avoided overloading them with decrypt semantics they do not actually
    model.
- Why:
  - `klas` was a direct Pythonism. The behavior was right, but the name taught
    the wrong TypeScript mental model.
  - Reusing `Primitive` would have lied about decrypt outputs by allowing
    `UnknownPrimitive`, which is a parser fallback, not a sealed-box decrypt
    result.
- Tests:
  - Command:
    `deno test -A --config packages/cesr/deno.json packages/cesr/test/unit/primitives/cipher.test.ts packages/cesr/test/unit/primitives/decrypter.test.ts packages/cesr/test/unit/primitives/encrypter.test.ts`
  - Result: passed locally
- Contracts/plans touched:
  - `packages/cesr/src/primitives/primitive.ts`
  - `packages/cesr/src/primitives/cipher.ts`
  - `packages/cesr/src/primitives/decrypter.ts`
  - `packages/cesr/src/primitives/encrypter.ts`
- Risks/TODO:
  - Constructor parameter typing is still intentionally broad
    (`new (...args: any[])`) so this cleanup should not be mistaken for fully
    modeled
    family-specific init signatures.

### 2026-04-03 - `Matter` Reclaimed KERIpy Semantic Ownership

- Topic docs updated:
  - `.agents/PROJECT_LEARNINGS.md`
  - `.agents/learnings/PROJECT_LEARNINGS_CRYPTO_SUITE.md`
  - `.agents/learnings/PROJECT_LEARNINGS_KELS.md`
  - `docs/ARCHITECTURE_MAP.md`
- What changed:
  - Added the missing KERIpy base-material properties to
    `packages/cesr/src/primitives/matter.ts`:
    `name`, `hard`, `soft`, `size`, `both`, `transferable`, `digestive`,
    `prefixive`, `special`, and `composable`.
  - Renamed the public codex helper export from
    `NON_TRANSFERABLE_PREFIX_CODES` to `NON_TRANSFERABLE_CODES` so the readable
    TS surface matches the actual `NonTransDex` semantics instead of implying a
    narrower prefix-only meaning.
  - Removed `transferableForVerferCode(...)` from
    `packages/cesr/src/primitives/signature-suite.ts`; `Verfer` now inherits
    `transferable` from `Matter` instead of carrying a helper-backed override.
  - Kept `Signer.transferable` as an intentional explicit override with its own
    backing field so seed codes do not accidentally inherit generic
    derivation-code semantics they do not actually encode.
  - Marked `Tholder.size` as an explicit override because the new
    `Matter.size` parity property surfaced a real subclass naming overlap.
- Why:
  - Fixing `Verfer.transferable` in isolation would have preserved the wrong
    architecture. In KERIpy these semantics live on `Matter`, not on one
    crypto primitive or helper module.
  - The broader sweep also makes the primitive layer more readable: callers can
    ask the base primitive the same semantic questions KERIpy exposes instead
    of re-deriving them from codex tables or remembering local helper names.
  - `Signer` remaining the exception is not drift; it is the honest model.
    Seed material needs an explicit transferability choice because the seed code
    alone does not say whether the eventual verifier/prefix should be
    transferable.
- Tests:
  - Command:
    `deno test -A --config packages/cesr/deno.json packages/cesr/test/unit/primitives/matter.test.ts packages/cesr/test/unit/primitives/codex.test.ts packages/cesr/test/unit/primitives/verfer.test.ts packages/cesr/test/unit/primitives/signer.test.ts`
  - Result: passed locally (`23 passed, 0 failed`)
- Contracts/plans touched:
  - `packages/cesr/src/primitives/matter.ts`
  - `packages/cesr/src/primitives/codex.ts`
  - `packages/cesr/src/primitives/verfer.ts`
  - `packages/cesr/src/primitives/signer.ts`
  - `packages/cesr/src/primitives/signature-suite.ts`
  - `packages/cesr/src/primitives/tholder.ts`
  - `docs/ARCHITECTURE_MAP.md`
- Risks/TODO:
  - This is a semantic-surface parity pass, not a full port of Python-only
    constructor quirks such as `soft=` init or `strip=` parsing behavior.
  - Future primitive work should keep the rule straight: derivation-code
    semantics live on `Matter`; executable crypto behavior lives on the
    concrete primitive such as `Signer` or `Verfer`.
