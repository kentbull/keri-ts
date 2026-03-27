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

## Scope Checklist

Use this doc for:

1. event validation and ordering rules,
2. replay behavior and state derivation,
3. key state transition constraints,
4. compatibility nuances with KERIpy KEL behavior.

## Cross-Topic Design References

1. `docs/design-docs/db/db-architecture.md`

## Current Follow-Ups

1. Keep KEL-state work parity-first on top of DB invariants rather than adding
   abstraction before behavior closure.
2. Treat Gates B, C, and D as closed enough to move main attention to Gate E
   command surfaces plus the escrow/process-loop work that Gate F/G depend on.
3. Keep DB parity artifacts concise and execution-oriented; they should remain
   usable worklists, not archival dumps.
4. Treat missing class docstrings on newly ported KERIpy surfaces as a real
   maintenance regression and guard against them automatically.

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
