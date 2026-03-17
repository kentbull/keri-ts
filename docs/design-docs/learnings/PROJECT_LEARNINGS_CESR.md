# PROJECT_LEARNINGS_CESR

## Purpose

Persistent CESR parser memory for `keri-ts`.

## Current State

1. Parser completeness has a formal `GO` decision against the KERIpy baseline;
   no open `S0/S1` reconciliation gaps are currently tracked for the parser
   contract surface.
2. `docs/design-docs/CESR_PARSER_STATE_MACHINE_CONTRACT.md` is the normative
   lifecycle contract, and parser behavior changes should stay mapped to that
   contract and its tests.
3. Parser architecture remains intentionally atomic/bounded-substream first;
   incremental nested parsing is deferred behind explicit performance evidence.
4. The frame lifecycle model is stable: `pendingFrame` represents unresolved
   top-level continuation, `queuedFrames` represent already-complete enclosed
   frames, and stream-order preservation when both coexist is normative.
5. Attachment parsing behavior is stable around one declarative dispatch spec,
   explicit strict/compat fallback policy, structured recovery diagnostics, and
   typed `AttachmentItem` unions for payload shape.
6. Minor-version and codex-subset lookup now resolve through explicit versioned
   registries rather than ad hoc `major >= 2` branching.
7. Targeted syntax/semantic separation is in place for high-coupling parser
   paths; boundary-specific errors now distinguish syntax failures from semantic
   interpretation failures.
8. Binary Serder cold-start support for JSON, MGPK, and CBOR is present and
   depends on external npm libraries, so Deno/npm resolution details matter for
   local-source workflows.
9. Primitive-first hydration, per-primitive tests, and maintainer-oriented
   docstrings are complete enough that future CESR work should preserve
   readability and reviewability as explicit goals.
10. A dedicated CESR primitive walkthrough and KERIpy comparison matrix now
    exist for maintainers, and they intentionally explain the parser refresher
    first so `Serder` / `CesrBody` / `Structor` make sense in workflow context.
11. Current cross-implementation comparisons beyond KERIpy are advisory only;
    `keride`, `cesride`, `CESRox`, and related projects are useful references,
    but not gating authorities for parser behavior.
12. For local Deno source graphs, config ownership is graph-wide: if root or
    `packages/keri` entrypoints load local CESR source, their active config must
    also map CESR-owned imports such as `@msgpack/msgpack` and `cbor-x/*`.
13. CLI startup in `tufa` now lazy-loads handlers, so help/version paths do not
    import CESR modules until a CESR-backed command is actually selected.
14. CESR code-family validation must consume one shared KERIpy-derived source of
    truth: generated matter/indexer tables and codex-family sets now back
    `Prefixer`, `Verfer`, `Signer`, `Siger`, `Cipher`, and related primitives,
    while TS-only counter-group families live in one shared module instead of
    being recopied across primitives.

## Key Docs

1. `docs/design-docs/CESR_PARSER_STATE_MACHINE_CONTRACT.md`
2. `docs/design-docs/CESR_ATOMIC_BOUNDED_PARSER_ARCHITECTURE.md`
3. `docs/plans/cesr/cesr-parser-readability-improvement-plan.md`
4. `docs/plans/cesr/cesr-parser-readability-phased-roadmap.md`
5. `docs/plans/cesr/cesr-parser-phase0-behavior-lock-parity-matrix.md`
6. `docs/plans/cesr/cesr-parser-p2-hardening-interop-plan.md`
7. `docs/adr/adr-0001-parser-atomic-bounded-first.md`
8. `docs/design-docs/cesr-parser/CESR_PARSER_RECONCILIATION_MATRIX_2026-03-01.md`
9. `docs/design-docs/cesr-parser/CESR_PARSER_CROSS_IMPL_COMPARISON_2026-03-01.md`
10. `docs/design-docs/cesr-parser/CESR_PARSER_COMPLETENESS_DECISION_2026-03-01.md`
11. `docs/design-docs/cesr-primitives/CESR_PRIMITIVES_WALKTHROUGH.md`
12. `docs/design-docs/cesr-primitives/CESR_PRIMITIVES_KERIPY_PARITY_MATRIX.md`

## Current Follow-Ups

1. Keep lifecycle-contract tests synchronized with parser recovery and fallback
   behavior.
2. Preserve the full P2 vector set as the regression floor while upper-layer
   KERI work proceeds.
3. Keep CESR binary npm/import-map handling aligned across any config that can
   own a graph containing local CESR source.
4. Re-evaluate the local-source bridge strategy between `packages/keri` and
   `packages/cesr` if local Deno install/dev ergonomics keep leaking package
   boundary problems.
5. Keep `packages/cesr/scripts/verify-tables.ts` green whenever KERIpy parity
   work touches code tables or semantic codex-family consumers.

## Milestone Rollup

### 2026-03-14 - CESR Primitive Walkthrough And Parity Matrix Added

- Added a maintainers-first CESR primitive walkthrough organized around the
  three base classes (`Matter`, `Indexer`, `Counter`) and the parser/body
  projection layers (`Serder`, `CesrBody`, `Structor`).
- Added a companion KERIpy parity matrix so maintainers can scan one primitive
  at a time without rereading the full walkthrough.
- Cross-linked the new docs to the existing parser maintainer guide, parser
  state-machine contract, and atomic bounded parser architecture docs so the
  primitive story and parser story reinforce each other.
- Captured the main intentional TypeScript-local divergence explicitly:
  `CesrBody` is a TS public contract layered over the same Serder/body concepts
  rather than a one-to-one KERIpy class peer.

### 2026-02-28 to 2026-03-01 - Parser Contract and Readability Program Closed

- Published the canonical parser state-machine contract and aligned tests to it.
- Decomposed `CesrParser` into focused collaborators and replaced boolean policy
  branching with explicit strategy interfaces.
- Moved attachment dispatch to a single declarative spec, typed attachment
  payloads, and one structured `RecoveryDiagnostic` observer contract.
- Added targeted syntax/semantic boundary extraction, docs-first naming cleanup,
  and benchmark gating so future optimization stays behind evidence.
- Kept full CESR suite green through the readability program while preserving
  backward-compatible adapter behavior for legacy fallback hooks.

### 2026-03-01 to 2026-03-02 - Parity Breadth Closure and Formal Reconciliation

- Completed the remaining P2 hardening vectors, including medium/low breadth
  coverage, and locked them into regression suites.
- Published formal reconciliation, cross-implementation comparison, and
  completeness-decision artifacts for the parser.
- Recorded a formal `GO` decision for parser completeness relative to KERIpy.
- Added operational/CLI-adjacent follow-through for `tufa annotate --colored`
  without changing the core CESR annotate/denot determinism contract.

### 2026-03-03 to 2026-03-04 - Primitive-First Parity, Docs, and Test Migration

- Refreshed primitive semantics against KERIpy `main`, including `Tagger`,
  `Decimer`, `Verser`, `Noncer`, `Labeler`, and related codex/domain behavior.
- Completed the primitive-first test migration to per-primitive files and
  reduced older aggregate suites to smoke coverage.
- Closed surfaced serialization/projection parity gaps such as `Matter` qb2 raw
  extraction and `Dater.dts` text projection.
- Expanded structor-family and Serder-integration tests with stronger
  KERIpy-derived vectors.
- Added maintainer-oriented docstrings across the touched primitive families to
  keep the primitive-first model reviewable.

### 2026-03-13 - Deno Local-Source Integration Lessons

- Replaced the broken `cbor-x/` prefix mapping with explicit `cbor-x/decode` and
  `cbor-x/encode` entries.
- Documented the rule that Deno applies the active config to the whole graph,
  not per-subpackage `deno.json` files.
- Added maintainer guidance for local global installs to use the repo lockfile
  and explicit native npm script allowances.
- Lazy-loaded `tufa` command handlers so `--help` and `--version` no longer fail
  because CESR or LMDB modules were imported at startup.

### 2026-03-16 - Codex And Code-Table Reconciliation Closed

- Closed the false-completeness gap where raw matter tables were generated from
  KERIpy but semantic codex families were still partially hand-maintained in TS.
- Extended table generation to cover KERIpy matter codex families, mapping
  escape families, X25519 cipher codex families, and indexer/indexed-signature
  codex families plus indexer size/name tables.
- Replaced handwritten `Prefixer`/`Verfer`/`Signer`/`Siger`/`Cipher` family
  lists with shared generated codex sets, and moved TS-only counter-group
  families like aggregate/map/seal/media/blind groups into one shared module to
  stop copy drift across primitives.
- Turned `verify-tables.ts` into a real drift detector for both matter and
  indexer generated artifacts so future KERIpy code-table changes surface as a
  failing maintenance check instead of a runtime surprise.
