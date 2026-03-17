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
- Why:
  - A PR status check only protects `master` if the workflow exists, runs on PR
    events, and exercises the same interop-sensitive test surface maintainers
    expect locally.
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
