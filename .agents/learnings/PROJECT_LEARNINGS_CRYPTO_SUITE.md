# PROJECT_LEARNINGS_CRYPTO_SUITE

## Purpose

Persistent learnings for crypto primitives, key material, and
signing/verification behavior in `keri-ts`.

## Current State

1. Primitive semantic parity is tracked against current KERIpy `main`, not
   older bootstrap-era assumptions.
2. Shared primitive codex subsets exist to avoid lossy aliasing when one CESR
   code participates in multiple semantic domains.
3. Primitive-first documentation is in good shape: touched modules carry
   maintainer-oriented purpose/invariant docs rather than assuming KERIpy
   context is already in the maintainer's head.
4. Per-primitive tests and stronger KERIpy-derived vectors closed important
   serialization and projection gaps such as `Matter` qb2 raw extraction,
   `Dater.dts`, and structor-family behavior.
5. A maintainers-first primitive walkthrough and parity matrix exist and are
   intentionally organized from `Matter` / `Indexer` / `Counter` outward.
6. `Matter` and `Indexer` should be treated as infrastructure bases in
   crypto-adjacent code. If the semantic type is known, use the narrow
   primitive instead of the superclass.
7. Executable signer behavior is primitive-owned: `Signer.sign()`,
   `Verfer.verify()`, and `Salter.signer()` are the preferred public seams,
   not free helper calls in higher layers.
8. Signature-suite dispatch now lives in one CESR-owned support seam, so higher
   layers no longer need to inspect verifier codes and import curve-specific
   implementations themselves.
9. Indexed-signature parity includes the small indexed "both" code families
   whose implicit `ondex=index` relationship matters for prior-next handling.
10. Sealed-box behavior is also primitive-owned: `Cipher`, `Encrypter`,
    `Decrypter`, and `Streamer` form one semantic CESR execution seam.
11. Variable-family code promotion belongs in `Matter`, not in ad hoc
    primitive-local normalization branches.
12. Cipher plaintext hydration uses the narrower
    `CipherHydratable = QualifiedPrimitive | Streamer` contract because
    `UnknownPrimitive` is a parser-fallback concern, not a decrypt result.
13. `Matter` owns derivation-code semantics. Concrete crypto primitives own
    executable behavior. Keeping those responsibilities separate is the stable
    mental model.

## Use This Doc For

1. Key generation, derivation, and rotation semantics.
2. Signature, verifier, and digest behavior.
3. Encryption/decryption behavior tied to CESR primitives.

## Key Docs

1. `docs/archived-plan-docs/cesr/cesr-primitives/CESR_PRIMITIVES_WALKTHROUGH.md`
2. `docs/archived-plan-docs/cesr/cesr-primitives/CESR_PRIMITIVES_KERIPY_PARITY_MATRIX.md`
3. `docs/ARCHITECTURE_MAP.md`

## Current Follow-Ups

1. Preserve KERIpy `main` as the authority for primitive semantics.
2. Keep intentional TypeScript-local convenience differences explicit whenever
   public contracts stay narrower than KERIpy.
3. Keep parser-layer follow-ups separate unless the primitive contract itself
   changes.
4. Keep variable-family size/code normalization centralized in `Matter`.
5. Avoid widening crypto ownership boundaries casually; suite-specific or
   AEID-specific broadening should happen deliberately, not by leakage.

## Milestone Rollup

### 2026-03-03 to 2026-03-04 - Primitive Hierarchy, Docs, And Test Hardening

- Refreshed codex/primitive hierarchy behavior against current KERIpy,
  including `Tagger`, `Decimer`, `Verser`, `Ilker`, `Traitor`, `Noncer`,
  `Labeler`, and related families.
- Added maintainer-grade docstrings across the primitive stack and deepened
  per-primitive test coverage with stronger KERIpy-derived vectors.

### 2026-03-14 to 2026-03-17 - Primitive Construction And Doc Ownership Tightened

- Added the maintainers-first primitive walkthrough and parity matrix.
- Demoted superclass construction to genuinely generic seams and filled in the
  helper-level documentation that explains how primitives actually inhale,
  exhale, and normalize data.

### 2026-04-02 - Signature Ownership Moved Fully Into Primitives

- Added the shared signature-suite dispatch seam.
- Moved verification onto `Verfer.verify(...)` and rebuilt `Signer` / `Salter`
  around KERIpy's executable signer model, including real verifier context on
  `Cigar` and deterministic salty derivation behavior.

### 2026-04-02 - Sealed-Box And Variable-Family Ownership Moved To The Right Layer

- Added KERIpy-style sealed-box behavior through `Cipher`, `Encrypter`,
  `Decrypter`, and `Streamer`.
- Moved variable-family size/code promotion into `Matter`, matching KERIpy's
  actual ownership model instead of scattering promotion logic across helpers.

### 2026-04-03 - Matter Semantics And Maintainer Docs Reached The Helper Seams

- Reasserted `Matter` as the owner of derivation-code semantics while keeping
  executable crypto on concrete primitives.
- Extended maintainer-facing docs through the remaining helper and support seams
  so the source now explains the real ownership split instead of leaving it to
  tribal memory.
