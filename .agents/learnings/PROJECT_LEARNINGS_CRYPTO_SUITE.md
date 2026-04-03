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
