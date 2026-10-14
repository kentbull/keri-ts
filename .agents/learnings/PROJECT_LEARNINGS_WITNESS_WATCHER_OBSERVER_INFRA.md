# Infrastructure and qualification learnings

## Honest test evidence

The maintained inventory in scripts/ci/keri-test-suites.ts owns files; the runner
enforces missing/duplicate/unowned coverage. Audit is not execution. Parallelize
only truly isolated files; runtime/server/stateful/interop lanes stay serial until
their assumptions change. Preserve participant topology and distinct semantic
assertions. Delete redundant permutations; byte-at-a-time parsing already visits
each token boundary, so do not reverify signed trees at every two-chunk split.
Large-input regressions need to exceed the faulty threshold, not repeat
increasingly large allocations. Partition checks use bytewise input plus selected
coalesced/semantic edges, retaining version/domain/error facts and blocked-source
assertions. Configurable integration limits may be small when native threshold
behavior has its own retained regression.

Witness harnesses use temporary copied configs and bind-checked randomized ports.
Track children before readiness waits and report their output on startup failure.
Probe OOBIs, not nonexistent health endpoints; resolve both controller and witness
OOBIs. Proved controller/witness combinations do not imply untested KLI replacement
or arbitrary topology. The six-witness soak is manual, outside merge CI.

Verify Python interpreter, revision and actually imported modules. Console entry
exit status matters: python -m can ignore main's return. Explicitly select body
protocol and replay genus. Current witness CLI lacks protocol selection, so v1
fixtures use public Habery/setupWitness APIs. Fork-on-main and upstream evidence
remain separate. Source-root startup probes compare every loaded KERI module to
pinned Git bytes; installed hashes alone do not prove Git equivalence. Qualify
command-specific lazy imports separately. macOS PATH and shared helpers select
one explicit fork checkout; DID Webs retains a separate dependency environment
in the [reference inventory](../../docs/plans/qualification/REFERENCE_ENVIRONMENTS.md).

LMDB V1 needs its own native rebuild/preflight and cache boundary. On macOS,
provision libsodium independently of cached venvs; expose the resolved Homebrew
dylib without overwriting a conflict, verify actual loading and keep KLI import
assertions. /bin/bash scrubs DYLD variables, so GITHUB_ENV alone is insufficient.

## Packaging and release

Use dprint and deterministic version generation in checks; opt into build metadata
only for artifacts. Build helpers are real source files, not multiline JS/TS in
shell/workflow strings. Keep inline-code:check and export docstring checks honest.

The package graph is tufa → keri-ts → cesr-ts. Derive manifest exports/bin from DNT
output and assert packed targets. Install all three local tarballs once per runtime
image (including macOS); run the installed Tufa bin without npx fallback. Source
tests do not qualify package resolution or Node hosting. Require Node >=20.3 in
all generated manifests; qualify the declared floor and current runtime without
compatibility flags. Node 18 is a historical target, not a release gate.

Npm publish and GitHub Release creation are separate seams. Reruns skip existing
exact versions, use the uploaded tarball's dependency metadata, edit existing
release state and upload assets idempotently. Do not describe the old scope-access
blocker as current publication status; verify live state before release claims.

## Remaining qualification

The [qualification plan](../../docs/plans/qualification/QUALIFICATION_PLAN.md) owns
the full inventory and two fresh-process 16/256 MiB production observations.
Gigabyte/repeated matrices and historical reruns are deferred; enlarge only to
resolve an anomaly and do not claim statistical or unmeasured scale evidence. Long hosted jobs
remain maintainer-dispatched with the existing 15-minute cap, outside required
merge CI. Record failures/skips and variance; parser-only timing does not prove
production memory bounds. [Runtime learnings](PROJECT_LEARNINGS_RUNTIME.md) own
signal/SSE shutdown, and [storage learnings](PROJECT_LEARNINGS_STORAGE.md) own
LMDB process and allocation boundaries.
