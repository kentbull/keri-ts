# Aggressive Test Optimization Plan

## Summary

- Optimize in this order:
  1. make the KERI runner truthful
  2. remove repeated setup overhead
  3. split mixed-speed files into fast vs slow lanes
  4. simplify the remaining slow test files
- Do not start with clever global fixtures or a large harness rewrite.
- Keep the default path honest: it must still cover mailbox behavior and
  interop, but only through representative tests.
- Move mailbox-heavy cross-host flows and full Gate E coverage into explicit
  slow lanes instead of letting them dominate normal local and PR runs.

## Execution Status (2026-04-08)

- Landed:
  - authoritative runner now lives in `scripts/ci/run-keri-test-group.ts`
  - `scripts/ci/run-keri-test-group.sh` is now only a thin wrapper
  - `test:quality`, `test:slow`, and `test` now share one explicit lane map
  - lane audit now checks every discovered KERI test case is assigned exactly
    once
  - lane ownership is now source-owned through `@file-test-lane` and
    `@test-lane` annotations in the KERI test files
  - mixed-speed files are split by exact test-name ownership
  - default path now includes Gate D and excludes Gate E
- Still pending:
  - timing-guided simplification of the older stateful files
  - deeper perf work after timing can be rerun in a stable local environment
- Important correction:
  - compat LMDB rebuild remains job/local setup owned. The runner should audit
    and orchestrate lanes, not silently rebuild native dependencies.

## Repo-Grounded State (2026-04-08)

- Recent branch history is mailbox-heavy. The current branch includes mailbox
  ingress, mailbox polling and timeout work, multipart CESR mailbox add, and
  mailbox architecture documentation.
- The repo currently contains 61 KERI `*.test.ts` files and 370 named
  `Deno.test(...)` cases.
- The old grouped shell runner covered only 31 of those 61 files, so the old
  default path was materially incomplete.
- The omitted surface was larger than the original draft plan claimed. Missing
  ownership included the recent mailbox/runtime files, witness/runtime files,
  core KEL/query/reply coverage, and `db/mailboxing.test.ts`.
- `interop-kli-tufa.test.ts` is now one of the biggest costs at roughly 85 to
  94 seconds wall clock. The expensive part is the mailbox scenarios, not the
  basic parity scenario.
- `interop-gates-harness.test.ts` now has ready B, C, D, and E scenarios, but
  the grouped runner still only exercises B and C.
- The new mailbox/runtime tests are materially expensive:
  `gate-e-runtime.test.ts` is about 70 seconds,
  `mailbox-runtime.test.ts` about 30 seconds,
  `challenge-runtime.test.ts` about 16 seconds,
  `forwarding.test.ts` about 16 seconds,
  and `agent-cli.test.ts` about 17 seconds.
- The older app-stateful tests are still slow and still matter:
  `habbing.test.ts` is about 63 seconds,
  `incept.test.ts` about 14 seconds,
  `cli.test.ts` about 9 seconds,
  `list-aid.test.ts` about 5 seconds,
  and `export.test.ts` about 4 seconds.
- Compat LMDB setup is already job/local setup owned. The truthful fix here is
  lane ownership and orchestration, not runner-hidden rebuild work.
- `db/mailboxing.test.ts` is fast, about 1 second wall clock and about 50ms
  test time, so it is a lane-classification problem, not a test-speed problem.
- CESR still has slow exhaustive and fuzz-heavy files, but KERI mailbox/runtime
  and interop are now the dominant default-path problem.
- The repo now has an authoritative lane runner with one manifest-backed map,
  explicit `quality` vs `slow` ownership, and lane audit enforcement.
- Mixed-speed files are currently split by exact test names in the runner
  instead of by immediate physical file surgery.

## Verdict

- The main problem is not just slow tests. The main problem is a stale test
  topology: the grouped runner is incomplete, mailbox-heavy coverage has grown
  substantially, and setup overhead is being paid too many times.
- The first optimization win should be correctness of test ownership and simple
  orchestration cleanup. Optimizing individual slow tests before fixing that
  would optimize the wrong suite.

## Implementation Order

1. Make the runner truthful.
2. Remove repeated LMDB setup churn.
3. Split mixed-speed mailbox and interop files into fast and slow lanes.
4. Reclassify obvious fast files.
5. Simplify the remaining slow stateful files with local setup reuse.
6. Do the same style of split in CESR after KERI is under control.

## Runner And Lane Changes

- Replace the current recursive subgroup shell behavior with one authoritative
  KERI runner that:
  - assigns every discovered KERI test case to exactly one lane
  - runs groups without re-execing the entire script per subgroup
- Keep compat LMDB setup outside the runner. Validate ownership honestly, but
  do not hide native rebuild work inside the harness.
- Add a lane-audit check that fails if any KERI test file is unassigned or
  assigned more than once.
- Keep task shape simple:
  - `test:quality`: truthful default path
  - `test:slow`: mailbox-heavy runtime and interop coverage
  - `test`: `test:quality` plus `test:slow`

### Proposed Lane Ownership

- `db-fast`
  - existing fast DB tests
  - `db/mailboxing.test.ts`
- `app-fast`
  - help, version, validation, and other light tests
  - `server.test.ts`
  - the `--help` slice from `agent-cli.test.ts`
- `app-stateful`
  - `cli.test.ts`
  - `incept.test.ts`
  - `habbing.test.ts`
  - `list-aid.test.ts`
  - `export.test.ts`
  - `compat-list-aid.test.ts`
- `runtime-medium`
  - representative mailbox runtime and challenge coverage that stays on the
    default path
- `runtime-slow`
  - mailbox host startup and reopen
  - mailbox authorization and polling flows
  - full Gate E runtime convergence
  - the startup and reopen slices from `agent-cli.test.ts`
- `interop-basic`
  - basic KERIpy/TUFA parity
  - Gates B, C, and D
- `interop-mailbox-slow`
  - mailbox-specific interop
  - Gate E bootstrap and mailbox-heavy cross-host flows

### Landed Ownership Shape

- `db-fast`
  - DB core and wrapper files, now including `db/mailboxing.test.ts`
- `core-fast`
  - KEL/query/reply/core unit files that were previously omitted entirely
- `app-fast`
  - small integration/unit files plus the `agent-cli` help slice and forwarding
    alias-resolution slice
- `server`
  - `server.test.ts` on the truthful default path
- `runtime-medium`
  - representative mailbox/runtime/query coverage, plus the direct
    sign-query-rotate integration
- `runtime-slow`
  - agent reopen/startup, mailbox-heavy runtime flows, full Gate E convergence,
    and witness runtime hosting
- `interop-parity`
  - basic KERIpy/TUFA parity slice from `interop-kli-tufa.test.ts`
- `interop-witness`
  - witness interop plus local witness CLI integration coverage
- `interop-gates-b`
  - Gate B ready scenarios
- `interop-gates-c`
  - matrix assertion plus Gates C and D
- `interop-mailbox-slow`
  - mailbox interop slices plus Gate E

## File-Level Plan For Non-Fast Tests

### Mixed-Speed Files To Split First

- `interop-kli-tufa.test.ts`
  - keep only basic prefix/KEL parity in `interop-basic`
  - move both mailbox scenarios into `interop-mailbox-slow`
- `interop-gates-harness.test.ts`
  - keep Gates B, C, and D in `interop-basic`
  - move Gate E into `interop-mailbox-slow`
- `mailbox-runtime.test.ts`
  - keep mailbox start/provisioning and base-path routing in `runtime-medium`
  - move remote mailbox admin, challenge polling, and authorization behavior to
    `runtime-slow`
- `gate-e-runtime.test.ts`
  - keep config loading, parsing, serialization, and validation in
    `runtime-medium`
  - move host startup, OOBI bootstrap, mailbox querying, and convergence waits
    to `runtime-slow`
- `challenge-runtime.test.ts`
  - keep generate and direct controller round-trip in `runtime-medium`
  - move mailbox-authorized transport coverage to `runtime-slow`
- `forwarding.test.ts`
  - keep alias resolution in `app-fast` or `runtime-medium`
  - leave mailbox cursor and runtime behavior in `runtime-medium`
- `agent-cli.test.ts`
  - extract `--help` to `app-fast`
  - keep unencrypted startup and encrypted reopen in `runtime-slow`

### Older Stateful Files To Simplify After Lane Split

- `habbing.test.ts`
  - keep one full reopen/signing smoke
  - reuse habery setup within the file for smaller assertions
  - default helpers to the lightest valid config and only enable signator or
    config when required
- `incept.test.ts`
  - keep one real `init -> incept` smoke
  - start other happy-path cases from an already initialized store
  - keep pure validation failures as direct unit tests
- `cli.test.ts`
  - keep one subprocess smoke for entrypoint behavior and one for debug/loglevel
  - convert option and validation checks to in-process command tests
- `list-aid.test.ts`
  - create one initialized baseline store per file and reuse it
- `export.test.ts`
  - start from an initialized plus incepted baseline
  - keep one real export end-to-end smoke
- `compat-list-aid.test.ts`
  - build the compat store once per file and reuse it for read-only assertions

### Files To Reclassify Immediately

- move `db/mailboxing.test.ts` into `db-fast`
- move `server.test.ts` into `app-fast`

## Simple Harness Rules

- Prefer per-file prepared fixtures over any global shared fixture framework.
- Prefer in-process command tests unless the process boundary itself is what is
  being tested.
- Resolve `kli`, `tufa`, and compat LMDB build state once per interop file.
- Reuse one host per scenario block only when the assertions are about runtime
  behavior and not about cold-start behavior.
- Avoid introducing cross-file ordering dependencies.

## Test Cases And Acceptance Criteria

### Runner Truth

- every KERI `*.test.ts` file is assigned to exactly one lane
- lane-audit fails if a file is missing or double-assigned
- one top-level local run triggers compat LMDB setup at most once

### Default Path Coverage

- `test:quality` includes at least one mailbox runtime contract test
- `test:quality` includes at least one basic KERIpy/TUFA interop parity test
- `test:quality` includes Gates B, C, and D
- `test:quality` does not include Gate E or mailbox-heavy interop scenarios

### Slow Path Coverage

- `test:slow` includes mailbox CLI runtime flows
- `test:slow` includes mailbox-authorized challenge transport
- `test:slow` includes agent startup and reopen
- `test:slow` includes Gate E runtime and mailbox interop scenarios

### Performance Goals

- eliminate repeated setup overhead from grouped local runs
- materially reduce default local interop wall clock by removing mailbox
  scenarios from `interop-basic`
- materially reduce default runtime wall clock by moving Gate E and mailbox-
  heavy flows out of the default path
- reduce `habbing.test.ts` and the older app-stateful files after the lane split

### Stability Goals

- slow-lane mailbox and Gate E tests should fail in isolation, not because of
  cross-test contamination
- no file should depend on execution order across lanes

## Defaults And Assumptions

- No production public APIs should change in this optimization pass.
- The main interfaces that change are test tasks, lane ownership, and file
  organization for mixed-speed test files.
- Gate D stays on the default path because it is relatively cheap and high
  value.
- Gate E moves to the slow path because it is mailbox-heavy and materially
  slower.
- F and G remain out of scope for this optimization pass unless they become
  ready tests before implementation begins.
- Prefer reclassification and splitting over deep harness cleverness.
- Prefer local setup reuse over a large shared snapshot framework.
