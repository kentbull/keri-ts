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

### 2026-03-03 - CI Formatter Policy Locked to `deno fmt`

- Topic docs updated:
  - `.github/workflows/ci.yml`
  - `.github/workflows/keri-ts-npm-release.yml`
  - `.github/workflows/cesr-npm-release.yml`
  - `.github/workflows/changesets-version-pr.yml`
- What changed:
  - Added a dedicated CI workflow that runs `deno fmt --check` on PRs and
    pushes to `master`.
  - Added a workflow-policy guard that fails if CI workflow files reference
    non-Deno formatters (`prettier`, `biome`, `dprint`).
  - Added explicit `deno fmt --check` steps to existing release/version
    workflows.
- Why:
  - Ensure formatting policy is enforced consistently across CI entry points and
    prevent accidental formatter drift.
- Tests:
  - Command: `rg -n "deno fmt --check|prettier|biome|dprint" .github/workflows/*.yml`
  - Result: `deno fmt --check` present in all workflow paths; non-Deno
    formatter references only appear in the new policy-guard regex.
- Contracts/plans touched:
  - N/A
- Risks/TODO:
  - If additional workflow files are added later, they should keep this
    formatter policy and pass the guard.
