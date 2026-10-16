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
A default KLI inception may poll before the witness knows its KEL. The pinned
KERIpy Poller reconnects after 30 seconds and retries one second later; its outer
command deadline must include that cycle. Preserve authorization and full receipt
assertions rather than treating the arrival order as a different topology.
Finite Python witness preparation uses Oobiery and the current Receiptor's normal
receipt endpoint. Legacy WitnessReceiptor expects mailbox receipt polling.
Stored clone replay includes verified witness receipts; msgOwnEvent does not.
KERIpy's lazy Kever map needs membership/indexed access after reopen; dict.get
can bypass hydration and falsely report missing accepted state.

Verify Python interpreter, revision and actually imported modules. Console entry
exit status matters: python -m can ignore main's return. Explicitly select body
protocol and replay genus. Current witness CLI lacks protocol selection, so v1
fixtures use public Habery/setupWitness APIs. Fork-on-main and upstream evidence
remain separate. Source-root startup probes compare every loaded KERI module to
pinned Git bytes; installed hashes alone do not prove Git equivalence. Qualify
command-specific lazy imports separately. macOS PATH and shared helpers select
one explicit fork checkout; DID Webs retains a separate dependency environment
in the [reference inventory](../../docs/plans/qualification/REFERENCE_ENVIRONMENTS.md).

LMDB V1 needs its own native rebuild/preflight and cache boundary. PR merge-ref
caches are invisible to later PRs: the master cache-warming workflow publishes
both existing dependency variants for reuse across branches. Native caches include
OS image, architecture, runtime versions, dependency locks and build/preflight sources;
a warm hit still proves the loaded addon uses NAPI and writes data-v1. On macOS,
provision libsodium independently of cached venvs; expose the resolved Homebrew
dylib without overwriting a conflict, verify actual loading and keep KLI import
assertions. /bin/bash scrubs DYLD variables, so GITHUB_ENV alone is insufficient.

Only pool interop files when their bootstrap is independent. Deep ACDC files share
one mutable pinned KERIpy venv: cold parallel setup races create/remove, so this
owner uses the runner's existing separate sequential processes. Preserve both
protocol scenarios and participant topology; no lock or new installer is needed.

PR scope uses the [existing suite owners](../../scripts/ci/keri-test-suites.ts)
and [description controls](../../docs/reference/PR_TEST_SCOPE.md). Exact-head local
unit credit avoids duplicate CI execution. Draft promotion does not rerun an
unchanged head; source pushes do. Selected interop/package checks retain
their real assertions and topology. A skipped lane is not execution evidence.
Periodic broad checks catch cross-feature regressions; full release qualification
still includes the maintained manual/endurance gates.

## Packaging and release

Use dprint and deterministic version generation in checks; opt into build metadata
only for artifacts. Package manifests are authoritative for both Deno version
mirrors and npm workspace-lock entries; manifest:check must reject either drift.
Sync workspace versions without re-resolving or changing npm dependency metadata. Build helpers are real source files, not multiline JS/TS in
shell/workflow strings. Keep inline-code:check and export docstring checks honest.

The package graph is tufa → keri-ts → cesr-ts. KERI's general entrypoints are root,
runtime and db; cli is the separate Tufa command-helper boundary. Runtime exports
are deliberate, not module wildcards. Do not publish app/core/db/vdr deep-import
patterns to expose implementation internals. Installed probes use named surfaces.
Derive every manifest export/bin
from DNT output, including host/kernel and protocol-handler imports/declarations;
fixed layout guesses can break advertised subpaths while the CLI still works.
Assert packed targets. Strict installed NodeNext checking must pass without
skipLibCheck. LMDB 3.5.3's ESM declaration uses export assignment; normalize emitted
type-only imports to its valid CommonJS declaration branch, preserving ESM values.
DNT omits source resolution attributes. Keep Baser.env tied to LMDBer's own type.
Install compiler tools after runtime smoke so they cannot mask missing dependencies.
The packed consumer must actually read/reopen a >16 MiB native LMDB row and retain
owned bytes across later writes, sign/refuse altered data and transmit/close real
TCP. Module loading alone does not qualify those installed runtime paths.
Install all three local tarballs once per runtime
image (including macOS); run the installed Tufa bin without npx fallback. Source
tests do not qualify package resolution or Node hosting. Require Node >=20.3 in
all generated manifests; qualify the declared floor and current runtime without
compatibility flags. Node 18 is a historical target, not a release gate.
Installing CESR as a separate global root for Tufa smoke tests requires its
declared optional Effection peer at that root; an ordinary Tufa-only installation
owns the dependency tree. Keep the CESR core dependency graph framework-neutral.

Npm publish and GitHub Release creation are separate seams. Reruns skip existing
exact versions, use the uploaded tarball's dependency metadata, edit existing
release state and upload assets idempotently. Do not describe the old scope-access
blocker as current publication status; verify live state before release claims.

## Remaining qualification

The [qualification plan](../../docs/plans/qualification/QUALIFICATION_PLAN.md) owns
the full maintained inventory and required manual/endurance evidence. Use
representative traffic and investigate actual anomalies; no mandatory 16/256 MiB
or gigabyte performance matrix remains. Do not claim unmeasured scale evidence.
Long hosted jobs remain maintainer-dispatched with the existing 15-minute cap, outside required
merge CI. Record failures/skips and variance; parser-only timing does not prove
production memory bounds. [Runtime learnings](PROJECT_LEARNINGS_RUNTIME.md) own
signal/SSE shutdown, and [storage learnings](PROJECT_LEARNINGS_STORAGE.md) own
LMDB process and allocation boundaries.
