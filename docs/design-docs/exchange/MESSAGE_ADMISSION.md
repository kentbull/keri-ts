# V2 non-event admission

`dispatchEnvelope` consolidates protocol-v2 `qry/rpy/exn/xip/pro/bar` intake
before delegating to the existing processors. This corresponds to
`Kevery.processMsg` with KRAM disabled in unmodified KERIpy
`927c0cb8794d7c84fc17143c67df64aab9deda6c` (`core/parsing.py` and
`core/eventing.py`). KRAM is disabled by default and explicitly configurable at runtime.

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
reference, which stores pending transitions only in memory. Cache policy remains
internal; cache windows are not a shared runtime budget.

Internal `authenticateKramSource` returns valid, known-invalid, or missing-state
source decisions. It checks the last source couple or sender-matching triple
against the accepted sender KEL digest and an event seal containing the message
SAID. Foreign triples and child proofs remain independent. Known-invalid source
results remain eligible for later signature fallback; missing state blocks it.
Missing coordinates retain `bigint` precision, including beyond the database's
safe-number range; intake emits exact hexadecimal missing-state queries.
This read-only helper emits no cues and enables no public Kramer/runtime intake.

Internal KRAM time plans preserve inclusive microsecond admission/lifetime windows,
XIP own-SAID openers, sender-local/shared XID precedence and original cached windows.
Completed replay is refused before source queries; multi-key partials remain resumable.
Transaction `rdt` records receiver-observed completion time, distinct from message
`mdt`, and remains frozen on ready handoff retries. Plans publish no state: intake
must atomically recheck policy, current keys, caches and durable readiness before
publishing cache/opener/receipt, partial factors and snapshot together.

Internal `verifyKramSignatures` normalizes sender triples/last groups on cloned
factor arrays, verifies only current sender factors and returns the borrowed
normalized envelope. `verified` means at least one valid cigar or indexed
signature, never threshold satisfaction. Frozen factor ordering and qb64-based
deduplication retain distinct encodings at one index; intake must use unique
signer indices for threshold satisfaction. Prior sender groups are removed from
forwarding and retained only as historically verified diagnostics. Foreign groups
and children remain independent. These helpers publish no intake state or queries
and do not change existing parser/v1 normalization.

Internal `stageKram` publishes the parent cache, current sender pool/state, scalar
factors, private snapshot and first-ready RFC3339 receiver receipt in one transaction.
It rechecks authentication, current establishment, policy/cache and original ready
receipt after asynchronous acquisition; concurrent snapshot replacement is refused.
Rotated partials lose their evidence but retain replay cache. Same-index signature
variants survive storage while thresholds and later accumulation use unique indices.
Ready consumption remains scoped through joined hydration, and its generic return
value must contain no untransferred frame/payload owner. Consumer/disposal failures
retain durable readiness for at-least-once handoff. A separate handoff owner must
acknowledge the exact ready receipt/body only after disposal; no public Kramer or
runtime intake is enabled here. Finite collection limits are not a shared budget.

Internal `KramHandoff` holds its local busy permit through atomic staging,
callback consumption, joined hydration disposal and acknowledgement. Private
`kready.` freezes the first ready receiver timestamp for retries, including
nontransaction messages whose interoperable cache has no receipt field.
This retryable handoff extends frozen KERIpy's removal-before-delivery behavior.
Failures preserve durable readiness; successful acknowledgement compares the
receipt, key and exact parent body before removing partial factors and snapshot.
Replay caches remain, and neither parent nor child is accepted by this wrapper.
Callbacks return non-owning values and consume/adopt plaintext within their scope,
disposing untransferred owners in finally. Callback effects and owner adoption
are at least once: disposal or acknowledgement failure can replay delivery and
does not roll back prior effects. Local busy guards supply no shared runtime budget.
An active-scope count shared by Baser excludes synchronous pruning through final
cleanup. Pruning must check before its read/mutation batch and must not yield.

Internal `KramPruner` advances finite MSGC/TMSC/opener passes with no read cursor
held across writes. Stored pruning windows retain inclusive microsecond cutoffs;
expired idle rows atomically release factors, private snapshot and ready receipt.
Live handoff scopes sharing a Baser defer pruning. Shared XDT disappears only
after a bounded global TMSC scan proves no participant remains. Committed writes
restart that proof and reopen resets checkpoints; unrelated writes can postpone
orphan cleanup, favoring safety over progress. Rows inserted behind cache cursors
are visited next pass. This is maintenance exclusion, not a shared runtime budget.

Optional `createAgentRuntime({ kram })` composes the qualified policy, handoff and
finite pruner using the trusted services clock. Configuration must cover admitted
message types. V2 sender policy precedes all intake effects; v1 paths stay separate.
The ready transport consumer runs inside handoff before joined disposal and ack.
Callback results are void; Reactor returns only its original borrowed input. HTTP
refuses current pending, missing, busy and replay outcomes despite older cues.
HTTP recovery queries enter the bounded coordinator and drain on ordinary host turns.
No automatic ESSR decryption or child dispatch is enabled; presentation-registry
cutoff processing remains separately guarded.

Completed KRAM intake lends private envelope-bound receipt authority only within
the ready consumer. Disabled, exempt and v1 forwarding cannot confer it; forged,
expired or differently bound capabilities fail as caller misuse. Exchanger retains
the first qualified `receiverTime` in private exchange metadata with accepted or
dependency-escrow evidence, supplies it to route verification/handling and reuses
it on retry/reopen. Signed `dt` and public caller strings cannot replace it. Archive
publication rechecks the previous receipt under the writer transaction; competing
changes and corrupt stored timestamps propagate. Frozen 927 IPEX registry cutoff
selection reads completed TMSC `rdt` and refuses missing/partial receipts; this
private persistence strengthens retention across pruning without changing wire tables.

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
