# PROJECT_LEARNINGS_CESR

## Purpose

Persistent CESR parser, primitive, and serder memory for `keri-ts`.

## Current State

1. Parser completeness has a formal `GO` decision against the current KERIpy
   baseline; no open `S0/S1` contract-surface gaps are currently tracked.
2. `docs/design-docs/cesr/CESR_PARSER_STATE_MACHINE_CONTRACT.md` is the
   normative lifecycle contract. Parser behavior changes should stay mapped to
   that contract and its tests.
3. Parser architecture remains intentionally atomic/bounded-substream first.
   Nested incremental parsing is deferred behind explicit performance evidence.
4. The frame lifecycle model is stable: `pendingFrame` means unresolved
   top-level continuation, `queuedFrames` means already-complete enclosed
   frames, and stream-order preservation when both coexist is part of the
   contract.
5. Attachment parsing is organized around one declarative dispatch spec, an
   explicit strict/compat fallback policy, structured recovery diagnostics, and
   typed attachment payloads.
6. Version and codex lookup now goes through explicit registries rather than ad
   hoc major-version branching.
7. Syntax and semantic failures are intentionally separated on high-coupling
   paths so parser errors explain whether bytes were malformed or interpretation
   failed.
8. Binary serder cold-start support exists for JSON, MGPK, and CBOR. Local Deno
   source graphs must carry CESR-owned npm/import-map entries when they load
   local CESR source.
9. Generated KERIpy-parity codex objects such as `MtrDex`, `PreDex`, `DigDex`,
   `IdrDex`, `IdxSigDex`, and `TraitDex` are the primary authority. Helper sets
   in `primitives/codex.ts` are derived readability views.
10. `Matter` and `Indexer` are low-level CESR bases. When semantics are known,
    construct the narrow primitive directly instead of returning the superclass.
11. The same codex-layer rule applies to non-cryptographic and singleton-ish
    primitives such as `Dater`, `Seqner`, `Ilker`, `Verser`, `Noncer`, and
    `Traitor`.
12. CESR-native serder behavior is organized around one shared support matrix in
    `packages/cesr/src/serder/native.ts`, keyed by protocol/version/ilk and
    field-family semantics. Extend that matrix rather than adding sidecar
    branches.
13. Top-level native KERI messages are fixed-body only. Message-shaped native
    map bodies belong to ACDC or lower-level mapping surfaces and should be
    rejected at the KERI serder boundary.
14. Native route bytes are a `Pather` problem, not a `Labeler` problem; byte
    parity depends on real path semantics.
15. ACDC verification is explicitly two-track: the visible raw body must still
    round-trip from the visible SAD, but compactable top-level ACDC SAIDs must
    also verify against the most compact variant. Section identifiers remain
    label-aware (`$id`, `d`, `agid`).
16. `Mapper`, `Compactor`, and `Aggor` are now real semantic CESR-native
    primitives. Future ACDC/native work should extend those primitives instead
    of rebuilding section semantics inside generic serder helpers.
17. Long-tail KERI serder parity includes wrapper accessors, not just scalar
    projections: helpers such as `sner`, `tholder`, `ntholder`, `bner`, and the
    typed `berfers` surface are part of the real subtype contract.
18. Deprecated intive `bt` input is still part of the compatibility surface:
    `SerderKERI.bner` must normalize lowercase-hex text, `bigint`, and old
    JSON-number inputs the way KERIpy still does.
19. Weighted thresholds are now semantic CESR primitives through `Tholder`,
    including weighted/nested normalization, `limen`/`sith` projection, exact
    threshold sizing, and `satisfy(indices)` behavior.
20. Fixed-field `structing.py` values belong to CESR through
    `packages/cesr/src/primitives/structing.ts`: the right TypeScript mental
    model is plain frozen records plus companion helpers/registries, not a mini
    class hierarchy. Those descriptors now own raw-SAD guards/hydration
    (`isSad`, `fromSad`, `toSad`), `SerderKERI` keeps raw `a`/`seals` but adds
    explicit typed seal projections, and `packages/keri` runtime dispatch now
    consumes CESR structing records directly instead of local wrapper classes.
21. `Verser` parity is slightly broader than the top-level message-protocol
    model: auxiliary four-char tags such as `OCSR` must remain accepted because
    KERIpy uses them in typed-digest seal families even though native message
    bodies still only speak `KERI|ACDC`.

## Use This Doc For

1. Parser lifecycle, recovery, and bounded-substream rules.
2. Primitive/codex parity and semantic construction guidance.
3. Serder/native/ACDC compactification behavior.

## Key Docs

1. `docs/design-docs/cesr/CESR_PARSER_STATE_MACHINE_CONTRACT.md`
2. `docs/design-docs/cesr/CESR_ATOMIC_BOUNDED_PARSER_ARCHITECTURE.md`
3. `docs/archived-plan-docs/cesr/cesr-parser/CESR_PARSER_COMPLETENESS_DECISION_2026-03-01.md`
4. `docs/archived-plan-docs/cesr/cesr-primitives/CESR_PRIMITIVES_WALKTHROUGH.md`
5. `docs/archived-plan-docs/cesr/cesr-primitives/CESR_PRIMITIVES_KERIPY_PARITY_MATRIX.md`
6. `docs/design-docs/keri/WEIGHTED_THRESHOLD_PARITY.md`

## Current Follow-Ups

1. Keep lifecycle-contract tests synchronized with recovery and fallback
   behavior.
2. Preserve the full P2 vector set as the regression floor while upper-layer
   KERI work proceeds.
3. Keep `packages/cesr/scripts/verify-tables.ts` green whenever parity work
   touches code tables or codex-family consumers.
4. Extend native and ACDC support only through the shared native matrix and the
   CESR-native semantic primitive layer.
5. Preserve maintainer-oriented docs and keep local-source Deno config handling
   aligned whenever CESR source is loaded across package boundaries.
6. Keep KERI tuple-storage aliases derived from `primitives/structing.ts` and
   do not recreate wrapper families or ad hoc raw-SAD seal parsing above that
   boundary.

## Milestone Rollup

### 2026-02-28 to 2026-03-02 - Parser Contract, Readability, And Formal Closure

- Published the canonical parser state-machine contract and aligned tests to it.
- Decomposed parser control flow into more reviewable collaborators and strategy
  seams.
- Closed the tracked P2 hardening breadth and recorded a formal completeness
  decision against the current KERIpy baseline.

### 2026-03-03 to 2026-03-16 - Primitive-First Parity, Docs, And Codex Closure

- Refreshed primitive semantics against KERIpy `main`, completed the
  per-primitive test migration, and closed key projection/serialization gaps.
- Added maintainers-first primitive walkthrough/parity docs.
- Made generated codex families the primary authority and demoted local helper
  sets to derived views, including singleton and trait-family migration.

### 2026-03-17 - Non-Native `Serder` Construction And Verification Landed

- Expanded `Serder` into a real makify/verify surface for JSON, CBOR, and MGPK
  KERI/ACDC bodies.
- Moved local KERI construction onto `SerderKERI` semantics instead of raw
  saidify helpers.

### 2026-03-17 - Native Serder And ACDC Compactification Converged

- Introduced the shared native support matrix for parser hydration, `Serdery`,
  and native inhale/exhale behavior.
- Tightened the top-level contract so native KERI message bodies are fully
  hydrated serders or parse errors, not metadata-only partial successes.
- Landed explicit ACDC compactification and section-identifier rules, and fixed
  native route-byte parity around real `Pather` semantics.

### 2026-03-27 to 2026-04-02 - Long-Tail Serder And Threshold Parity Closed

- Closed indexed-signature round-trip mid-pad behavior and deprecated intive
  `bt` normalization in `SerderKERI.bner`.
- Turned `Tholder` into the real semantic threshold primitive and widened
  serder/native handling so weighted `kt` / `nt` forms survive round-trip.

### 2026-04-04 - Fixed-Field Structing Values Moved Into CESR

- Added CESR-owned fixed-field structing records/descriptors for seal,
  blind-state, bound-state, and typed-media values, plus KERIpy-style
  clan/cast/coden registries.
- Preserved the existing counted-group wrapper ownership split:
  `Structor`/`Sealer`/`Blinder`/`Mediar` still own grouped serialization, while
  `structing.ts` now owns the named value layer inside those groups.
- Simplified that named value layer back toward KERIpy's actual shape: plain
  frozen records with companion helpers replaced the earlier
  inheritance/generic-heavy class design.
- Broadened `Verser` parity enough to accept KERIpy's auxiliary `OCSR` tag so
  typed-digest seal vectors no longer need a fake protocol workaround.
- Completed the next boundary step: the descriptors now own raw-SAD
  recognition/hydration, `SerderKERI` stays raw-SAD-first with explicit
  `sealRecords` / `eventSeals` projections, and the KERI runtime envelope uses
  CESR structing records directly while LMDB tuple aliases stay storage-only.

### 2026-04-04 - Disclosure Helpers Should Be Pure Functions Over Structing Records

- The durable KERIpy `Blinder` / `Mediar` substance is deterministic UUID
  derivation plus saidive commitment recomputation, not the wrapper classes.
- In `keri-ts`, keep that behavior as pure helpers over plain structing records:
  `makeBlindUuid`, `commitBlindState`, `makeBlindState`, `unblindBlindState`,
  `commitBoundState`, `makeBoundState`, `unblindBoundState`, and
  `commitTypeMedia` / `makeTypeMedia`.
- Commitment recomputation must use the real primitive `qb64` tuple body with a
  dummied `d` field. Using crew/SAD strings changes the bytes for empty
  noncers, `Labeler.text`, and `Texter.text`, and therefore breaks KERIpy
  parity.
- Keep raw structural checks raw. `SerderKERI` should reject non-transferable
  inception seal payloads based on the raw `a` list being non-empty, even when
  the entries are malformed and would later fail typed seal projection.
