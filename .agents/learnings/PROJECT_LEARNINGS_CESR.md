# PROJECT_LEARNINGS_CESR

## Purpose

Persistent CESR parser memory for `keri-ts`.

## Current State

1. Parser completeness has a formal `GO` decision against the KERIpy baseline;
   no open `S0/S1` reconciliation gaps are currently tracked for the parser
   contract surface.
2. `docs/design-docs/cesr/CESR_PARSER_STATE_MACHINE_CONTRACT.md` is the normative
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
14. CESR codex design is now explicitly dual-layer: generated KERIpy-parity
    codex objects like `MtrDex`, `PreDex`, `DigDex`, and `IdrDex` are the
    primary source of truth, while primitive-friendly sets in `codex.ts` are
    derived readability helpers and TS-only counter-group families remain
    centralized in one shared module.
15. The same dual-layer rule now applies to non-cryptographic and singleton-ish
    primitives as well: `Dater`, `Seqner`, `Ilker`, `Verser`, `Noncer`, and
    `Traitor` should validate through canonical parity codexes or helpers
    derived from them, not raw code-name table lookups or local magic strings.
16. CESR-native parity is no longer "KERI fixed-body only": `Mapper`,
    `Compactor`, and `Aggor` now matter as first-class semantic primitives for
    ACDC-native map/list sections, and future native parity work should extend
    those primitives instead of rebuilding section semantics ad hoc inside
    parser or serder helpers.
17. ACDC Serder verification is explicitly two-track: the visible raw body must
    still round-trip from the visible SAD, but the top-level `d` for compactable
    ACDC ilks must be checked against the most compact variant of that SAD.
18. Native serder parity is now organized around one shared support matrix in
    `packages/cesr/src/serder/native.ts`, keyed by protocol/version/ilk and
    field-family semantics; extending native support should modify that matrix
    and its field-family helpers instead of adding new top-level `if/switch`
    branches.
19. The native matrix now covers a broader KERI lane than the original
    ICP-shaped helper, including route/query/noncer-style KERI ilks such as
    `qry` and `xip`, while still rejecting non-native-only KERI ilks at the
    matrix boundary.
20. ACDC section parity now requires section-label-aware saidive normalization:
    schema sections compute `$id`, ordinary saidive sections compute `d`, and
    aggregate sections compute/verify `agid` through `Aggor`.
21. `Matter`/`Indexer` are now explicitly low-level CESR bases, not the default
    semantic construction target: mapper/native/serder code should construct
    narrow primitives when semantics are known, and any shared hydration helper
    must stay conservative and only auto-narrow unambiguous code families.
22. `Mapper` and `Aggor` now have explicit semantic value envelopes instead of
    `unknown`: mapper values are recursive scalar/list/map trees, aggregate
    lists are `string | map` elements, and broader serder/KED layers should cast
    deliberately when crossing into those mapper-native contracts.
23. CESR codex interpretation must keep the KERIpy layering straight: `Matter`
    and `Indexer` each have one shared, non-versioned base code space plus
    semantic subset codexes such as `PreDex`, `NonceDex`, and `IdxSigDex`;
    `Counter` is the distinct genus/version-aware table family. Reused literals
    across subset codexes are semantic membership reuse, not code collisions.

## Key Docs

1. `docs/design-docs/cesr/CESR_PARSER_STATE_MACHINE_CONTRACT.md`
2. `docs/design-docs/cesr/CESR_ATOMIC_BOUNDED_PARSER_ARCHITECTURE.md`
3. `docs/archived-plan-docs/cesr/cesr-parser/cesr-parser-readability-improvement-plan.md`
4. `docs/archived-plan-docs/cesr/cesr-parser/cesr-parser-readability-phased-roadmap.md`
5. `docs/archived-plan-docs/cesr/cesr-parser/cesr-parser-phase0-behavior-lock-parity-matrix.md`
6. `docs/archived-plan-docs/cesr/cesr-parser/cesr-parser-p2-hardening-interop-plan.md`
7. `docs/adr/adr-0001-parser-atomic-bounded-first.md`
8. `docs/archived-plan-docs/cesr/cesr-parser/CESR_PARSER_RECONCILIATION_MATRIX_2026-03-01.md`
9. `docs/archived-plan-docs/cesr/cesr-parser/CESR_PARSER_CROSS_IMPL_COMPARISON_2026-03-01.md`
10. `docs/archived-plan-docs/cesr/cesr-parser/CESR_PARSER_COMPLETENESS_DECISION_2026-03-01.md`
11. `docs/archived-plan-docs/cesr/cesr-primitives/CESR_PRIMITIVES_WALKTHROUGH.md`
12. `docs/archived-plan-docs/cesr/cesr-primitives/CESR_PRIMITIVES_KERIPY_PARITY_MATRIX.md`

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

### 2026-03-16 - Canonical Codex Layer Made Primary

- Added generated KERIpy-parity codex modules for `MatterCodex`/`MtrDex`,
  `PreDex`, `DigDex`, `NonceDex`, `LabelDex`, `IndexerCodex`/`IdrDex`,
  `IdxSigDex`, `IdxCrtSigDex`, and `IdxBthSigDex`.
- Reframed `primitives/codex.ts` as a derived adapter layer that computes
  primitive-facing helper sets from those canonical codex objects instead of
  acting like the conceptual source of truth.
- Locked the maintainer rule that docs and parity work should teach KERIpy names
  first, while still allowing split helper views when they improve local
  readability.

### 2026-03-16 - Singleton And Trait Primitive Codex Migration Closed

- Extended the generated parity layer to include `TraitCodex`/`TraitDex` from
  `kering.py`, so `Traitor` no longer depends on a local trait-string list.
- Migrated singleton-ish semantic validators such as `Dater`, `Seqner`, `Ilker`,
  `Verser`, and `Noncer` away from raw `MATTER_CODE_NAMES` checks and literal
  code strings onto canonical codex exports or helpers derived from them.
- Added a shared matter-codex name lookup helper so primitives such as `Diger`,
  `Verfer`, and `Cigar` no longer read raw generated name tables directly just
  to project algorithm names.

### 2026-03-17 - Non-Native Serder Makify/Verify Surface Landed

- Expanded `packages/cesr/src/serder/serder.ts` from a parser-hydration helper
  into a schema-driven `Serder` layer with constructor support for `raw`, `sad`,
  and `makify` flows plus `verify`, `compare`, `pretty`, and copied KERIpy-style
  protocol/version defaults.
- Ported a large first slice of KERIpy field-domain behavior into TypeScript:
  KERI and ACDC field schemas now drive required-field filling, field ordering,
  alternate-field rejection, and saidive-field defaulting for JSON/CBOR/MGPK
  bodies.
- `SerderKERI` now owns KERI-specific inceptive validation such as
  non-digestive-prefix rules, non-transferable-prefix constraints, and
  delegated-inception digestive-prefix checks instead of leaving those rules in
  app-level helpers.
- Added protocol-specific projection accessors (`pre`, `keys`, `ndigs`, `backs`,
  `traits`, `issuer`, `regid`, etc.) so application code can treat the subtype
  objects more like KERIpy serders instead of raw decoded maps.
- Current limitation remains explicit: this milestone closes the non-native
  JSON/CBOR/MGPK serder path needed by local inception and DB hydration, but it
  does not yet claim full KERIpy parity for CESR-native body
  serialization/deserialization or ACDC compactification logic.

### 2026-03-17 - CESR-Native Serder Path Began Converging

- Moved digest dispatch authority into `Diger` with a shared `DigDex`-keyed
  registry, then let `Saider` and `Serder` consume that primitive-owned seam so
  digest selection is no longer hidden inside serder-local switches or
  application helpers.
- Added a first shared CESR-native serder helper path that can dump and load
  real KERI fixed-body native messages through the serder layer, including
  `reapSerder`/`Serdery` support for both qb64 and qb2 inputs by canonicalizing
  native qb2 bodies to their text-domain qb64 form before subtype hydration.
- Changed parser native-body hydration so real native message bodies are now
  upgraded into actual serder subclasses with `ked`/`said`/accessor surface
  populated, while preserving the older metadata-only fallback for generic
  native map/list hardening fixtures that are not full protocol messages.
- Added maintainer-oriented CESR-native docs in code with an explicit mental
  model for text-domain versus qb2/native-binary bodies, plus ASCII-segmented
  examples such as:

  ```text
  -FA5 | 0OKERICAACA | Xicp | EFaYE2... | DNG2ar... | MAAA | MAAB | -JAL...
  ```

  where the body counter, verser, ilk, SAID/prefix fields, numeric fields, and
  grouped list/map payloads can be visually distinguished before reasoning about
  the underlying binary qb2 form.
- Added a dedicated native-serder test-helper layer so the pinned KERIpy native
  fixture can be read as named segments (`bodyCounter`, `verser`, `ilk`, `said`,
  `pre`, `sn`, `kt`, list groups, etc.) inside tests; maintainers should
  preserve that "tests as worked examples" style instead of regressing native
  coverage back into opaque whole-string assertions only.
- This is still only a first native parity slice, not closure: KERI fixed-body
  messages are now substantially better covered, but broader CESR-native KERI
  ilks, full ACDC native semantics, and ACDC compactification remain open.

### 2026-03-17 - Top-Level Native Message Contract Tightened To Match KERIpy

### 2026-03-17 - Narrow Primitive Construction Rule Landed

- Replaced semantic-erasing `new Matter(...)` / `new Indexer(...)` uses in the
  active mapper/native/serder/aggor and KERI app paths with the corresponding
  narrow primitives (`Bexter`, `Texter`, `Diger`, `Siger`, `Cigar`,
  `NumberPrimitive`, `Salter`, `Signer`, `Verfer`, `Prefixer`) when the code
  already knew the semantic family.
- Added a shared `hydrate.ts` seam for generic callers, but made it
  intentionally conservative after auditing KERIpy's codex layering: many
  semantic subset codexes reuse literals from the shared base `Matter` or
  `Indexer` code spaces, so automatic narrowing is only honest for unambiguous
  families such as `Dater`, `Decimer`, `Cigar`, and `Siger`.
- Added regression coverage for the hydrator contract itself plus app-level
  proof that `Manager.incept()` and `Manager.sign()` now return narrow
  primitives instead of qb64-only `Matter`/`Indexer` projections.

### 2026-03-17 - Codex Layering Model Corrected To Match KERIpy

- Tightened maintainer docs to state the real KERIpy model explicitly:
  `MatterCodex`/`MtrDex` and `IndexerCodex`/`IdrDex` are shared base code
  spaces, and semantic codexes like `PreDex`, `NonceDex`, `NumDex`, and
  `IdxSigDex` are subset views over those same spaces.
- Corrected the earlier sloppy "code overlap" phrasing. The important failure
  mode is not protocol/genus-version collision, but confusing semantic subset
  membership reuse with versioned table selection.
- Reinforced that `Counter` is the genus/version-aware exception, so code-table
  version reasoning belongs there, not in Matter/Indexer subset validation.

### 2026-03-17 - Mapper And Aggor Value Types Were Tightened To KERIpy Shape

- Replaced the `unknown` return/value model in the recursive mapper and
  aggregate-list deserializers with explicit TypeScript unions matching KERIpy's
  actual semantic envelope.
- `Mapper` now models recursive native-map values as scalar/list/map trees, and
  `Aggor` now models aggregate element lists as `string | map` elements instead
  of arbitrary values.
- The broader serder/native layers intentionally remain more general than the
  mapper core, so those seams now use explicit casts instead of silently
  widening the mapper-native contract back to `unknown`.

### 2026-03-17 - ACDC Native And Compactification Lane Landed

- Promoted `Mapper` from a syntax-only parse artifact into a semantic native map
  primitive with real `mad`/`raw`/`qb64`/`qb2` behavior, while keeping the older
  syntax/projection helpers as compatibility wrappers for parser-oriented tests.
- Promoted `Compactor` and `Aggor` from parse wrappers into maintainer-readable
  semantic primitives: `Compactor` now exposes `trace()`, `compact()`,
  `expand()`, `leaves`, and `partials`, while `Aggor` now exposes `ael`, `agid`,
  `disclose()`, and `verifyDisclosure()`.

### 2026-03-17 - Native Support Matrix And Deeper Section Parity Landed

- Replaced the split native-body logic in `packages/cesr/src/serder/native.ts`
  with one protocol/version/ilk support matrix that now drives both native
  inhale and exhale.
- Extended the KERI native lane beyond the earlier ICP-only shape so route/map
  and nonce-bearing ilks such as `qry` and `xip` now round-trip through the
  serder layer.
- Corrected ACDC native field-family semantics that were still drifting from
  KERIpy, including numeric `n` fields and the difference between qualified
  nonce tokens and empty-or-value nonce semantics.
- Deepened `SerderACDC` compactification so schema sections compute `$id`,
  section messages keep expanded visible sections while still verifying their
  embedded identifiers, and compactable top-level ACDCs still hash over the most
  compact section form.
- Added matrix-focused native tests plus accessor/partial-section tests so the
  new parity surface is documented by readable examples instead of only by the
  implementation.
- Added ACDC CESR-native top-level body-shape rules and section-field handling
  in the shared native serder layer: map-body `acm`/`ace`/`<none>` and
  fixed-body `act`/`acg`/`sch`/`att`/`agg`/ `edg`/`rul`/`rip`/`bup`/`upd` now
  decode/encode through field-family helpers instead of generic fallback
  parsing.
- Added the first real ACDC compactification-aware `SerderACDC` makify/verify
  behavior: expanded ACDC bodies can now preserve expanded section maps while
  still computing/verifying top-level `d` from the most compact variant, and
  `compactify=true` can persist compact section references in the visible SAD.
- Locked the maintainer rule that CESR-native tests should stay pedagogical: new
  coverage now includes example-driven `Compactor`/`Aggor` lifecycle tests,
  ACDC-native fixed/map round trips, and explicit expanded-vs-compact ACDC
  serder tests instead of relying only on opaque fixture comparisons.

- Removed the parser's metadata-only success fallback for top-level native
  `FixBodyGroup` / `MapBodyGroup` frames. Once the frame parser classifies a
  native body group as a message body, the next step must be successful `Serder`
  hydration or a parse error.
- This matters because the previous fallback blurred two different layers:
  top-level protocol messages versus lower-level CESR-native map/list corpora.
  KERIpy keeps that boundary sharp by sending top-level native body groups
  through `Serdery.reap(...)` and failing if the payload is not a valid protocol
  message.
- The maintainer mental model should now be:
  1. `Mapper` / `Aggor` / `Compactor` are the right tools for arbitrary native
     map/list structures.
  2. `FrameParser.parseNativeBodyGroup()` is only for native bodies that are
     being treated as top-level messages.
  3. Therefore top-level success means a real `Serder`, not a best-effort
     metadata shell.
- Hardening vectors that used to rely on parser acceptance of invalid top-level
  native `MapBodyGroup` corpora were rewritten to assert deterministic parse
  failure instead, preserving the chunk-boundary contract without preserving the
  wrong success semantics.

### 2026-03-17 - Shared Native Serder Layer Now Rejects KERI Map-Body Messages

- Tightened `parseCesrNativeKed()` so KERI top-level CESR-native messages must
  be `FixBodyGroup` bodies. This closes the deeper permissiveness bug where the
  parser seam had been fixed but direct native reaping could still have accepted
  a message-shaped KERI `MapBodyGroup`.
- Added readable regression coverage using a constructed "looks valid at a
  glance" native KERI map-body fixture: it includes a `v` label plus the normal
  `t`/`d`/`i`/`s`/`kt`/`k`/... labels, but both `parseCesrNativeKed()` and
  `reapSerder()` must now reject it because KERI native top-level messages are
  fixed-field only.
- The maintainer lesson is important: "map-body native top level exists" is not
  enough to justify KERI acceptance. Top-level native map-body semantics belong
  to ACDC and lower-level mapping helpers unless KERIpy proves otherwise.

### 2026-03-17 - Native Route Byte Parity Requires Real `Pather` Semantics

- The old native route workaround in `native.ts` was wrong in an important way:
  encoding `r` / `rr` / `rp` as generic labels can preserve enough semantics to
  make some tests pass, but it does not produce KERIpy-faithful CESR-native
  bytes.
- The concrete proof case is KERI native `qry`: semantic `r: "ksn"` must
  serialize as `4AABAksn`, not a label token like `Xksn`. Likewise `rr: "reply"`
  must become `6AACAAAreply`, and slash routes such as `credential/issue` must
  compact to `4AAEcredential-issue` while still decoding back to
  `credential/issue`.
- The fix belongs in the primitive layer, not in serder-local branching.
  `Pather` now has a semantic constructor helper that mirrors KERIpy's
  `relative=True, pathive=False` route contract, including: code-family
  selection (`4A` / `5A` / `6A` and bytes variants), escape-prefix handling for
  ambiguous leading `A`, and slash-vs-hyphen semantic projection.
- Native decode must mirror the same rule on the inhale side: route-family
  fields must parse through `Pather`, not `Labeler`, or compact slash routes
  will silently flatten into `credential-issue`.
- Native `Serder` construction/verification also needed one more parity fix:
  CESR-native bodies are not self-smelling, so `kind=CESR` construct/verify
  paths must carry known `proto` / `pvrsn` / `gvrsn` smellage explicitly instead
  of re-running non-native `smell()` on native raw bytes.
- Added pinned KERIpy-generated native v2 fixtures for route-heavy KERI ilks
  `qry`, `rpy`, `xip`, and `exn`, plus primitive-level `Pather` tests, so the
  route lane is now protected by exact byte-parity assertions instead of only
  semantic round-trip checks.

### 2026-03-17 - Maintainer Doc Sweep Extended Beyond Class Boundaries

- Completed a broad maintainer-doc pass across CESR exported helper/type seams
  in annotate, adapters, parser, serder, core, and table modules.
- Added short maintainer comments to dense helper ladders in `render.ts`,
  `serder.ts`, `matter.ts`, `indexer.ts`, and `counter.ts` so parser/native flow
  and primitive inhale/exhale responsibilities are reviewable without
  re-deriving them from control flow.
- Captured the preferred doc pattern for codex/table families explicitly:
  grouped block comments are correct for obviously derived semantic-set exports,
  while public interfaces/functions should still carry direct boundary docs.
- Fixture provenance is now clearer too: the cross-implementation/native
  external vectors used by hardening and parity suites carry explicit
  maintainer-facing origin/intent comments.

### 2026-03-27 - Indexed Signature Roundtrip Needed Mid-Pad Parity

- Topic docs updated:
  - `packages/cesr/src/primitives/indexer.ts`
  - `packages/cesr/test/unit/primitives/indexer.test.ts`
  - `packages/cesr/test/unit/primitives/siger.test.ts`
- What changed:
  - Fixed `Indexer` text/binary inhale so it mirrors `Matter`'s mid-pad rules:
    when reconstructing raw bytes from `qb64`, the parser must restore the
    text-domain pad sextets before base64 decode and then strip `ps + ls`, not
    just `ls`.
  - Added explicit roundtrip regression coverage proving `Indexer` and `Siger`
    preserve `raw` bytes across `qb64` reconstruction, not merely `qb64`
    string equality.
- Why:
  - Gate E runtime work exposed the lie in the old tests: parsed indexed
    signatures could look correct as `qb64` strings while carrying different raw
    signature bytes, which silently breaks Ed25519 verification after CESR
    parse/replay.
  - The real maintainer lesson is brutal and simple: for signature material,
    `qb64` equality is not enough. Raw-byte roundtrip is the actual contract.
- Tests:
  - Command: `deno test --config packages/cesr/deno.json packages/cesr/test/unit/primitives/indexer.test.ts packages/cesr/test/unit/primitives/siger.test.ts`
  - Result: passed locally
- Risks/TODO:
  - Any higher-layer code that previously relied on parsed `Indexer.raw` being
    trustworthy without explicit roundtrip tests should now be treated with more
    suspicion until the surrounding path has real verification coverage.
