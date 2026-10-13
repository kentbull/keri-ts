# V2 non-event admission

`dispatchEnvelope` consolidates protocol-v2 `qry/rpy/exn/xip/pro/bar` intake
before delegating to the existing processors. This corresponds to
`Kevery.processMsg` with KRAM disabled in unmodified KERIpy
`927c0cb8794d7c84fc17143c67df64aab9deda6c` (`core/parsing.py` and
`core/eventing.py`). KRAM intake remains unimplemented.

## Policy and responsibility

`AgentRuntimeOptions.messagePolicy` configures the runtime Reactor's Kevery.
A standalone Reactor or Kevery accepts the same option. Construction copies
`allowList` and `denyList`; the Kevery owns the mutable sets thereafter.
Policy uses the body's claimed `SerderKERI.pre`: denial wins, a nonempty allow
set restricts other senders, and an empty allow set imposes no restriction.
Filtering precedes proof prerequisites and route processing. It does not
authenticate the sender, affect v1/KEL/TEL/ACDC intake, revoke accepted state,
or erase existing escrows.

Queries prefer the last transferable last-establishment group. V2 queries with
raw indexed signatures fall back to the claimed sender. Missing requester
material is refused. `logs/ksn/mbx` delegate to Kevery; `tels/tsn` require an
explicit TEL query processor. The built-in Tevery lacks that processor, so these
routes report `missingProcessor` unless a caller supplies one. Replies require
cigars or transferable signature groups; exchanges also permit source couples
or triples. Processors still verify signatures, dependencies and route semantics.

Admission refusals return `MessageDropDecision`. Frozen `xip/pro/bar` processors
are stubs: they report `referenceStub`, never acceptance. Route-specific decisions
retain their meanings; an absent decision is not evidence of acceptance.
Infrastructure failures and cancellation propagate unchanged.

Internal `KramPolicy` selects exact ilk/route, ilk, then catchall cache records.
Exemptions retain frozen compact-prefix semantics, including V2 OOBI replies;
they bypass only KRAM, leaving sender policy and downstream verification intact.
Invalid configuration and coverage holes fail before publication. Acceptance
expansions wait for receiver-clocked delays; pure decreases apply immediately.
Active acceptance and pruning remain ordered, and existing drift stays fixed.
Atomic `ctyp.`/private `hbys.` transition metadata survives reopen and refreshes
stale owners. These restart and active-window guarantees strengthen the frozen
reference, which stores pending transitions only in memory. No Kramer intake or
runtime enablement is exported; cache windows are not a shared runtime budget.

Internal `authenticateKramSource` returns valid, known-invalid, or missing-state
source decisions. It checks the last source couple or sender-matching triple
against the accepted sender KEL digest and an event seal containing the message
SAID. Foreign triples and child proofs remain independent. Known-invalid source
results remain eligible for later signature fallback; missing state blocks it.
Missing coordinates retain `bigint` precision, including beyond the database's
safe-number range; the eventual intake owner emits exact hexadecimal queries.
This read-only helper emits no cues and enables no public Kramer/runtime intake.

Internal `verifyKramSignatures` normalizes sender triples/last groups on cloned
factor arrays, verifies only current sender factors and returns the borrowed
normalized envelope. `verified` means at least one valid cigar or indexed
signature, never threshold satisfaction. Frozen factor ordering and qb64-based
deduplication retain distinct encodings at one index; intake must use unique
signer indices for threshold satisfaction. Prior sender groups are removed from
forwarding and retained only as historically verified diagnostics. Foreign groups
and children remain independent. These helpers publish no intake state or queries
and do not change existing parser/v1 normalization.

## Ownership and HTTP

Dispatch borrows the envelope, including separate parent and child proof owners.
Reactor awaits dispatch and joins frame disposal before returning. Its guarded
consumer receives both the envelope and dispatch decision. HTTP query response
authorization checks the current refusal as well as exact mailbox signatures;
an older matching query cue cannot override a refused request. Nested-route
normalization guards remain in force.

[Signed reference vectors](../../../packages/keri/test/fixtures/keripy-admission-vectors.json)
record upstream delegation and prerequisite failures, not downstream verification.
Their adjacent generator verifies imported module bytes against the frozen commit.
[Runtime regressions](../../../packages/keri/test/unit/app/message-admission.test.ts)
cover real acceptance, invalid signatures, refusal and joined owner disposal;
[Tufa ingress tests](../../../packages/tufa/test/progressive-ingress.test.ts) cover
HTTP readmission. Remaining KRAM/presentation work belongs to [3f](../../plans/exchange/EXCHANGE_ADMISSION_PLAN.md).
