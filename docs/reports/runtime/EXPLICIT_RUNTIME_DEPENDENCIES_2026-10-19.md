# Explicit runtime dependencies: qualification

Date: 2026-10-19. Status: complete; all 19 full-battery jobs passed.

## Verified source

- Implementation baseline: `137e23d756f4b8fc1a9996517d576827bfcefb51`.
- Final implementation on master: `564e28c2c62a21eb1daf4f6223a012af5908f8e7`.
- Clock PR head: `a78fe651342ff81443917da4bd55648c6821e2f9`.
- Both have source tree `1198654377267c590e22f2abf398cc024a47ca3a`.
- [Full post-merge CI, attempt 2](https://github.com/kentbull/keri-ts/actions/runs/39337935494/attempts/2)
  was requested after all four implementation PRs merged. The PR event and merged
  master contain the same source; qualification is tied to that tree.

## Delivered changes

| PR                                                   | Cohesive change                                                                                          |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [#544](https://github.com/kentbull/keri-ts/pull/544) | Direct HTTP-only dependencies, standalone clock contract and explicit verifier construction              |
| [#545](https://github.com/kentbull/keri-ts/pull/545) | Direct delivery/mailbox dependencies and clocks outside TCP/SSE options                                  |
| [#546](https://github.com/kentbull/keri-ts/pull/546) | Explicit application composition, removal of the aggregate/default resolver and migration of all callers |
| [#547](https://github.com/kentbull/keri-ts/pull/547) | Consistent injected wall time for verifier admission, webhook headers and expiry                         |

RuntimeServices, RuntimeHttpClient, defaultRuntimeServices, resolveRuntimeServices,
fakeRuntimeServices and runtime-services.ts are removed. Required collaborators
are ordinary constructor/function arguments; policy and optional store acquisition
remain with composition. No replacement container, service registry, alias or
forwarding hierarchy was added.

The JavaScript installed TCP consumer was outside the initial TypeScript caller
inventory. Package smoke exposed its old argument order; #546 migrated it to the
explicit systemClock argument and retained its real send/close assertions.

## Validation

- Phase 1: 77 focused HTTP/OOBI/verifier tests, plus OOBI/verifier CI workflows.
- Phase 2: 130 focused delivery, query, mailbox, receipt, delegation, TCP/SSE and
  Tufa bridge tests, plus witness/delegation/mailbox CI workflows.
- Phase 3: 68 focused composition/CLI/HTTP tests and all KERI test-source type checks,
  plus DID/KRAM/IPEX and installed-package CI.
- Phase 4: five verifier tests. The new wall-clock regression fails against the
  previous implementation. Tests assert actual persisted Daters, advancing headers,
  strict expiry boundaries and both accepted TEL revocation paths.
- Formatting, lint, quality/type and release-intent checks passed on each phase.

Full post-merge CI selected unit targets ci, tufa, cesr and ci-tools; all passed.
All 14 maintained interoperability owners passed: parity, both keystore owners,
OOBI, verifier, extended/deep ACDC, IPEX disclosure, delegation, both witness owners,
mailbox, KRAM and DID Webs. Static checks, release-intent validation, installed
packages and the final stage gate passed. None of the full-run lanes was skipped.

The final installed packages passed on Node 20.3.0 and Node 26.12.0, including
strict NodeNext declarations, native LMDB reads/reopen above 16 MiB, signing and
tamper refusal, TCP transmission and joined socket cleanup. The combined package
lane also exercises the maintained CESR and Tufa installed consumers.

## Contracts and limits

Required HTTP/clock/transport implementations are selected at the application
root; subordinate owners do not choose fallback implementations. Existing worker
lifetimes, borrowed-store ownership, transport cancellation, routing, wire framing,
media negotiation and retry policy remain intact. No participant topology was
reduced to make tests pass.

Verifier admission timestamps remain epoch wall time across reopen. Credential/TEL
payload timestamps remain source evidence. Expiry remains strictly greater than
the configured window, and ready sending still precedes post-refusal expiry.
Expired work can be rediscovered by the existing scans; no new terminal-expiry
policy is claimed.

Public API removals carry major changesets; the clock correction carries a patch
changeset. No release or version-PR merge was performed. Manual endurance sweeps
are outside the maintained full battery and this refactor's scope.

The [plan](https://github.com/kentbull/keri-ts/blob/fb981fab/docs/plans/runtime/explicit-runtime-dependencies.md) retains phase
boundaries and acceptance criteria. This report records completed qualification;
subsequent documentation-only handoff edits do not change the tested runtime.
