# PROJECT_LEARNINGS_CRYPTO_SUITE

## Purpose

Persistent learnings for crypto primitives, key material, and
signing/verification behavior in `keri-ts`.

## Current Status

### 2026-03-03

1. Primitive parity checks now track KERIpy `main` (`5a5597e8`) rather than
   v1.3.4 assumptions.
2. Shared primitive codex subsets were added for semantic validation to avoid
   lossy code-name aliasing when one CESR code is valid in multiple domains.
3. `Noncer` behavior is now aligned with KERIpy inheritance and codex semantics
   (extends `Diger` in non-strict mode, validates full `NonceCodex` subset).
4. `Verser`/`Tagger`/`Decimer` class model has been brought in line with current
   KERIpy primitive hierarchy and version-tag semantics.

## Scope Checklist

Use this doc for:

1. key generation/rotation semantics,
2. signing and verification compatibility,
3. digest algorithm behavior and interop,
4. serialization or encoding behavior tied to crypto primitives.

## Planned Sections

1. Decision log
2. Interop quirks and parity notes
3. Test corpus references
4. Known risks and TODOs

## Handoff Log

### 2026-03-03 - Primitive Hierarchy Parity Refresh

- Topic docs updated:
  - `docs/design-docs/learnings/PROJECT_LEARNINGS_CRYPTO_SUITE.md`
- What changed:
  - Added KERIpy-main-aligned primitive semantic codex subsets in
    `packages/cesr/src/primitives/codex.ts`.
  - Added `Tagger` and `Decimer` primitives and exported them from the CESR
    package barrel.
  - Updated `Verser`, `Ilker`, `Traitor`, `Noncer`, `Labeler`, `Bexter`,
    `Pather`, and `NumberPrimitive` code-validation/decoding behavior to align
    with KERIpy main codex/domain semantics.
- Why:
  - Preserve interop and prevent drift from KERIpy as the behavioral authority
    for primitive semantics and class hierarchy.
- Tests:
  - Command:
    `deno test test/unit/primitives-native.test.ts test/unit/qb2.test.ts` (in
    `packages/cesr`)
  - Result: `52 passed, 0 failed`
- Contracts/plans touched:
  - none
- Risks/TODO:
  - Follow through with full-suite parser graph migration tests to fully lock
    primitive-first hydration acceptance criteria.

### 2026-03-04 - Primitive Docstring Parity with KERIpy Semantics

- Topic docs updated:
  - `docs/design-docs/learnings/PROJECT_LEARNINGS_CRYPTO_SUITE.md`
- What changed:
  - Added maintainer-oriented class/function/method docstrings in new primitive
    modules (`Signer`, `Salter`, `Cipher`, `Encrypter`, `Decrypter`, `Siger`,
    and aligned tag/label/version primitives).
  - Docstrings now carry KERIpy-substance for purpose and invariants (seed vs
    salt semantics, encryption/decryption key roles, indexed-signature verifier
    linkage, and tag/trait/version compact encodings).
- Why:
  - Keep primitive internals auditable for maintainers and reduce drift between
    TypeScript implementation intent and KERIpy behavioral authority.
- Tests:
  - Command: `deno check src/index.ts` (in `packages/cesr`)
  - Result: type check passed
- Contracts/plans touched:
  - none
- Risks/TODO:
  - Crypto operation execution remains in higher crypto-suite layers; primitive
    docs now make that boundary explicit but do not change runtime behavior.

### 2026-03-04 - Verfer/Core Primitive Doc Completion

- Topic docs updated:
  - `docs/design-docs/learnings/PROJECT_LEARNINGS_CRYPTO_SUITE.md`
- What changed:
  - Closed remaining documentation gaps for verifier/signature and key-material
    primitives (`Verfer`, `Cigar`, `Diger`, `Signer`, `Salter`, `Siger`) and
    base primitive contracts (`Matter`, `Indexer`, `Counter`) that were touched
    in the primitive-first wave.
- Why:
  - Ensure principal-engineer reviewability for all primitive classes/functions
    introduced or materially changed in this refactor.
- Tests:
  - Command: `deno check src/index.ts` (in `packages/cesr`)
  - Result: type check passed
- Contracts/plans touched:
  - none
- Risks/TODO:
  - Documentation coverage is now complete for this wave; behavioral parity
    risks remain in pending parser test migration, not in primitive docs.
