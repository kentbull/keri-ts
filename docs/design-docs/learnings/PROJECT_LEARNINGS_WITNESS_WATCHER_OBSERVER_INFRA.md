# PROJECT_LEARNINGS_WITNESS_WATCHER_OBSERVER_INFRA

## Purpose

Persistent learnings for witness/watcher/observer infrastructure, deployment,
and operations interoperability.

## Current Status

### 2026-02-28

1. No dedicated infra-role deep-dive updates captured yet in this cycle.
2. Keep this file for network-role behavior and operational compatibility notes.

## Scope Checklist

Use this doc for:

1. witness/watcher/observer role responsibilities,
2. network topology and deployment assumptions,
3. operational runbooks and failure handling,
4. interop findings across implementations/environments.

## Cross-Topic Design References

1. DB architecture and parity contract (required context for
   mailbox/topic/receipt indexing behaviors that rely on duplicate and
   insertion-order semantics):
   - `docs/design-docs/db/db-architecture.md`

## Planned Sections

1. Decision log
2. Operational patterns
3. Compatibility findings
4. Risks and TODOs

## Handoff Log

### 2026-03-03 - LMDB `dupsort` Design Reference Added

- Topic docs updated:
  - `docs/design-docs/db/db-architecture.md`
- What changed:
  - Added a cross-topic reference to the DB architecture contract doc so
    infra-role work uses the same duplicate/index ordering semantics and
    invariants as KERIpy.
- Why:
  - Witness/watcher/observer and mailbox flows depend on correct DB ordering and
    idempotence semantics for operational interoperability.
- Tests:
  - Command: N/A (design documentation update only)
  - Result: N/A
- Contracts/plans touched:
  - `docs/design-docs/db/db-architecture.md`
- Risks/TODO:
  - Validate infra-specific DB slices against this design during Gate F/G and
    Gate H parity closure.

### 2026-03-03 - CI Formatter Policy Locked to `deno fmt` (Superseded)

- Topic docs updated:
  - `.github/workflows/ci.yml`
  - `.github/workflows/keri-ts-npm-release.yml`
  - `.github/workflows/cesr-npm-release.yml`
  - `.github/workflows/changesets-version-pr.yml`
- What changed:
  - Historical note only: CI originally standardized on `deno fmt --check`
    plus a workflow-policy guard against other formatters.
- Why:
  - Preserve the rationale chain for the later move from `deno fmt` to
    `dprint`; this entry is superseded, not current policy.
- Tests:
  - Command: historical only
  - Result: superseded by the 2026-03-16 formatter-policy entry below
- Contracts/plans touched:
  - N/A
- Risks/TODO:
  - None; this entry remains only as migration history.

### 2026-03-16 - Formatter Policy Switched to `dprint`

- Topic docs updated:
  - `deno.json`
  - `packages/keri/deno.json`
  - `packages/cesr/deno.json`
  - `.github/workflows/changesets-version-pr.yml`
  - `.github/workflows/keri-ts-npm-release.yml`
  - `.github/workflows/cesr-npm-release.yml`
- What changed:
  - Replaced `deno fmt` tasking and workflow checks with `dprint`.
  - Added a repo-root `dprint.json` so formatting policy is centralized.
  - Updated generated-artifact formatting in CESR table generation to use
    `dprint` instead of `deno fmt`.
- Why:
  - `deno fmt` was too rigid for the desired whitespace style; `dprint`
    provides more control over wrapping behavior and is a better fit for
    maintainers who care strongly about layout.
- Tests:
  - Command: `deno check packages/cesr/scripts/generate-tables.ts`
  - Result: passed
- Contracts/plans touched:
  - N/A
- Risks/TODO:
  - This offline session could not live-validate `dprint` package/plugin
    downloads, so the first networked CI/local run should confirm formatter
    bootstrap succeeds end-to-end.

### 2026-03-16 - PR Stage Gate Added For `master`

- Topic docs updated:
  - `.github/workflows/pr-stage-gate.yml`
  - `.github/workflows/keri-ts-npm-release.yml`
  - `deno.json`
  - `packages/keri/deno.json`
  - `packages/cesr/deno.json`
- What changed:
  - Added a dedicated PR workflow for pull requests targeting `master` that
    runs formatting, linting, static quality checks, and both KERI/CESR test
    suites as one merge gate.
  - Added an explicit repo lint task based on Deno's recommended rules with
    targeted exclusions for the repo's current Deno-import/Effection patterns,
    and fixed the concrete code/test issues needed for that lint pass to go
    green.
  - Installed a pinned KERIpy CLI in CI via
    `WebOfTrust/keripy@273784cb1702348c3888a09806cc37aea1877704` before test
    execution so interop suites run deterministically in GitHub Actions.
  - Applied the same pinned KERIpy install step to the `keri-ts` npm release
    workflow before its quality-test gate.
  - Added dependency caching across active workflows: shared Deno/module cache
    plus npm cache everywhere, and a KERIpy virtualenv cache keyed by the
    pinned Git SHA on workflows that run interop-sensitive tests.
  - Removed implicit GitHub-env sensitivity from runtime version checks:
    stage-gate quality checks force empty build metadata, and artifact-building
    release steps opt into stamped metadata explicitly instead of inheriting it
    accidentally from runner env.
- Why:
  - A PR status check only protects `master` if the workflow exists, runs on PR
    events, and exercises the same interop-sensitive test surface maintainers
    expect locally.
  - Without cache restoration, the same pipelines keep paying the full
    dependency/bootstrap cost on every run even when neither the Deno graph nor
    the pinned KERIpy version changed.
- Tests:
  - Commands: `deno task fmt:check`, `deno task lint`,
    `deno task quality:check`, `deno task test:quality`,
    `deno task test:cesr`
  - Result: all passed locally; `fmt:check` emitted only a sandbox-local
    `dprint` incremental-cache write warning
- Contracts/plans touched:
  - `docs/design-docs/versioning-and-release-plan.md`
- Risks/TODO:
  - Branch protection in GitHub still needs to require the new PR workflow's
    status check if that rule is not already configured.
  - The pinned KERIpy install depends on GitHub Actions having Python `3.14`
    available, matching the current KERIpy packaging requirement.
  - The KERIpy virtualenv cache is keyed by exact SHA on purpose; that is
    maximally reproducible, but cache misses are expected whenever the pin
    moves.

### 2026-03-17 - Version Checks Became Deterministic Across Local And CI

- Topic docs updated:
  - `scripts/generate_versions.ts`
  - `deno.json`
  - `.github/workflows/pr-stage-gate.yml`
  - `.github/workflows/keri-ts-npm-release.yml`
  - `.github/workflows/cesr-npm-release.yml`
  - `docs/release-versioning.md`
- What changed:
  - `generate_versions.ts` no longer derives build metadata from ambient
    `GITHUB_*` vars unless explicitly asked via `--ci-build-metadata` or
    explicit metadata env vars.
  - Added `version:generate:ci` for workflows that are intentionally producing
    stamped CI artifacts.
  - Kept PR quality checks deterministic by forcing empty metadata on the
    stage-gate check path, while release build steps now opt into stamped
    metadata explicitly.
- Why:
  - Hidden GitHub-env behavior made `version:check` pass locally and fail in
    CI for the same commit, which is a bad contract for a stage gate.
- Tests:
  - Command:
    `GITHUB_RUN_NUMBER=2 GITHUB_SHA=70eacff790df06ff3b548aff3e2843883ddd6755 deno task version:check`
  - Result: passed
  - Command:
    `BUILD_METADATA=build.2.70eacff7 deno run -A scripts/generate_versions.ts --check`
  - Result: failed as expected, proving metadata stamping is now explicit
- Contracts/plans touched:
  - `docs/design-docs/versioning-and-release-plan.md`
  - `docs/release-versioning.md`
- Risks/TODO:
  - Any future workflow that wants stamped runtime versions must opt in
    explicitly; ambient GitHub env is no longer enough.

### 2026-03-17 - CI Now Codifies LMDB-js V1 Compatibility For KERIpy Interop

- Topic docs updated:
  - `.github/workflows/pr-stage-gate.yml`
  - `.github/workflows/keri-ts-npm-release.yml`
  - `packages/keri/test/integration/app/interop-kli-tufa.test.ts`
- What changed:
  - Added `LMDB_DATA_V1=true` to the KERI-interoperability workflows and bumped
    the dependency-cache key so old incompatible native-addon caches do not get
    silently reused.
  - Added a cache-miss setup step that runs `deno task setup` in
    `packages/keri`, which rebuilds `lmdb` from source with the project’s
    required v1 data-format compatibility.
  - Removed the remaining hardcoded maintainer-local package path from the
    single-sig interop test so CI can actually spawn `tufa` from the checked-out
    workspace.
- Why:
  - KERIpy store interop is a storage-format contract, not just an npm version
    pin. If CI restores or downloads an `lmdb-js` build without the v1 data
    format, compat-mode tests are operating against the wrong backend even when
    the JS package version looks correct.
- Tests:
  - Command: N/A in this macOS session for the Linux-specific CI/runtime seam
  - Result: workflow/test logic updated; next GitHub Actions run is the real
    verification point
- Contracts/plans touched:
  - `docs/design-docs/PROJECT_LEARNINGS.md`
- Risks/TODO:
  - The Linux Deno N-API panic may still need a runner/runtime pin if it proves
    independent of LMDB data-format compatibility; this change fixes the known
    missing contract first.

### 2026-03-17 - CI Split Stage Gate, Exact Pins, And Artifact Smoke Paths

- Topic docs updated:
  - `.github/workflows/pr-stage-gate.yml`
  - `.github/workflows/keri-ts-npm-release.yml`
  - `.github/workflows/cesr-npm-release.yml`
  - `.github/workflows/changesets-version-pr.yml`
  - `.github/workflows/macos-compatibility.yml`
  - `scripts/ci/assert-environment.sh`
  - `scripts/smoke-test-keri-npm.sh`
- What changed:
  - Pinned Deno exactly to `2.7.5`, Node exactly to `22.14.0`, and all
    third-party GitHub Actions to immutable commit SHAs.
  - Split the PR stage gate into parallel static-check, KERI-test, CESR-test,
    and npm-package-smoke jobs, then added a tiny aggregate `stage-gate` job so
    existing branch-protection check names can stay stable.
  - Added per-job `timeout-minutes`, explicit environment assertion output, and
    npm-tarball artifact uploads for PR, release, and scheduled compatibility
    paths.
  - Added a scheduled `macOS Compatibility` workflow that reruns the interop,
    test, package-build, and tarball-smoke surface on `macos-latest`.
  - Strengthened the npm smoke path so `keri-ts` can be smoke-installed
    alongside the just-built local `cesr-ts` tarball instead of silently
    falling back to whatever version is currently published on npm.
- Why:
  - One giant PR job hides where time and failures actually go, and changing
    required check names accidentally is an avoidable self-own.
  - Native-addon library repos get most of their CI pain from drift and
    packaging seams, so exact pins and saved artifacts are higher-value than
    adding still more generic checks.
- Tests:
  - Commands: `deno task fmt`, `bash -n scripts/ci/assert-environment.sh scripts/smoke-test-keri-npm.sh`, `deno task quality:check`
  - Result: passed locally
  - Command: `deno task npm:build:all`
  - Result: reached DNT's package-build/npm-install phase locally, but full end-to-end completion was not confirmed in this sandbox session
- Contracts/plans touched:
  - `docs/design-docs/versioning-and-release-plan.md`
- Risks/TODO:
  - The pinned action SHAs and scheduled macOS workflow still need live GitHub
    Actions confirmation because this local session cannot execute the hosted
    runners themselves.

### 2026-03-17 - KERI Test Parallelism Now Follows Isolation Boundaries

- Topic docs updated:
  - `scripts/ci/run-keri-test-group.sh`
  - `packages/keri/deno.json`
  - `deno.json`
  - `.github/workflows/pr-stage-gate.yml`
  - `packages/keri/test/integration/app/interop-gates-harness.test.ts`
  - `packages/keri/test/README.md`
- What changed:
  - Replaced the old monolithic `keri` quality-test invocation with explicit
    grouped lanes for DB-fast, app-light, app-stateful-A, app-stateful-B,
    interop parity, and split interop gate scenarios.
  - Added a documented CI runner script that encodes which groups are safe for
    `deno test --parallel` and which must stay isolated at file granularity.
  - Refactored the interop gate harness so ready scenarios are individual
    `Deno.test(...)` cases, making them filterable and CI-addressable instead
    of one long opaque test.
  - Updated the PR stage gate to fan KERI coverage out across multiple jobs
    instead of one catch-all `keri-tests` lane.
- Why:
  - The longest wall-clock bottleneck was the interop harness, not the average
    test file, and several CLI/app files mutate process-global state in ways
    that make naive `--parallel` usage flaky.
- Tests:
  - Commands:
    `deno task test:quality:keri:fast`,
    `deno task test:quality:keri:app-stateful-a`,
    `deno task test:quality:keri:app-stateful-b`,
    `deno task test:quality:keri:interop-parity`,
    `deno task test:quality:keri:interop-gates-b`,
    `deno task test:quality:keri:interop-gates-c`
  - Result: all passed locally
- Contracts/plans touched:
  - `docs/design-docs/PROJECT_LEARNINGS.md`
- Risks/TODO:
  - On a cold GitHub cache, the extra KERI job fan-out will increase duplicate
    dependency/bootstrap work before cache reuse stabilizes; the tradeoff is
    intentional because warm-cache PR latency is the dominant maintainer path.
