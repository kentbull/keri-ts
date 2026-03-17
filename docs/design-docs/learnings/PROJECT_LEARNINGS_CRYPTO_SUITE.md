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
