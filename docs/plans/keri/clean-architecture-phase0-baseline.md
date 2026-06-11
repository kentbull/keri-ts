# keri-ts Clean Architecture Phase 0 Baseline

## Purpose

Phase 0 exists to make the clean architecture refactor measurable before large
code movement begins. The refactor should improve readability and boundaries
without changing KERI behavior, CLI command availability, release mechanics, or
test expectations.

## Current CLI Dispatch State

The current CLI is cleaner than the original refactor inventory assumed.
`packages/tufa/src/cli/handlers.ts` is now a thin re-export of
`createCmdHandlers` from `packages/tufa/src/cli/command-definitions/shared.ts`.
Command definition modules register both Commander parse-time actions and lazy
run-time handlers through the same registration path.

That means the command registry is no longer a hand-maintained mirror of the
command tree. This is a real architectural improvement and Phase 0 should
protect it instead of replacing it.

The existing `packages/tufa/test/cli.test.ts` guardrail already verifies:

- every parsed leaf command in the Commander tree has a registered handler
- every registered handler corresponds to a parsed leaf command
- the current dispatched command count is 67, excluding the local `version`
  command
- representative parse examples exist for each dispatched leaf command
- renamed IPEX runtime flags such as `--approval-timeout`, `--poll-turns`, and
  `--poll-budget-ms` dispatch through the CLI selection layer

Verdict: the command registry problem is already addressed well enough for Phase
0. The remaining Phase 0 work is to baseline structural debt and make drift
visible.

The baseline reporter also scans command definition source and currently finds
66 literal registration names. That static count is expected to be one lower
than the executable 67-command test because `exchange.send` and `exn.send` share
a helper that receives one command name through a typed parameter. Do not treat
the static count as the enforcement mechanism.

## New Baseline Tooling

Use the repo-local clean architecture reporter for Phase 0 snapshots:

```sh
deno task clean-architecture:report
deno task clean-architecture:check
```

The report covers the CLI-down architecture path:

- `packages/tufa/src/cli`
- `packages/keri/src/app/cli`
- `packages/keri/src/app`
- `packages/keri/src/core`
- `packages/keri/src/db`
- `packages/keri/src/vdr`
- `packages/keri/src/acdc`
- `packages/cesr/src`

The existing `quality:report` remains useful for general code-size inspection,
but it does not cover `packages/tufa/src`, so it cannot be the primary Phase 0
baseline for CLI-first architecture work.

Current baseline snapshot from `deno task clean-architecture:report` on
2026-06-11:

| Area                                  | Files |  Lines | Estimated Code Lines |
| ------------------------------------- | ----: | -----: | -------------------: |
| `packages/tufa/src/cli`               |    24 |  5,437 |                4,823 |
| `packages/keri/src/app/cli`           |    32 |  9,079 |                7,828 |
| `packages/keri/src/app` excluding CLI |    37 | 16,807 |               12,919 |
| `packages/keri/src/core`              |    23 | 11,149 |                8,473 |
| `packages/keri/src/db`                |    15 | 10,134 |                7,090 |
| `packages/keri/src/vdr`               |     3 |  1,752 |                1,576 |
| `packages/keri/src/acdc`              |     2 |    684 |                  617 |
| `packages/cesr/src`                   |    93 | 19,296 |               14,389 |

Largest current CLI-down hotspots:

| File                                    | Lines | Estimated Code Lines |
| --------------------------------------- | ----: | -------------------: |
| `packages/keri/src/app/cli/multisig.ts` | 1,624 |                1,497 |
| `packages/tufa/src/cli/mailbox.ts`      | 1,175 |                  987 |
| `packages/keri/src/app/cli/ipex.ts`     | 1,055 |                  972 |
| `packages/keri/src/app/cli/vc.ts`       |   899 |                  823 |
| `packages/keri/src/app/delegating.ts`   |   855 |                  689 |

Current CLI boundary side-effect signals:

| Signal          | Occurrences |
| --------------- | ----------: |
| console output  |         175 |
| sync file read  |           8 |
| sync file write |           7 |
| prompt          |          11 |
| habery setup    |          32 |
| agent runtime   |          20 |
| runtime loop    |          10 |
| mailbox turn    |           7 |

## Guardrails

Phase 0 guardrails are deliberately narrow:

- no runtime behavior changes
- no public API changes
- no command surface changes
- no changes to KERI event, delegation, multisig, IPEX, ACDC, witness, mailbox,
  DID, or database semantics
- keep the derived command registry as the source of truth
- keep the existing command registry parity test passing
- track large-file and large-symbol hotspots before and after refactor phases

`deno task clean-architecture:check` currently verifies that the CLI registry
parity guardrail remains present in the tufa test suite. It intentionally does
not fail on size metrics yet because this phase is about capturing a baseline,
not ratcheting thresholds.

## First Refactor Targets After Phase 0

Start where the user-facing flow is hardest to read:

- CLI command modules that mix parse shape, file IO, runtime setup, polling, and
  output formatting
- `packages/keri/src/app/cli` operation functions with long procedural bodies
- delegation, multisig, IPEX, credential, mailbox, witness, and DID workflows
  where behavior must remain KERIpy-compatible but code location does not need
  to mirror KERIpy
- application services that can accept explicit dependencies from thin CLI
  adapters

The real problem is not command registration anymore. The real problem is
workflow orchestration code that still carries too many responsibilities in one
function.

## Phase 0 Exit Criteria

Phase 0 is complete when:

- the clean architecture reporter exists and can be run locally
- the reporter includes the current CLI command registry parity state
- the baseline document records that the registry is already derived from command
  definitions
- the existing tufa CLI registry test is treated as the authoritative command
  surface guardrail
- formatting, linting, quality checks, tufa quality tests, and changeset checks
  pass for this documentation/tooling change
