# PROJECT_LEARNINGS_KELS

## Purpose

Persistent learnings for KEL processing, event-state transitions, and
replay/verification semantics.

## Current Status

1. No dedicated KEL state-machine implementation milestone has landed yet; the
   active work is still the foundation layer around DB parity and practical
   `kli`/`tufa` interoperability planning.
2. Phase 2 planning is now parity-first: P0 command/output parity and D0
   inventory/parity artifacts are established, D1 DB-core parity is largely in
   place, and the active edge has moved into a D2/D3 runtime foundation that is
   strong enough for live Gate B and Gate C visibility evidence.
3. `docs/design-docs/db/db-architecture.md` is the current cross-topic DB
   invariants reference for ordering, idempotence, serialization, lifecycle, and
   interoperability semantics that later KEL logic will rely on.
4. Interop planning has expanded from init/incept-only work into a usable
   bootstrap arc covering list/aid visibility, service endpoints, OOBIs,
   direct+mailbox communication, and challenge flows.
5. DB parity scaffolding now includes the DB parity matrix, K/V inventory/work
   lists, and an interop harness tied to Gate A-G command parity tracking.
6. `LMDBer` D1 progress now covers core branch counting/deletion plus the `On*`,
   `IoSet*`, `dup*`, and `IoDup*` families needed by downstream
   Suber/Komer/Baser work.
7. Targeted DB-core parity/oracle suites were green at the latest recorded
   checkpoint, and representation coverage for the current `LMDBer` surface was
   explicitly audited.
8. `LMDBer.cntTop` and `LMDBer.cntAll` remain flagged for later keep-vs-remove
   review once the real `init/incept/rotate` call graph stabilizes.
9. `Habery` now eagerly reloads persisted habitat records on open, which
   unblocks honest `list`/`aid` visibility without depending on process-local
   caches.
10. The current bootstrap path no longer stores everything through ad hoc raw
    LMDB handles: typed `Suber` / `Komer` wrappers now back the active `Baser` /
    `Keeper` local runtime path, not just a narrow Gate C visibility shim.
11. KERIpy parity work should include source documentation parity for class
    boundaries: maintainer-facing docstrings are part of the port, not optional
    follow-up polish.
12. `Komer` serializer parity is now broader than the live-store rollout:
    JSON/CBOR/MGPK are supported at the mapper boundary, while existing
    `Baser`/`Keeper` stores intentionally remain JSON until an explicit
    migration/compat decision is made.
13. Until 1.0 parity is reached, old-`keri-ts` compatibility is not a project
    goal by default; if a choice exists between preserving prior `keri-ts`
    behavior and matching KERIpy, we should choose KERIpy unless the task says
    otherwise.
14. Interop tests should now assume a working installed KERIpy CLI and fail if
    it cannot be resolved; skipping was useful during bootstrap, but it now
    hides real parity regressions.
15. `Komer` is no longer intentionally flattened in `keri-ts`: the KERIpy-style
    `KomerBase -> Komer` split is now part of the parity path, and future mapper
    subclasses should build on that seam instead of reintroducing raw-LMDB
    shortcuts.
16. Generic type parameters on `Komer`, `Suber`, and the CESR-backed LMDB
    wrappers are part of the parity contract, not optional TypeScript garnish:
    the storage wrapper type must describe the narrowest real persisted value
    shape from KERIpy usage, and if a store holds a compound CESR tuple then the
    TypeScript type should be an explicit tuple alias of those primitive
    subclasses instead of `Matter`, `Matter[]`, or another widened fallback.
17. Local habitat key state should now be treated as DB-backed state, not
    in-memory-only `Hab.kever` state: `states.` is the source of truth,
    `kels.`/`fels.`/`dtss.` support event ordering and reopen, and `Habery.habs`
    remains only an in-memory cache of reconstructed `Hab` objects.
18. DB parity work is not maintainer-complete until the new storage families,
    record contracts, and runtime seams are documented in source with KERIpy
    correspondence and `keri-ts` differences called out explicitly.
19. For `Baser` and `Keeper`, the canonical named-subdb meaning now lives on the
    `reopen()` bindings where property name, subkey, wrapper type, and
    tuple/value wiring appear together; declaration comments are the shorter
    public-surface mirror.
20. Local key-management surfaces should return CESR primitives, not qb64-only
    wrapper records: `Manager.incept()` should expose `Verfer[]`/`Diger[]`,
    signing should expose `Siger[]`/`Cigar[]`, and DB helpers should accept the
    narrow primitive types directly instead of rehydrating every signature from
    strings at the last minute.
21. DB-layer parity now includes the later KERIpy normalized ordinal-wrapper API
    shape: `Komer`/`Suber`/`OnSuber*`/`OnIoDup*`/`OnIoSet*` should expose the
    newer `getTop*` / `getAll*` / non-`On` method families as the forward parity
    surface, while legacy `getOn*` and plain `Suber.getItemIter()` remain
    temporary compatibility aliases until higher layers migrate.
22. The parser-to-runtime dispatch seam is now a first-class KEL architecture
    surface: `KeriDispatchEnvelope` and its family element classes live in
    `core/dispatch.ts`, not in `Reactor`, and maintainers should preserve the
    KERIpy family names (`trqs`, `tsgs`, `ssgs`, `frcs`, `sscs`, `ssts`, etc.)
    while expressing each family element as a named value object instead of an
    anonymous object literal.
23. Runtime dispatch value objects should hold real CESR primitives plus derived
    getters. For ordinal-bearing families this currently means a shared
    `DispatchOrdinal = Seqner | NumberPrimitive` union, because the `keri-ts`
    parser normalization seam presently yields compact number-coded ordinals for
    these attachment groups; forcing everything into `Seqner` is a model error,
    not extra parity.
24. Cue handling is now a first-class KEL/runtime porting seam. The shared root
    cue deck remains on `AgentRuntime`, but cue semantics are habitat-owned via
    `Hab.processCuesIter()`, runtime delivery happens through
    `processCuesOnce()` / `cueDo()`, and hosts consume structured
    `CueEmission`s instead of byte-only yields.
25. KERIpy cue behavior is the semantic contract, not the Python structure:
    `receipt`, `witness`, `query`, `reply`, `replay`, `notice`,
    `noticeBadCloneFN`, `keyStateSaved`, `invalid`, `psUnescrow`,
    `remoteMemberedSig`, `stream`, and OOBI result cues should be modeled
    explicitly even when the current `keri-ts` producer/consumer breadth is
    still incomplete.
26. Local `LocationScheme` work is part of honest Gate E runtime parity. `loc`
    state should be created through signed `/loc/scheme` replies parsed back
    through `Revery`, not by direct writes to `locs.` / `lans.`, because OOBI
    generation and OOBI serving both depend on accepted location state.
27. KEL control flow is now intentionally TypeScript-native: normal processing
    outcomes should be modeled as typed decisions (`accept`, `duplicate`,
    `escrow`, `reject`) rather than exception-driven branches. Preserve the
    split where `Kever` decides state-machine validity and `Kevery` owns
    routing, escrow persistence, duplicate handling, and post-acceptance side
    effects. This rule should also guide future `Tever`/`Tevery` and similar
    processor ports; see `docs/adr/adr-0005-kel-decision-control-flow.md`.

## Scope Checklist

Use this doc for:

1. event validation and ordering rules,
2. replay behavior and state derivation,
3. key state transition constraints,
4. compatibility nuances with KERIpy KEL behavior.

## Cross-Topic Design References

1. `docs/design-docs/db/db-architecture.md`
2. `docs/adr/adr-0005-kel-decision-control-flow.md`

## Current Follow-Ups

1. Keep KEL-state work parity-first on top of DB invariants rather than adding
   abstraction before behavior closure.
2. Treat Gates B, C, and D as closed enough to move main attention to Gate E
   command surfaces plus the escrow/process-loop work that Gate F/G depend on.
3. Keep DB parity artifacts concise and execution-oriented; they should remain
   usable worklists, not archival dumps.
4. Treat missing class docstrings on newly ported KERIpy surfaces as a real
   maintenance regression and guard against them automatically.

### 2026-03-27 - `PathManager` ADR Locked The `Filer` Comparison Boundary

- Topic docs updated:
  - `.agents/learnings/PROJECT_LEARNINGS_KELS.md`
  - `.agents/PROJECT_LEARNINGS.md`
- What changed:
  - Added `docs/adr/adr-0002-path-manager-filer-seam.md` to document
    `PathManager` as the `keri-ts` equivalent of HIO `Filer`'s path-policy
    responsibilities.
  - Captured the maintainer rule that shared path derivation/fallback belongs in
    `PathManager`, while LMDB env ownership and config-file durability semantics
    stay with `LMDBer` and `Configer`.
- Why:
  - Future parity work could otherwise cargo-cult Python `Filer` inheritance and
    accidentally blur the boundary between path policy and resource lifecycle
    ownership.
- Tests:
  - Command: N/A (documentation-only ADR)
  - Result: N/A
- Contracts/plans touched:
  - `docs/adr/adr-0002-path-manager-filer-seam.md`
- Risks/TODO:
  - If a future caller truly needs shared file-handle semantics, treat that as a
    separate design decision instead of silently extending `PathManager` as if
    it were already full `Filer` parity.

### 2026-03-18 - DB Wrapper Surface Normalized For Later KERIpy Parity

- Added the later KERIpy DB-surface normalization from `subing.py` into
  `keri-ts` without breaking current local call sites: the forward parity API is
  now the non-legacy `getTop*` / `getAll*` / non-`On` method family, while the
  older `getOn*` and plain `Suber.getItemIter()` names remain compatibility
  wrappers.
- `Komer` now exposes `cntAll()` as the same additive counting alias KERIpy
  expects, which lets future mapper call sites use the mixed wrapper-counting
  vocabulary without reopening the storage review.
- `OnSuberBase`, `OnIoDupSuber`, and `OnIoSetSuber` now expose the newer
  KERIpy-style normalized methods directly, including branch scans,
  exact-ordinal accessors, all-ordinal iterators, last-item views, backward
  scans, and count aliases, while retaining the pre-normalization `*On*` surface
  as wrappers.
- `LMDBer` now includes `getOnTopIoDupItemIter()`, which closes the remaining
  DB-core helper gap needed by the normalized `OnIoDupSuber.getTopItemIter()`
  surface.
- Added targeted unit coverage for the normalized ordinal-wrapper methods and
  the retained legacy aliases so future parity work can prefer the new names
  without rediscovering which old calls are still intentionally supported.
- Follow-up call-site migration in `Baser` proved the important boundary:
  `fels.` now uses the normalized `getAllItemIter()` surface just like current
  upstream KERIpy, but `kels.` intentionally still uses `addOn()` /
  `getOnLast()` / `getOnLastItemIter()` because upstream has not actually
  normalized that path yet. The parity rule is to follow the real upstream call
  graph, not to blanket-rename every ordinal-wrapper access just because newer
  aliases exist elsewhere.

### 2026-03-18 - DB Method Documentation Became Family-Level Contract Coverage

- The DB documentation rule is no longer satisfied by class docstrings alone.
  `LMDBer`, `Baser`, `Komer`, `Suber`, and the ordinal/dup/io-set wrapper
  families now need maintainer-grade method docs on the public storage
  operations and on the important adapter seams that reinterpret raw LMDB bytes.
- The useful unit of documentation is the storage family, not the file. Method
  docs should explain the storage model (`On*`, `IoSet*`, `Dup*`, `IoDup*`),
  what hidden suffixes/proems are being stripped or preserved, and whether a
  method is the normalized forward API or a retained compatibility alias.
- Helper conversion seams such as Base64 tuple serializers, CESR tuple
  splitters, and root lifecycle getters matter enough to document because
  maintainers otherwise end up re-deriving byte-level invariants from
  implementation code.

### 2026-03-17 - Gate D Encrypted Keeper Semantics Landed

- Added a KERI-local `libsodium-wrappers@0.8.2` JS+WASM backend for sealed-box
  behavior instead of hand-rolling the missing pieces around `@noble`.
- `Manager` now performs real AEID-backed salt and signer encryption, keeper
  reopen decryption, and `updateAeid()` re-encryption for root salt, per-prefix
  salts, and `pris.` signer seeds.
- `CryptSignerSuber` is no longer a placeholder seam; it now stores ciphertext
  at rest and decrypts signer seeds on read when given a decrypter.
- Encrypted signator reopen is now covered directly, so Gate D is not just
  "encrypted init works once" but "encrypted reopen still signs correctly."
- Wrong-passcode behavior is now explicitly tested and treated as a first-class
  parity condition rather than an accidental failure mode.

### 2026-03-15 - Gate C Visibility Foundation Landed

- Added the first minimal `subing.ts` / `koming.ts` foundation instead of
  continuing the raw-LMDB shortcut path.
- Migrated the active bootstrap-path `Baser` and `Keeper` stores onto those
  typed wrappers where KERIpy already expects `Suber` / `Komer` usage.
- Added explicit compatibility-mode `.keri/db` and `.keri/ks` open paths plus
  KERIpy-aligned `names.` separator handling (`^`).
- Readonly visibility commands now skip config loading and signator creation,
  and readonly compat opens no longer try to write `aeid`.
- Added focused unit coverage for the new typed-store seam and for readonly
  compatibility-mode `list` / `aid` store opening.
- This is still not full Gate C or Gate D closure: encrypted `pris` semantics,
  true decrypter/encrypter behavior, signator reliability, config processing,
  OOBI resolution, and KEL routing remain open.

## Milestone Rollup

### 2026-03-16 - `Baser` And `Keeper` Sub-DB Documentation Was Fully Mirrored

- Added comments for every currently bound LMDB sub-database in `Baser` and
  `Keeper` at both the field declaration and `reopen()` binding sites.
- Mirrored KERIpy meaning-first instead of verbatim so the TypeScript source
  keeps the original store intent while staying readable for maintainers.
- Treated `reopen()` as the canonical seam for store meaning, which let the
  comments call out property-to-subkey mismatches such as `misfits -> mfes.`,
  `delegables -> dees.`, `tops -> witm.`, and `gpwe -> gdwe.` without forcing
  readers to infer them from the constructor wiring.

### 2026-03-16 - Class Documentation Parity Became A Guarded Requirement

- Completed a maintainer-grade class-doc sweep across the remaining undocumented
  `keri-ts` KERI and CESR class surfaces, starting with `Manager` and the
  recently changed DB/app wrappers.
- Tightened the source-documentation rule: when porting a KERIpy-corresponding
  class, we should port its maintainer-facing documentation in the same change
  and explicitly call out `keri-ts` divergences.
- Added an automated class-doc coverage check so undocumented class boundaries
  stop being silent drift.

### 2026-03-16 - `Komer` Gained CBOR And MGPK Serializer Support

- Expanded `Komer` to support `JSON`, `CBOR`, and `MGPK` serializer selection at
  construction time, following the same high-level format contract as KERIpy's
  `Komer`.
- Kept the change capability-only: current `Baser` and `Keeper` call sites still
  use the JSON default, so no store migration or dual-read compatibility logic
  was introduced.
- Added a format-matrix unit suite plus an explicit invalid-kind guard so the
  new serializer boundary is both parity-oriented and fail-fast.

### 2026-03-16 - Prior `keri-ts` Compatibility Explicitly De-Prioritized

- Removed the temporary `Baser.getName()` fallback that tolerated older pre-`^`
  `keri-ts` `names.` keys.
- Recorded the project rule explicitly: before 1.0, we optimize for KERIpy
  parity first and should not add back-compat shims for historical `keri-ts`
  behavior unless they are required for KERIpy interop.

### 2026-03-16 - KLI Interop Became A Real Quality Gate

- Promoted the live KLI interop suites from opportunistic-skip behavior to
  regular quality coverage by resolving the real KLI executable up front and
  failing if it cannot be used.
- Preserved the active `DENO_DIR` when tests override `HOME`, so `tufa` can run
  under isolated test homes without trying to re-fetch npm/JSR dependencies.
- Made the CI side explicit too: the PR stage-gate and `keri-ts` release
  workflows now install KERIpy from
  `WebOfTrust/keripy@273784cb1702348c3888a09806cc37aea1877704` before test steps
  so interop evidence is pinned and reproducible instead of depending on
  whatever `kli` happens to be preinstalled on the runner.
- Verified both `interop-gates-harness.test.ts` and `interop-kli-tufa.test.ts`
  run successfully against the installed KERIpy CLI; if the pinned commit
  changes its Python floor or install behavior, CI setup must move in lockstep.

### 2026-03-16 - `KomerBase` And `Komer` Hierarchy Ported

- Refactored `koming.ts` so `keri-ts` now has the same `KomerBase -> Komer`
  split that KERIpy uses for single-record object mappers.
- Ported the KERIpy-style base methods and boundaries, including `_tokey`,
  `_tokeys`, `_serializer`, `_deserializer`, `trim`, `remTop`, `getTopItemIter`,
  and `getFullItemIter`, while expressing dataclass-like validation/mapping
  through explicit TypeScript schema hooks.
- Expanded the `Komer` unit suite to mirror the current KERIpy single-value
  tests for CRUD, branch iteration, trim, schema validation failures, custom
  serialization, and serializer/deserializer behavior.

### 2026-03-16 - LMDB Wrapper Generics Became A Storage-Contract Rule

- Recorded an explicit parity rule for `Komer`, `Suber`, and CESR-backed LMDB
  wrappers: the generic type argument must model the real persisted KERIpy value
  shape, not a convenience supertype.
- Corrected the recent `pres.` regression by fixing the local `Prefixer`
  primitive to accept the full KERIpy `PreDex` family and then restoring
  `Keeper.pres` to `CesrSuber<Prefixer>` instead of widening it to `Matter`.
- Captured the rule for mixed CESR tuple stores as well: when a KERIpy store
  returns a typed couple, triple, or larger tuple, `keri-ts` should use an
  explicit tuple type alias of the participating primitive subclasses rather
  than `Matter[]` or another erased representation.
- Maintainer heuristic: if a proposed generic widening makes the code easier but
  makes the DB contract less specific, it is usually the primitive/model layer
  that needs correction, not the storage wrapper.

### 2026-03-16 - Local Habitat State Moved Onto The DB Backbone

- `Baser` now binds the current KERIpy `Baser` and `Keeper` named-subdb surface
  needed for the local runtime arc, including `fels.`, `kels.`, `states.`,
  `dtss.`, `smids.`, `rmids.`, and the wider reply/OOBI/exchange/contact
  families.
- `Hab.make()` now persists local inception state through the DB backbone: event
  raw into `evts.`, sequence and first-seen indices into `kels.` and `fels.`,
  datetime into `dtss.`, signatures into `sigs.`, and current key state into
  `states.`.
- Habitat reopen now rebuilds current local state from `states.` instead of
  treating `Hab.kever` as the authoritative writable state holder.
- `Habery.habs` intentionally stayed cache-only, matching the KERIpy mental
  model: the cache holds reconstructed `Hab` objects, while the DB holds the
  durable identifier state.
- `tufa incept` and `tufa export` now read current local identifier state from
  the DB-backed path instead of depending on transient in-memory state and the
  old `${pre}:0` event shortcut.

### 2026-03-17 - Manager/Hab Signing Surface Became Primitive-First

- Removed the bootstrap-era qb64 wrapper compromise from
  `packages/keri/src/app/keeping.ts`: salty derivation now returns `Signer` +
  `Verfer`, inception returns `Verfer[]` + `Diger[]`, and signing returns
  `Siger[]` or `Cigar[]`.
- Updated the surrounding habitat/database path so `Hab` and `Signator` consume
  the narrow signature primitives directly and `Baser.pinSigs()` / `putSigs()`
  accept already-hydrated `Siger` values.
- Tightened the CESR-backed DB wrapper constructors so new stores must pass an
  explicit `klas` instead of silently defaulting to `Matter`, which closes one
  of the easier ways for semantic type erasure to creep back in.

### 2026-03-17 - Gate C Visibility Moved From Tentative To Live Interop Evidence

- Re-ran `packages/keri/test/integration/app/interop-gates-harness.test.ts` and
  confirmed the `C-KLI-COMPAT-STORE-OPEN` scenario passes live against a
  KLI-created encrypted store using `tufa list --compat` / `tufa aid --compat`.
- Promoted the repo memory accordingly: Gate C visibility should no longer be
  described as merely "harness-ready" or "tufa-side only".
- Verdict: the visibility-only compat-store plumbing is no longer the
  bottleneck; the real blocker is Gate D encrypted secret semantics and reopen
  reliability.

### 2026-03-17 - Inception Construction Moved Onto Shared `SerderKERI` Semantics

- `Hab.make()` now constructs inception events through `SerderKERI` instead of
  local string assembly plus ad hoc saidification helpers.
- Added focused unit evidence for two parity-sensitive cases: non-transferable
  prefixes that must equal the signing key, and digestive prefix-code overrides
  that must not collapse back to the signing key path.
- Verdict: init/incept parity should now evolve through shared serder logic, not
  through more bootstrap-local event-construction helpers.

### 2026-03-16 - Exact `cbor2` Byte Parity Became A Shared Codec Rule

- Confirmed the root cause of the earlier CBOR mismatch: `cbor-x` defaults plain
  object encoding to fixed-width `map16` headers for preallocation, while KERIpy
  `cbor2.dumps()` uses preferred-size map headers.
- Added one shared CESR-side CBOR codec and moved current KERI/CESR CBOR paths
  onto it so byte-level policy is centralized instead of re-decided in each
  subsystem.
- The canonical KERI encoder configuration is now `useRecords: false`,
  `variableMapSize: true`, and `useTag259ForMaps: false`, which matched the
  tested `cbor2` vectors exactly.
- Added parity tests plus a guard against direct `cbor-x` imports in KERI/CESR
  source so we stop regressing to valid-but-non-identical CBOR encodings.

### 2026-03-15 - `tufa init` Home Fallback Restored For npm/Node Runtime

- Traced a local `tufa init` failure to `PathManager.mkdirOp`, not to the
  fallback policy itself.
- Under the npm-built CLI, `@deno/shim-deno` surfaced `/usr/local/var` mkdir
  permission failures as plain `Error` objects carrying Node-style
  `code: "EACCES"` / `code: "EPERM"` instead of satisfying
  `instanceof Deno.errors.PermissionDenied`.
- Because `PathManager` only recognized the Deno-class error shape, the primary
  mkdir rejection escaped before `_createOrFallback()` could switch to
  `~/.tufa/...`.
- Fix: normalize permission/not-found detection in `path-manager.ts` so Node
  error codes are treated the same as native Deno error classes, and add a
  regression test that forces a primary-path `EACCES` and verifies fallback to
  `~/.tufa/db/...`.
- A second npm/Node compatibility gap surfaced immediately after that fix:
  `Configer.writeAtomic()` used `FsFile.syncSync()`, but `@deno/shim-deno`
  leaves that method unimplemented.
- Fix: switch config durability paths to `syncDataSync()`, which is available
  through the shim and remains within the typed `FsFile` surface used by Deno.

### 2026-03-14 - Gate B Visibility Slice Landed

- `Habery` now eagerly reloads persisted habitat records on open instead of
  relying only on process-local `makeHab` caching.
- Added `tufa list` and `tufa aid` command surfaces for local-store identifier
  visibility, matching the current Gate B bootstrap need.
- Promoted the Gate B list/aid interop harness scenario from pending to ready,
  with focused tests covering empty-list, post-incept visibility, and alias to
  prefix lookup.
- This is a bootstrap visibility slice, not evidence that `init`/`incept`
  reached full KERIpy parity; config processing, OOBI/KEL routing, AEID
  semantics, and broader reopen behavior remain open follow-on work.

### 2026-03-14 - LMDBer Tests Refactored By Storage Family

- Replaced the old broad `lmdber-core-parity.test.ts` coverage style with
  readable family-based unit files for lifecycle, plain K/V, `On*`, `IoSet*`,
  and duplicate families.
- Kept a trimmed parity/oracle file only for reverse mixed-key iterator vectors
  that are easy to regress and harder to reason about from implementation alone.
- Removed the old representation-sweep approach as the primary coverage model;
  the new baseline is focused behavioral tests that explain storage semantics in
  maintainer-readable terms.
- The refactor surfaced one lifecycle nuance worth remembering in future tests:
  named LMDB sub-database handles are reopen-scoped and should be reacquired
  after `LMDBer.close()` / `LMDBer.reopen()`.

### 2026-03-14 - LMDBer Maintainer Taxonomy Added

- Added a maintainer-oriented `LMDBer` family taxonomy to the DB architecture
  contract so the DB layer can be reasoned about by storage model instead of as
  a flat method list.
- Captured the key distinctions between `Dup*`, `IoDup*`, `IoSet*`, `On*`,
  `OnIoSet*`, and `OnIoDup*`, including where multiplicity and ordering actually
  live.
- Added a design-rationale section explaining why the two-dimensional
  `OnIoSet*`/`OnIoDup*` model exists, what upper-layer operations it simplifies,
  when it is justified, and where the real overengineering risk sits for
  maintainers.
- Updated `lmdber.ts` source documentation so its public API is grouped by
  storage family and explicitly marks `OnIoSet*` as a `keri-ts` extension family
  rather than a KERIpy parity family.

### 2026-03-14 - Dupsort And IoDup Semantics Clarified

- Tightened the DB architecture contract to distinguish native LMDB duplicate
  values from application-level keyspace virtualization.
- Added explicit `Dup*` and `IoDup*` examples showing that dupsort order is by
  stored value bytes, while `IoDup*` uses hidden value proems to turn that into
  logical insertion order.
- Strengthened `LMDBer` unit coverage with focused tests for duplicate
  lexicographic ordering, last-duplicate semantics, IoDup insertion order, and
  monotonic hidden ordinal advance after deletion/reinsertion.

### 2026-03-14 - Root Test Failures Traced To `lmdb@3.5.1` Drift

- The repo-root `deno task test` failures were caused primarily by
  `packages/keri` drifting from the intended `lmdb@3.4.4` baseline to
  `lmdb@3.5.1` via caret imports.
- Under Deno 2.7.4 on macOS arm64, `lmdb@3.5.1` reproducibly panicked with
  `Cannot remove cleanup hook which was not registered` during app-level DB
  startup, while `lmdb@3.4.4` opened and closed cleanly.
- Fix: pin `lmdb` exactly to `3.4.4` in package imports/source references and
  keep the lockfile aligned with that exact version.
- Secondary test-suite fixes were needed in interop harnesses to avoid treating
  `pyenv`'s `kli` shim error output as proof that `kli` is actually installed.
- Effection integration tests were also decoupled from real LMDB startup so they
  keep exercising Effection orchestration rather than native DB boot paths.

### 2026-03-02 - Planning and Parity Artifact Foundation

- Expanded the reconciliation plan from init/incept-only work to a practical
  controller bootstrap arc with parity gates for visibility, service endpoints,
  OOBIs, transport, and challenge flows.
- Added the dedicated DB reconciliation plan and made LMDB parity an explicit
  prerequisite before provider abstraction.
- Generated and then refined the DB parity matrix, K/V inventory, owner lanes,
  gate worklists, and explicit Gate A-G mappings.
- Added an initial command/output parity matrix and a matrix-driven interop
  harness so P0 closure was auditable rather than implicit.

### 2026-03-03 - D1 DB-Core Parity and DB Contract Hardening

- Advanced `LMDBer` parity with lifecycle/version behavior, branch helpers, and
  the broader ordinal/dup/io-dup families needed downstream.
- Added stricter KERIpy-oracle vectors for backward-iterator and mixed-key edge
  behavior, plus a representation sweep so every current `LMDBer` method has a
  direct unit-test reference.
- Published and then broadened the DB architecture doc into a true invariants
  contract rather than a narrow dupsort note.
- Added maintainer-oriented helper/test doc passes to keep DB parity work
  reviewable during the method-by-method closure phase.

### 2026-03-03 - API Surface Review Flags

- Recorded a deliberate follow-up to re-evaluate `cntTop` and `cntAll` after the
  real KEL/bootstrap command graph is stable, so temporary reconciliation APIs
  do not silently become permanent surface area.

### 2026-03-17 - Habitat Inception Now Builds Through `SerderKERI`

- `Hab.make()` no longer hand-saidifies a loose inception SAD into
  `{ raw, pre, said }`; it now constructs a `SerderKERI` directly and persists
  `serder.raw`/`serder.pre`/`serder.said`.
- The old app-local inceptive prefix validation logic in `habbing.ts` was
  removed in favor of `SerderKERI` subtype verification, which centralizes the
  KERI rules where KERIpy keeps them.
- This shifts local habitat bootstrap closer to the KERIpy mental model:
  application code asks the serder layer for a valid inception event instead of
  reimplementing protocol rules above it.
- Added regression coverage proving the stored event can be rehydrated back out
  of `evts.` as a typed `SerderKERI` whose `pre` and `said` match the current
  habitat state.
- Scope honesty matters here too: this improves the local inception path and
  serder-backed DB hydration, but it is not evidence that the entire KEL stack
  is now at full KERIpy serder parity.

### 2026-03-17 - KERI Runtime Doc Coverage Now Includes Helper And DB Seams

- Extended maintainer docs across KERI runtime helpers that are easy to depend
  on but easy to misread: DB key aliases/constants, logger seams, config-file
  options, CLI bridge/parsing helpers, and the local helper exports at the tail
  of `keeping.ts`.
- The important maintainer lesson is that DB/app parity drift does not only
  happen in classes. Tiny exported helpers and aliases can silently become the
  real contract future work relies on, so they now need meaning-first docs too.
- Kept the docs additive around actively changing files such as `habbing.ts` and
  `keeping.ts`; the sweep was intentionally documentation-only and did not
  revert or reshape the surrounding in-flight implementation work.

### 2026-03-27 - Gate E Bootstrap Runtime Lands As A Shared Cue/Deck Host

- Topic docs updated:
  - `docs/plans/keri/GATE_E_AGENT_RUNTIME_OOBI_PLAN.md`
  - `docs/plans/keri/INIT_INCEPT_RECONCILIATION_PLAN.md`
- What changed:
  - Added a real shared `AgentRuntime` seam with `Deck`-backed ingress/cues/OOBI
    queues, reusable both command-local and from `tufa agent`.
  - Landed the first Gate E bootstrap slice: `ends add` mailbox auth through the
    runtime path, protocol-only OOBI serving, and mailbox/agent OOBI
    generate+resolve over the same shared runtime.
  - Added `Router`/`Revery`-backed reply handling for `/end/role/*` and
    `/loc/scheme`, minimal `Kevery` inception acceptance with first-seen
    persistence, and the Gate E plan artifact pointer in the main reconciliation
    plan.
  - Fixed an important BADA-style idempotence bug: `/loc/scheme` replays with
    the same SAID must be treated as harmless duplicates rather than rejected.
  - Fixed an Effection-hosting bug in the long-lived runtime: a microtask-only
    loop starved sibling tasks, so the continuous runtime now yields
    cooperatively between turns instead of monopolizing the host.
- Why:
  - Gate E could not be honestly advanced with CLI-only one-shot helpers. OOBI
    resolution needs a recognisable long-running runtime seam with parser,
    routing, first-seen logic, and escrow processing all hosted in one place.
  - The hostile lesson here is that "continuous loop" and "cooperative loop" are
    not the same thing in Effection. A starvation loop is not fidelity to
    KERIpy's doer model; it is a broken host abstraction.
- Tests:
  - Command:
    `deno test -A --unstable-ffi --config packages/keri/deno.json packages/keri/test/unit/core/deck.test.ts packages/keri/test/unit/app/gate-e-runtime.test.ts`
  - Result: passed locally
- Contracts/plans touched:
  - `docs/plans/keri/GATE_E_AGENT_RUNTIME_OOBI_PLAN.md`
  - `docs/plans/keri/INIT_INCEPT_RECONCILIATION_PLAN.md`
- Risks/TODO:
  - This is still only the bootstrap slice of Gate E. Most `Kevery` escrow
    families remain stubs, reply routing is still narrow, and TEL / EXN /
    registrar runtime breadth is not closed by this pass.

### 2026-03-28 - Gate E Bootstrap Seams Now Have Maintainer-Grade Source Docs

- Topic docs updated:
  - `.agents/PROJECT_LEARNINGS.md`
- What changed:
  - Added or deepened JSDoc across the Gate E bootstrap runtime surfaces:
    `routing.ts`, `agent-runtime.ts`, `eventing.ts`, `habbing.ts`, `cues.ts`,
    `server.ts`, and the Gate E CLI command files.
  - Documented the real behavioral seams maintainers will port against:
    `Revery.processReply()`, `Revery.acceptReply()`, reply escrow/update paths,
    `Kevery.processEvent()`, first-seen persistence, OOBI runtime jobs,
    `Hab.reply*()` helpers, and cue/deck ownership and flow.
  - Marked the still-unfinished parity areas honestly in source, especially the
    many `Kevery` escrow stubs and the narrow bootstrap scope of the current
    reply/OOBI implementation.
- Why:
  - The earlier Gate E code landed the behavior, but left too much meaning in
    the maintainers' heads. That is a trap. KERIpy maintainers trying to port
    cue-by-cue need the invariants, store effects, and BADA/idempotence rules
    stated where they read the code, not only in plans or thread history.
  - The real lesson is that runtime parity without source-documentation parity
    is false progress: the next maintainer still has to reverse-engineer the
    port before they can safely extend it.
- Tests:
  - Command: `deno check packages/keri/mod.ts`
  - Result: passed locally
  - Command: `deno check packages/cesr/mod.ts`
  - Result: passed locally
  - Command:
    `deno test -A --unstable-ffi --config packages/keri/deno.json packages/keri/test/unit/app/gate-e-runtime.test.ts packages/keri/test/unit/core/deck.test.ts`
  - Result: passed locally
  - Command:
    `deno test -A --unstable-ffi --config packages/keri/deno.json packages/keri/test/integration/app/server.test.ts`
  - Result: passed locally
  - Command:
    `deno test --config packages/cesr/deno.json packages/cesr/test/unit/primitives/indexer.test.ts packages/cesr/test/unit/primitives/siger.test.ts`
  - Result: passed locally
- Contracts/plans touched:
  - None
- Risks/TODO:
  - This was intentionally documentation-only. It did not close the still-open
    Gate E behavior gaps such as the wider `Kevery` escrow families, richer
    BADA-RUN reply coverage, or TEL / EXN / registrar runtime breadth.

### 2026-03-28 - Runtime Turn Orchestration Must Stay In Effection

- Topic docs updated:
  - `.agents/PROJECT_LEARNINGS.md`
- What changed:
  - Converted `processRuntimeTurn()` from a promise-returning helper into a
    proper Effection `Operation`.
  - Updated `tufa agent`, `ends add`, `oobi resolve`, and the Gate E runtime
    tests to `yield* processRuntimeTurn(runtime)` directly instead of wrapping
    `.then()` back through `action()`.
  - Narrowed promise adaptation to the real host boundary in OOBI fetch logic:
    `fetch()` and `response.arrayBuffer()` now live behind small `action()`
    helpers inside `agent-runtime.ts`.
  - Fixed the cancellation bug that fell out of this refactor: aborting the
    fetch action during normal cleanup was aborting the successfully returned
    response before its body was read.
- Why:
  - The promise-shaped turn loop was a bad abstraction. It made the runtime look
    async/await-native when the correct mental model is an Effection doer loop
    with explicit host-API adaptation only at the edges.
  - The deeper lesson is that widening a promise boundary is not just style
    drift; it changes cancellation behavior and can hide lifecycle bugs.
- Tests:
  - Command: `deno check packages/keri/mod.ts`
  - Result: passed locally
  - Command:
    `deno test -A --unstable-ffi --config packages/keri/deno.json packages/keri/test/unit/app/gate-e-runtime.test.ts packages/keri/test/integration/app/server.test.ts`
  - Result: passed locally
- Contracts/plans touched:
  - None
- Risks/TODO:
  - This fixes the orchestration seam and the fetch cleanup bug, but it does not
    yet imply broader Effection cleanup across every future network or TEL/EXN
    runtime boundary. That rule still has to be enforced as Gate E/F breadth
    grows.

### 2026-03-28 - Recent Gate E CLI And Server Glue Now Respects The Same Boundary Rule

- Topic docs updated:
  - `.agents/PROJECT_LEARNINGS.md`
- What changed:
  - Simplified `command-definitions.ts` lazy loading so dynamic imports are
    adapted directly inside one `action()`-backed operation instead of being
    threaded through `withResolvers()` and a spawned helper task.
  - Removed the fake `Promise.resolve()` returns from Commander `.action()`
    callbacks; those callbacks only dispatch selection state and should stay
    synchronous.
  - Split the HTTP server lifecycle in `server.ts` into explicit seams: host
    startup/cleanup and `server.finished` waiting are now separate helpers
    instead of one monolithic action body.
  - Extracted shared Effection HTTP test helpers for the touched Gate E tests
    and gave `fetchOp()` real cancellation-aware cleanup so the tests teach the
    same boundary discipline as production code.
- Why:
  - The earlier runtime-turn cleanup solved the biggest abstraction leak, but
    the surrounding CLI/server glue was still teaching the wrong lesson:
    promise-shaped glue was being kept alive where synchronous dispatch or
    smaller local boundary adapters were enough.
  - The real lesson is that explicit local adaptation is the style rule, not
    “remove promises everywhere.” Host promises still exist; they just should
    not leak across internal orchestration seams.
- Tests:
  - Command: `deno check packages/keri/mod.ts`
  - Result: passed locally
  - Command:
    `deno test -A --unstable-ffi --config packages/keri/deno.json packages/keri/test/unit/app/cli.test.ts packages/keri/test/integration/app/main.test.ts packages/keri/test/unit/app/gate-e-runtime.test.ts packages/keri/test/integration/app/server.test.ts`
  - Result: passed locally
- Contracts/plans touched:
  - None
- Risks/TODO:
  - Promise-based host boundaries still remain where they are legitimate, such
    as dynamic import, `server.finished`, `fetch()`, and response-body reads.
    Future cleanup should target leaked orchestration promises, not erase those
    real platform boundaries.

### 2026-03-28 - `AgentRuntime` Should Stay A Composition Root, Not A Queue Bag

- Topic docs updated:
  - `.agents/PROJECT_LEARNINGS.md`
  - `docs/adr/adr-0003-agent-runtime-composition-root.md`
  - `docs/plans/keri/GATE_E_AGENT_RUNTIME_OOBI_PLAN.md`
- What changed:
  - Split the old flat Gate E runtime into a small composition root plus two
    component-owned runtime seams:
    - `Reactor` now owns parser ingress, attachment normalization, `Router`,
      `Revery`, `Kevery`, and the continuous message/escrow doers.
    - `Oobiery` now owns durable OOBI queue processing over `oobis.` / `coobi.`
      / `eoobi.` / `roobi.` and exposes the continuous `oobiDo()` loop.
  - Shrunk `AgentRuntime` so it now keeps only shared state: `hby`, host `mode`,
    the shared cue `Deck`, and component instances.
  - Removed the root-level `oobiJobs`, `completions`, and `transport` decks.
  - Kept `processRuntimeTurn()` for command-local CLI/test stepping, but turned
    it into a delegating helper over `reactor.processOnce()`,
    `oobiery.processOnce()`, and `reactor.processEscrowsOnce()`.
  - Added ADR-0003 to document the architectural rule and the KERIpy/Effection
    mental-model mapping.
- Why:
  - The flat runtime was a bootstrap convenience, but it taught the wrong mental
    model. KERIpy maintainers think in component-owned doers, not in a root
    object that owns every queue in the system.
  - The real lesson is that plain helpers like `processIngress()` are not the
    problem. Ownership is the problem. A helper is fine when it lives on the
    component that owns the corresponding state and long-running operation.
  - Durable queue-like workflow state should default to KERIpy DB-backed stores
    unless there is a strong reason to do otherwise.
- Tests:
  - Command: `deno check packages/keri/mod.ts`
  - Result: passed locally
  - Command:
    `deno test -A --unstable-ffi --config packages/keri/deno.json packages/keri/test/unit/app/cli.test.ts packages/keri/test/integration/app/main.test.ts packages/keri/test/unit/app/gate-e-runtime.test.ts packages/keri/test/integration/app/server.test.ts`
  - Result: passed locally (`16 passed, 0 failed`)
- Contracts/plans touched:
  - `docs/adr/adr-0003-agent-runtime-composition-root.md`
  - `docs/plans/keri/GATE_E_AGENT_RUNTIME_OOBI_PLAN.md`
- Risks/TODO:
  - `Oobiery` now uses the durable `oobis.` path, but it still only covers the
    current Gate E bootstrap slice. Richer KERIpy parity such as `woobi.`
    continuation, retry policy, and broader convergence semantics still remain
    future work.

### 2026-03-29 - `KeriDispatchEnvelope` Now Carries The Full KERIpy Parser-State Families

- Topic docs updated:
  - `.agents/PROJECT_LEARNINGS.md`
  - `docs/plans/keri/GATE_E_AGENT_RUNTIME_OOBI_PLAN.md`
- What changed:
  - Expanded `KeriDispatchEnvelope` in `packages/keri/src/app/reactor.ts` from a
    narrow bootstrap payload into the typed `keri-ts` equivalent of KERIpy's
    parser `exts` accumulation dict.
  - Added normalization coverage for the full parser-state families we will need
    for later routing/event work:
    - `trqs`
    - `ssgs`
    - `frcs`
    - `sscs`
    - `ssts`
    - `tdcs`
    - `ptds`
    - `essrs`
    - `bsqs`
    - `bsss`
    - `tmqs`
    - `local`
  - Kept the old bootstrap aliases `firstSeen` and `sourceSeals` so current
    runtime consumers did not need to change in the same pass.
- Why:
  - The earlier envelope was enough for the bootstrap OOBI slice, but it was not
    a real Chunk 3 seam. It only represented what current consumers used, not
    what KERIpy's parser actually accumulates before dispatch.
  - That shape would have created architecture debt immediately: receipts,
    queries, EXN, TEL, and delegated/seal-heavy event flows would each be
    tempted to bypass the envelope and reach back into parser-specific
    attachment graphs.
  - The rule going forward is simple: if a family is part of KERIpy parser
    dispatch accumulation, it belongs on the envelope even before a consumer
    exists in `keri-ts`.
- Tests:
  - Command: `deno check packages/keri/mod.ts`
  - Result: passed locally
  - Command:
    `deno test -A --unstable-ffi --config packages/keri/deno.json packages/keri/test/unit/app/gate-e-runtime.test.ts packages/keri/test/integration/app/server.test.ts`
  - Result: passed locally (`5 passed, 0 failed`)
- Contracts/plans touched:
  - `docs/plans/keri/GATE_E_AGENT_RUNTIME_OOBI_PLAN.md`
- Risks/TODO:
  - The envelope is now broad enough, but dispatch consumers are still narrow.
    `Reactor` still only routes the bootstrap ilks, so later work must consume
    these new fields instead of letting them stay dead weight.

### 2026-03-29 - `Kever` Now Owns Accepted Key State Instead Of Habitat Projections

- Topic docs updated:
  - `.agents/PROJECT_LEARNINGS.md`
  - `.agents/learnings/PROJECT_LEARNINGS_KELS.md`
- What changed:
  - Added a real `Kever` port at `packages/keri/src/core/kever.ts` with
    constructor/reload/state/log support for accepted `icp`/`dip` events and
    bootstrap `update()` support for `rot`, `drt`, and `ixn`.
  - Added live accepted-state caches to `Baser`:
    - `kevers`
    - `prefixes`
    - `groups`
  - Reworked `Kevery` so it now creates or updates live `Kever` instances
    instead of owning bootstrap inception logic itself.
  - Reworked `Hab` so local inception no longer hand-writes `evts.`, `kels.`,
    `fels.`, `dtss.`, `sigs.`, `esrs.`, and `states.`. It now signs the local
    event and feeds it through the same acceptance path as remote processing.
  - Changed `Hab.kever` from a thin `KeyStateRecord`-shaped projection into a
    resolver for the live `Kever` owned by `Baser`.
- Why:
  - The absence of a real `Kever` was architectural debt, not just a missing
    class name. Constructor-like validation, accepted-state mutation, and
    durable logging were split between `Kevery.processInception()` and
    `Hab.make()`, which guaranteed local/remote divergence.
  - Once `Kever` exists, accepted state has a single owner again. `Kevery`
    dispatches and cues; `Hab` builds/signs local events; `Baser` owns the live
    accepted-state cache that both of them rely on.
  - This follows KERIpy's behavioral contract while keeping the TS design more
    explicit: live state is a `Map`, local prefixes/groups are `Set`s, and
    reopen semantics are loader helpers instead of Python read-through dicts.
- Tests:
  - Command: `deno check packages/keri/mod.ts`
  - Result: passed locally
  - Command:
    `deno test -A --unstable-ffi --config packages/keri/deno.json packages/keri/test/unit/core/kever.test.ts packages/keri/test/unit/app/habbing.test.ts packages/keri/test/unit/db/basing.test.ts`
  - Result: passed locally (`9 passed, 0 failed`)
  - Command:
    `deno test -A --unstable-ffi --config packages/keri/deno.json packages/keri/test/unit/app/reactor.test.ts packages/keri/test/unit/app/gate-e-runtime.test.ts packages/keri/test/unit/app/cue-runtime.test.ts packages/keri/test/integration/app/server.test.ts`
  - Result: passed locally (`10 passed, 0 failed`)
- Contracts/plans touched:
  - `packages/keri/src/core/kever.ts`
  - `packages/keri/src/core/eventing.ts`
  - `packages/keri/src/db/basing.ts`
  - `packages/keri/src/app/habbing.ts`
- Risks/TODO:
  - `Kever.update()` currently covers the bootstrap `rot`/`drt`/`ixn` slice,
    not full KERIpy parity. Witness, delegation, and escrow-heavy acceptance
    breadth still needs to move deeper into `Kever`/`Kevery`.
  - Cue emission is still owned by `Kevery`, which is the right split for now,
    but later clone/duplicitous anomaly handling may justify limited
    state-machine-local cues from `Kever` itself.

### 2026-04-02 - Backer Threshold Exactness Lives In `Kever`, Not Just In Serder Accessors

- Topic docs updated:
  - `.agents/PROJECT_LEARNINGS.md`
  - `.agents/learnings/PROJECT_LEARNINGS_KELS.md`
  - `.agents/learnings/PROJECT_LEARNINGS_CESR.md`
- What changed:
  - Reworked the `Kever` backer-threshold path so provisional establishment
    validation carries `NumberPrimitive` `toader` values end-to-end instead of
    collapsing them immediately to JS `number`.
  - Switched `bt` state serialization from `Number(...).toString(16)` to exact
    `.numh` emission and reloaded durable `bt` state through the compact
    number-primitive helper instead of the fixed Huge-number path.
  - Added KEL regressions proving `Kever.evaluateInception()` accepts
    deprecated intive `bt` inputs and that `Kever.fromState().state()` no
    longer drifts large `bt` hex values through `bigint -> number -> hex`
    coercion.
- Why:
  - The original suspicion that `bn` was reading the wrong field was a
    category error. `bt` is the field; `bn`/`bner` are projections of that same
    field. The real parity bug was representation loss: once `Kever` dropped
    `bt` to a JS `number`, large thresholds could no longer round-trip exactly,
    even though KERIpy keeps wrapper/exact-integer form until serialization.
- Tests:
  - Command:
    `deno test -A --unstable-ffi --config packages/keri/deno.json packages/keri/test/unit/core/kever.test.ts`
  - Result: passed locally (`5 passed, 0 failed`)
  - Command: `deno check packages/keri/mod.ts`
  - Result: passed locally
- Contracts/plans touched:
  - `packages/keri/src/core/kever.ts`
  - `packages/keri/test/unit/core/kever.test.ts`
- Risks/TODO:
  - This pass intentionally scoped exactness fixes to the `bt`/`toader` path.
    Other scalar convenience projections such as `sn`/`fn` still collapse
    `NumberPrimitive.num` to JS `number`, so broader large-ordinal exactness is
    separate follow-on work.

### 2026-04-02 - `evaluateInception()` Should Own The Whole Inception Decision

- Topic docs updated:
  - `.agents/PROJECT_LEARNINGS.md`
  - `.agents/learnings/PROJECT_LEARNINGS_KELS.md`
- What changed:
  - Collapsed the one-off `buildInceptionState()` helper into
    `Kever.evaluateInception()` so the inception decision path no longer relies
    on an anonymous union of `KeverDecision | { state, wits, toader, ... }`.
  - Kept the provisional inception data local to `evaluateInception()` and
    preserved the existing decision/logging phase split for attachment
    verification and first-seen replay handling.
- Why:
  - The old helper returned an unnamed “almost a decision” object shape, which
    forced readers to re-derive the abstraction and made the `\"kind\" in ...`
    narrowing feel like control-flow trivia instead of state-machine intent.
  - The durable rule is simpler: `evaluateInception()` is the decision seam, so
    it should assemble the whole decision. Internal helpers below that seam
    should either return a named plan/input type or stay local.
- Tests:
  - Command:
    `deno test -A --unstable-ffi --config packages/keri/deno.json packages/keri/test/unit/core/kever.test.ts`
  - Result: passed locally (`5 passed, 0 failed`)
  - Command: `deno check packages/keri/mod.ts`
  - Result: passed locally
- Contracts/plans touched:
  - `packages/keri/src/core/kever.ts`
- Risks/TODO:
  - The same readability rule should be enforced on future `Tever`/`Tevery` or
    escrow-heavy processor ports: do not let internal helpers invent anonymous
    pre-decision unions when the real boundary contract is already a typed
    decision family.

### 2026-04-02 - Decision Variants Should Be Named Types, Not Anonymous Unions

- Topic docs updated:
  - `.agents/PROJECT_LEARNINGS.md`
  - `.agents/learnings/PROJECT_LEARNINGS_KELS.md`
- What changed:
  - Replaced the anonymous object-literal members in `AttachmentDecision` and
    `KeverDecision` with named interfaces such as `AttachmentVerified`,
    `AttachmentEscrow`, `AttachmentReject`, `KeverAccept`, `KeverDuplicate`,
    `KeverEscrow`, and `KeverReject`.
  - Renamed the accepted payload field from `plan` to `transition` and the
    validated attachment payload field from `atc` to `attachments`, then
    propagated that vocabulary through `Kever`, `Kevery`, and the focused KEL
    unit tests.
  - Aligned the supporting factory/apply method names with the new nouns so the
    acceptance path now reads in terms of transitions and event state rather
    than leftover `*Plan` terminology.
- Why:
  - The earlier design was functionally sound but cognitively sloppy: readers
    had to infer the meaning of each union member from its field shape, and the
    mixed `plan`/`atc` vocabulary obscured the functional design where typed
    decisions carry immutable payload nouns forward to the applying layer.
  - Named decision variants preserve the TypeScript-native control-flow model
    while making the state-machine taxonomy easier to scan, grep, and extend.
- Tests:
  - Command:
    `deno test -A --unstable-ffi --config packages/keri/deno.json packages/keri/test/unit/core/kever.test.ts packages/keri/test/unit/core/eventing.test.ts`
  - Result: passed locally (`9 passed, 0 failed`)
  - Command: `deno check packages/keri/mod.ts`
  - Result: passed locally
- Contracts/plans touched:
  - `packages/keri/src/core/kever-decisions.ts`
  - `packages/keri/src/core/kever.ts`
  - `packages/keri/src/core/eventing.ts`
  - `packages/keri/test/unit/core/kever.test.ts`
- Risks/TODO:
  - `DuplicateLogPlan` still carries older naming and may be worth renaming in a
    later readability pass if it starts to pull maintainers back toward a
    planner/scheduler mental model instead of an immutable event-state model.

### 2026-04-02 - KEL Threshold Validation Now Uses `Tholder` Semantics End To End

- Topic docs updated:
  - `.agents/PROJECT_LEARNINGS.md`
  - `.agents/learnings/PROJECT_LEARNINGS_CESR.md`
  - `.agents/learnings/PROJECT_LEARNINGS_KELS.md`
- What changed:
  - Replaced KEL-side numeric threshold shortcuts with `Tholder` semantics:
    `Kever` now validates threshold material via `tholder.size`, evaluates
    controller and prior-next satisfaction via `tholder.satisfy(indices)`, and
    reloads durable `kt`/`nt` state through semantic `Tholder` construction
    instead of the old hex-only helper.
  - Widened `KeyStateRecord.kt`/`nt` and local authoring inputs
    (`MakeHabArgs`, CLI/file incept options) so weighted threshold structures
    survive build -> accept -> persist -> reload without flattening.
  - Updated `Revery.acceptReply()` so transferable reply endorsements now use
    the same threshold semantics as KEL validation instead of a numeric count
    comparison.
  - Added KEL/runtime regressions covering weighted local inception, weighted
    `ixn` signature escrow/acceptance, weighted durable-state reload, weighted
    CLI inception input, and weighted reply-signature aggregation.
- Why:
  - The real parity bug was not “missing one `Tholder` class method”; it was a
    systemic representation leak. `keri-ts` could parse weighted thresholds at
    the edges but then discarded that meaning before `Kever`, `Hab`, or
    `Revery` used it.
  - The durable rule now is brutal and clear: if a path depends on signer
    threshold logic, it must consume `Tholder` directly rather than recreating
    numeric threshold semantics locally.
- Tests:
  - Command:
    `deno test -A --unstable-ffi --config packages/keri/deno.json packages/keri/test/unit/app/incept.test.ts packages/keri/test/unit/app/habbing.test.ts packages/keri/test/unit/core/eventing.test.ts packages/keri/test/unit/core/kever.test.ts packages/keri/test/unit/core/routing.test.ts`
  - Result: passed locally (`23 passed, 0 failed`)
  - Command: `deno check --config packages/keri/deno.json packages/keri/mod.ts`
  - Result: passed locally
- Contracts/plans touched:
  - `packages/keri/src/core/kever.ts`
  - `packages/keri/src/core/routing.ts`
  - `packages/keri/src/core/records.ts`
  - `packages/keri/src/app/habbing.ts`
  - `packages/keri/src/app/cli/incept.ts`
  - `packages/keri/src/app/cli/common/parsing.ts`
  - `docs/design-docs/keri/WEIGHTED_THRESHOLD_PARITY.md`
- Risks/TODO:
  - This pass covers weighted threshold semantics for single-controller KEL
    processing and reply verification, but it does not implement multisig group
    orchestration. Later multisig work should consume these threshold surfaces
    instead of inventing another threshold representation.
