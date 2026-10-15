# V2 non-event admission

`dispatchEnvelope` consolidates protocol-v2 `qry/rpy/exn/xip/pro/bar` intake
before delegating to the existing processors. This corresponds to
`Kevery.processMsg` with KRAM disabled in unmodified KERIpy
`7143832813cac6a394ab1faf9be83bb3372be87c` (`core/parsing.py` and
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
explicit TEL query processor. Built-in legacy Tevery serves `tels`; `tsn` remains
explicitly refused until its producer and both receiving processors work. Replies
require cigars or transferable signature groups; exchanges also permit source
couples or triples. Reply/exchange processors verify their proofs and dependencies.

TEL replay captures management then optional credential extents from accepted
`Reger.tels.` without collecting body bytes, releasing each cursor before yielding.
Every complete message has an 8 MiB default assembly cap including its selector.
The frozen processor uses default v2 proof counters for both query body versions;
TypeScript prefixes an explicit v2 genus selector so v1 TEL bodies remain parseable.
Bodies, proof bytes and ordering are preserved. Missing TELs produce no response.
Frozen query signature validation is TODO: requester material identifies a
destination and does not itself authenticate the request. Sender policy and
optional KRAM remain independent; this is not v2 `RegistryStore` query support.
Whole-row reads still allocate before their size checks and retain phase 5 ownership.

Internal `prepareTsnQuery` prepares registry then optional credential reply data,
correlated to the query SAID, without publishing cues or enabling TSN dispatch.
Unknown registries return unavailable; absent credentials retain the registry
reply with a typed missing-credential diagnostic. Actual 714 parsed credential
queries emit the registry reply then fail: `processQuery` passes `vcpre=` to
`vcState(vci)`. TypeScript calls that actual positional helper instead. Independent
714 helper observations qualify the credential record, including its issuer KEL
anchor. State production does not authenticate a query, reply, or nested child;
TSN receiving still requires BADA, attester trust and accepted TEL correspondence.
Storage corruption and infrastructure errors propagate. Existing state helpers'
read costs remain separate from the two-reply output ceiling.

Reply BADA compares exact microseconds, as 714's datetime ordering does.
`Broker.retryStateNotices` captures a finite family horizon and processes 64 rows
per call by default (maximum 1024), releasing cursors before hydration or writes.
Typed keep/accept/drop outcomes update only the current index; artifacts remain
available to other dependency families. Failed callbacks and corrupt artifacts
propagate, preserving retry ownership. Insertions behind a checkpoint return next
pass; insertions beyond the horizon cannot extend that pass. TTL is inclusive.
The legacy exception adapter remains separate and must not drive TSN runtime retry.
Actual 714 registry replies store a TEL digest as Broker's current pointer, while
Revery indexes proof/timestamp metadata by the outer reply SAID: a direct parsed
probe accepted an older signed reply. Receiving must instead retain the outer
reply SAID for BADA; state production and TSN dispatch guards remain unchanged.

Built-in Reactor routes `/tsn/registry/{aid}` through independent reply proof,
strict attester trust, BADA and accepted legacy TEL correspondence. Trust comes
from accepted registry configuration/backers, issuer KEL witnesses or configured
watchers. Notice fields cannot confer trust: actual 714's strict handler accepted
a signed outsider notice that changed a genuine NoBackers registry to `c:[]` and
`b:[outsider]`. TypeScript rejects this and checks notice metadata against current
accepted state; receiver-generated record time remains descriptive.

Missing issuer or TEL state uses durable Broker dependency families; missing or
partial attester proofs also belong to Broker. This receiver explicitly selects
Revery's external escrow ownership, so pending proofs never enter legacy `rpes.`
retry. Default Revery callers retain their existing behavior. Every finite retry
rechecks trust, proofs and state; expiry retains the original notice timestamp.
Previous BADA evidence remains until semantic publication succeeds. Pending
proof copies belong only to Broker; terminal semantic refusal disposes the new
unaccepted Baser proof without removing accepted or Broker-owned evidence. The saved
pointer is the outer reply SAID, and `txnStateSaved` reaches the host as a notify
emission. Recovery uses existing bounded query coordination, retaining exact TEL
`ri/i/src` fields. Storage/invariant failures propagate. Credential TSN receiving
also uses this proof ownership and accepted-trust boundary.
TSN queries publish an ordered registry/credential pair; this is not v2
`RegistryStore` receiving.

Credential `/tsn/credential/{aid}` independently verifies registry availability,
attester proof and the credential's current accepted TEL record. Its registry,
state/digest, event timestamp and KEL/registry anchor commitments must match;
accepted revocation prevents a later notice from resurrecting issuance. Actual 714
accepts signed forged KEL-anchor metadata and old issuance notices after revocation;
these refusals and the outer-SAID BADA pointer are intentional TS corrections.
Missing registry, issuer/proof and credential TEL use finite `credential-mre/mae/ooo`
Broker families and existing query delivery. Reopen/retry rechecks accepted state;
no parent proof confers credential acceptance. Existing `vcState` row hydration
costs remain inherited, not a shared-memory qualification.

The TSN cue serializer appends the signing habitat's attester prefix to each base
route. Actual 714 emits bare TSN wire routes although its receivers require that
suffix; this repair complements the recorded `vcState(vci)` query correction.
Missing credentials return only the registry notice; no response or HTTP success
proves acceptance. Direct HTTP capture retains at most the complementary pair.
Admitted cue fanout retains owner credit through response EOF/cancel/failure and
source cleanup, even without an initial pull. Ordinary single-replay capture stays
unchanged; separate receiver checks decide both notices. Query requester material selects
the destination; actual 714 still leaves query signature validation TODO.

Legacy TEL/TSN ordinals above `Number.MAX_SAFE_INTEGER` are explicitly refused;
protocol `NumberPrimitive` supports wider values, so this is not all-number parity.

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

Internal `stageKram` publishes cache and partial factors atomically after rechecking
sender establishment and replay state. On threshold completion it reconstructs
evidence and removes partial factors and snapshots before downstream consumption.
The cache remains as the replay marker, matching KERIpy removal-before-delivery.
Same-index signature variants retain their encoding while thresholds count unique
indices. Factor merging has no application byte/item quota or fixed signature-pool
cap; decoded row validity and signature verification remain required. Rotation
clears stale partials without removing the replay cache.

`KramHandoff` keeps its local busy scope through staging, consumption and joined
hydration disposal. No ready receipt store or downstream acknowledgement exists.
Consumer and disposal errors propagate; they cannot revive accepted input. Actual
hydration owners still require the callback scope until snapshot removal. Callback
results must not retain borrowed frame/payload owners. Active scopes exclude
synchronous pruning through final cleanup; this is resource lifetime, not durable
application delivery.

Internal `KramPruner` advances finite MSGC/TMSC/opener passes with no read cursor
held across writes. Stored pruning windows retain inclusive microsecond cutoffs;
expired idle rows atomically release factors, private snapshot.
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
No automatic ESSR decryption or child dispatch is enabled. Disclosed IPEX
presentation registries use the retained trusted receipt; hidden and unfinished
graph paths remain guarded under the [IPEX contract](IPEX.md).

Completed KRAM intake passes receiver time explicitly through parser dispatch;
disabled, exempt and v1 forwarding supply no KRAM time. This is local composition
data, not a branded capability or a field extracted from signed wire. Exchanger retains
the first qualified `receiverTime` in private exchange metadata with accepted or
dependency-escrow evidence, supplies it to route verification/handling and reuses
it on retry/reopen. Signed `dt` and later local receipt values cannot replace it. Archive
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
