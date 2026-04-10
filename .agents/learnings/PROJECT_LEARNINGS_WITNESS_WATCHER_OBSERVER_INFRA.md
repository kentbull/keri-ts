# PROJECT_LEARNINGS_WITNESS_WATCHER_OBSERVER_INFRA

## Purpose

Persistent learnings for witness, watcher, and observer infrastructure, CI,
release, and interoperability operations.

## Current State

1. Witness interop now has a real explicit-harness seam. The `interop-witness`
   lane boots actual KERIpy witnesses from temp-copied configs with randomized
   localhost ports instead of relying on fixed-port demos.
2. Explicit KERIpy witness hosts should be treated as OOBI-served services, not
   `/health`-served services; readiness should probe controller or witness OOBI
   URLs.
3. Witness-node discovery needs both controller and witness OOBIs. Resolving
   only the witness OOBI is not enough for stable receipt/query interop.
4. The currently proved witness matrix is:
   - `tufa` controller with only KERIpy witnesses, including cut/add rotation
     and receipt convergence
   - KLI/KERIpy controller with only KERIpy witnesses across repeated
     same-witness rotations
   - `tufa` controller with mixed `tufa` + KERIpy witnesses, including
     cross-implementation replacement
5. The 6-witness KERIpy soak is intentionally manual/nightly, not default CI.
6. Infra work inherits the same DB ordering and duplicate-semantics model as
   the rest of the project.
7. Formatting policy is `dprint`, and CI/release paths should enforce
   `deno task fmt:check`.
8. PR CI is stage-gated and pinned closely enough to local expectations that
   GitHub Actions can serve as honest interop evidence rather than a separate
   environment story.
9. Runtime version generation should stay deterministic during checks; build
   metadata is opt-in for artifact/release steps.
10. KERIpy interop depends on exact LMDB-js behavior: keep `lmdb` pinned to
    `3.4.4`, preserve `LMDB_DATA_V1=true`, and use the correct native-addon
    rebuild path.
11. Cache topology is part of correctness. Interop-sensitive LMDB-v1 jobs need
    their own cache boundary.
12. CI feedback should follow true isolation boundaries: DB, core, app/server,
    runtime, stateful app, and interop lanes should split when their wall-clock
    or isolation needs diverge materially.
13. KERI test topology is an explicit repo contract. The source-owned lane
    annotations plus `scripts/ci/run-keri-test-group.ts` are authoritative, and
    lane audit should fail if any discovered test case is missing or
    double-owned.
14. Parallelism policy is explicit: parallelize only where isolation is real,
    cap default worker counts, and keep runtime/server/interop/stateful lanes
    serial until their assumptions change.
15. When the true safe boundary is the file or module rather than individual
    tests, physically split the file instead of accumulating lane overrides.
16. The active host boundary lives in `packages/tufa`: shared host kernel, Hono
    HTTP edge, Deno/Node listeners, witness TCP listener, and role-host seams.
17. Infra and runtime tests should target `packages/tufa` entrypoints/roles
    rather than rebuilding dependencies on removed `packages/keri` host paths.
18. `tufa db dump` is the preferred operational seam for localizing
    controller-vs-witness or provider-vs-controller state drift.

## Use This Doc For

1. Witness/watcher/observer deployment and compatibility notes
2. CI/release/runtime interop contracts that affect infra behavior
3. Cache, versioning, and test-isolation lessons

## Key References

1. `docs/design-docs/db/db-architecture.md`
2. `docs/versioning/versioning-and-release-plan.md`
3. `docs/versioning/release-versioning.md`

## Current Follow-Ups

1. Keep the explicit KERIpy witness harness on temp-copied randomized configs;
   do not regress to fixed-port demos for default CI coverage.
2. Preserve the controller-plus-witness OOBI resolution rule whenever new
   interop or bootstrap helpers are added.
3. Keep CI and release workflows honest about LMDB v1 rebuild requirements and
   KERIpy pins whenever bootstrap logic changes.
4. Preserve split-job feedback topology and isolation-aware test grouping rather
   than collapsing back into a giant lane.
5. Keep KERI lane metadata current when mailbox/runtime/interop files gain new
   tests.
6. Keep runtime/server lanes serial until the tests stop depending on fixed
   ports, process-global state, or shared stores.
7. If KLI/KERIpy witness-set replacement under the explicit harness becomes a
   required control path, prove it in its own scenario rather than silently
   broadening a different test.
8. Keep new host/integration tests pointed at `packages/tufa` surfaces so
   package-boundary drift is caught where users actually run the code.

## Milestone Rollup

### 2026-03-03 to 2026-03-27 - Reproducible Infra Rules Became Explicit

- Infra work was tied to the shared DB invariants contract instead of carrying
  its own storage folklore.
- Formatting, PR gates, version determinism, LMDB-v1 rebuild rules, and cache
  topology were turned into explicit correctness constraints.

### 2026-04-07 to 2026-04-08 - Witness Interop And Test Topology Became Honest

- Mailbox query interop failures were narrowed to controller convergence and
  replay/publication truth rather than generic SSE compatibility.
- Real KERIpy witness interop now uses an explicit harness, OOBI-based
  readiness, and a clearly stated proved scenario matrix.
- `tufa db dump` became the preferred seam for localizing interop failures.
- KERI lane ownership became a maintained contract rather than an informal shell
  convention.

### 2026-04-09 - CI Buckets And Runtime Isolation Were Recut Around Reality

- The old "fast" CI umbrella was split because it no longer described actual
  wall-clock behavior.
- Worker defaults were capped and tied to honest isolation boundaries.
- Oversized parallel lanes were split, and mixed runtime files were physically
  separated so the test topology matches the real safe concurrency boundary.
