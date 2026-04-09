# PROJECT_LEARNINGS_WITNESS_WATCHER_OBSERVER_INFRA

## Purpose

Persistent learnings for witness, watcher, and observer infrastructure,
deployment, CI, and interoperability operations.

## Current State

1. Witness interop now has a real explicit-harness test seam, not just local
   `tufa` witness coverage or fixed-port KERIpy demos. The dedicated
   `interop-witness` lane boots real KERIpy witnesses from temp-copied config
   files with randomized localhost ports so receipt/query behavior is exercised
   against actual KERIpy witness processes.
2. Explicit KERIpy witness hosts should be treated as OOBI-served services, not
   `/health`-served services. `kli witness start` does not expose the same
   health endpoint contract as `tufa` hosts, so readiness should probe the
   controller or witness OOBI URL instead of assuming `/health`.
3. Witness-node discovery needs both controller and witness OOBIs. Resolving
   only the witness OOBI is not enough for stable HTTP receipt/query interop,
   because controllers also need the location/end-role material carried through
   the controller OOBI path.
4. The currently proved witness matrix is:
   - `tufa` controller with only KERIpy witnesses, including successful
     cut/add witness rotation and full receipt convergence.
   - KLI/KERIpy controller with only KERIpy witnesses across multiple fully
     witnessed rotations while keeping the witness set stable.
   - `tufa` controller with a mixed `tufa` + KERIpy witness set, including
     cross-implementation witness replacement and receipt convergence.
5. The 6-witness KERIpy soak is intentionally a manual/nightly seam, not a
   default CI requirement. Keep it ignored by default and document the explicit
   opt-in command.
6. Infra work should inherit the same DB ordering and duplicate-semantics model
   as the rest of the project; mailbox and receipt behavior are not exempt from
   the shared DB architecture contract.
7. Formatting policy is `dprint`, and CI/release paths should enforce
   `deno task fmt:check`.
8. `master` now has a dedicated PR stage gate that runs formatting, lint, and
   quality/test coverage against a pinned KERIpy CLI so GitHub Actions matches
   local expectations more closely.
9. Runtime version generation is deterministic during checks: build metadata is
   empty by default and CI artifact steps must opt into stamped metadata
   explicitly.
10. KERIpy interop depends on exact LMDB-js behavior, not just an npm version:
    keep `lmdb` pinned to `3.4.4`, preserve `LMDB_DATA_V1=true`, and rebuild the
    native addon in the compatible way rather than assuming runner defaults are
    safe.
11. The LMDB v1-compatible rebuild path should rebuild the native addon directly
    instead of using the published package's `npm rebuild ... --build-from-source`
    path, which expects a JS build toolchain CI may not provide.
12. Cache topology is part of correctness. Shared bootstrap caches are useful,
    but LMDB-v1-sensitive interop jobs need their own cache boundary so a
    non-interop job cannot accidentally suppress the required rebuild.
13. CI feedback should follow isolation boundaries, not folder names: static
    checks, interop-sensitive jobs, smoke paths, and slower lanes should be split
    so failures localize quickly without breaking branch-protection stability.
14. Exact env pins, action SHAs, environment assertions, and saved artifacts are
    part of reproducibility for a native-addon library repo, not optional
    polish.

## Use This Doc For

1. Witness/watcher/observer deployment and operational compatibility notes.
2. CI/release/runtime interop contracts that affect infra behavior.
3. Cache, versioning, and test-isolation lessons.

## Key References

1. `docs/design-docs/db/db-architecture.md`
2. `docs/versioning/versioning-and-release-plan.md`
3. `docs/versioning/release-versioning.md`

## Current Follow-Ups

1. Keep the explicit KERIpy witness harness on temp-copied randomized configs.
   Do not regress to fixed-port `kli witness demo` for default CI coverage.
2. Preserve the controller-plus-witness OOBI resolution rule for witness hosts
   whenever new interop or bootstrap helpers are added.
3. Keep CI and release workflows honest about LMDB v1 rebuild requirements and
   KERIpy pins whenever bootstrap logic changes.
4. Preserve split-job feedback topology and isolation-aware test grouping rather
   than collapsing everything back into one giant lane.
5. If KLI/KERIpy witness-set replacement under the explicit harness becomes a
   required control path, prove it in its own scenario instead of silently
   expanding the stable-control test that currently covers repeated
   same-witness rotations.
6. When infra-role protocol work deepens, add it here as durable operational
   rules rather than as workflow-by-workflow diary entries.

## Milestone Rollup

### 2026-03-03 - Shared DB Invariants Became Explicit For Infra Work

- Infra-role work now routes through the shared DB architecture contract so
  duplicate ordering, idempotence, and mailbox/receipt indexing assumptions do
  not drift from the rest of the codebase.

### 2026-03-16 - Formatting And PR Gate Policy Were Locked

- Switched formatter policy to `dprint`.
- Added the dedicated PR stage gate, pinned KERIpy install, and cache-aware
  workflow design so CI exercises the same interop-sensitive quality surface
  maintainers expect locally.

### 2026-03-17 - CI Reproducibility And Interop Contracts Tightened

- Made version checks deterministic by removing implicit ambient GitHub-env
  stamping from ordinary check paths.
- Codified LMDB-js v1 compatibility as a CI/runtime contract and documented the
  correct native-addon rebuild path.
- Split KERI test/workflow topology around real isolation boundaries so failures
  are easier to localize and warm-cache latency is better.

### 2026-03-27 - Interop Cache Topology Became Part Of Correctness

- Added a separate interop-sensitive `node_modules` cache boundary so only jobs
  that actually perform the LMDB-v1 rebuild can satisfy later interop runs.
- This closed the specific failure mode where generic bootstrap jobs populated
  caches that caused interop jobs to skip the only step that made the native
  addon KERIpy-compatible.

### 2026-04-07 - Mailbox Query Interop Needs More Than Just SSE Compatibility

- KLI/Tufa mailbox interop was not blocked by SSE framing once `/reply` and
  `/replay` topic publication was correct. The harder failure was controller
  query convergence after rotation.
- Durable rule: for controller `ksn` queries without witnesses, mailbox
  compatibility is not enough by itself. The requester may need replay material
  quickly enough to verify the signer state behind the reply. In practice that
  means the host must preserve the mailbox publication path for `/reply` and
  may also need to bridge replay catch-up for cross-implementation clients.
- Operationally, treat mailbox topic ownership (`dest` vs subject prefix) as a
  correctness boundary, not a storage detail. The wrong bucket silently turns
  "query succeeded" into stale remote state.

### 2026-04-08 - Real KERIpy Witness Interop Needs An Explicit Harness

- The durable witness-interop seam is now a dedicated `interop-witness` test
  lane backed by a shared helper module and an explicit `KeriPyWitnessHarness`.
  That harness should copy reference witness configs into a temp config root,
  rewrite `curls` to randomized localhost ports, initialize each witness in an
  isolated temp home/base, and start long-lived KERIpy witnesses from the
  local-source Python package.
- Readiness for explicit KERIpy witness hosts should be OOBI-based, not
  `/health`-based.
- Controllers must resolve both controller and witness OOBIs for witness nodes
  so receipt/query endpoint discovery is present in both `tufa` and KLI flows.
- The stable proved matrix now includes all-KERIpy-witness `tufa` flows, mixed
  `tufa` + KERIpy witness flows, and an all-KERIpy KLI control case across
  multiple same-witness rotations. Keep the 6-witness soak manual/ignored by
  default.
