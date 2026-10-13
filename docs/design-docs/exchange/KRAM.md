# KRAM authentication and replay admission

KRAM admits a protocol-v2 non-event message before its route processor runs.
`AgentRuntimeOptions.kram` and `Reactor` expose explicit configuration; omission
keeps the existing disabled path. A standalone `Kevery` may receive a `Kramer`.
The runtime uses its receiver clock. This is an authentication/timeliness boundary,
not exchange acceptance, credential acceptance, or a shared memory reservation.

## Why a separate boundary is needed

A sender can deliver different signatures for the same message in separate
requests. The parser can finish either request, but neither a parsed body nor
one valid signature establishes that the sender's threshold has been satisfied.
KRAM preserves the verified sender pool until the threshold is complete. Only
then does it lend the normalized envelope to the route processor.

Three responsibilities remain separate:

- The parser establishes framing and owns the received tree.
- KRAM authenticates the sender and checks replay/time windows.
- Revery, Kevery or Exchanger applies the route's own verification and dependencies.

For example, two individually parsed deliveries with signature indices 0 and 1
can satisfy a 2-of-3 sender. A foreign endorser's signature cannot fill that pool.
A completed parent threshold also cannot authenticate a nested child's signatures.

## Configuration and exemptions

```ts
const runtime = yield * createAgentRuntime(hby, {
  kram: {
    enabled: true,
    caches: { "~": [1000, 5000, 60000, 300000, 5000, 60000, 300000] },
  },
});
```

The seven values are milliseconds: drift, short acceptance lag, long acceptance
lag, exchange lifetime, short pruning lag, long pruning lag and exchange pruning
lifetime. Acceptance lags must satisfy `0 < sl <= ll <= xl`; pruning windows
must be at least their corresponding acceptance window. These values illustrate
an explicit deployment policy, not protocol-required defaults.

Cache selection prefers exact `ilk.R.route`, then `ilk`, then `~`. Missing
coverage is a configuration failure. `changeConfig` rejects coverage holes.
Decreases apply immediately with the existing drift; expansions retain the active
acceptance windows until the receiver-clocked delay expires. Pruning windows
change immediately. Existing rows retain the values captured when created.

Pending transitions are durable private metadata in `hbys.`. Reopening cannot
prematurely install an expanded acceptance window. Policy owners refresh that
metadata before reconciliation and refuse a concurrent conflicting publication.
Omitting caches on reopen preserves the existing configuration; supplied caches
request a validated transition. Enabled state and exemptions are constructor policy.

Despite the frozen name `denials`, these entries exempt messages from KRAM;
they do not deny the sender or bypass downstream verification. They retain the
reference's compact prefix semantics. A route with an empty type is not a type
wildcard. V2 `/end/role` and `/loc/scheme` replies are exempt by default because
BADA owns their acceptance. Sender allow/deny policy still runs first.

## Authentication and historical references

The last sender-implied source reference names an accepted event in the sender's
KEL. Its sequence number and digest must match, and that event must contain a
seal of the message SAID. Matching sender source triples normalize to couples.
A valid source seal wins. An invalid known seal can fall back to signatures;
a missing referenced event requests that exact sender event and blocks fallback.
The request uses the existing runtime query cue seam.

Signature authentication uses current sender keys. Matching last-establishment
groups fold into the sender pool; explicit groups count only when they name the
current establishment event. Prior sender groups and invalid sender signatures
are scrubbed. A matching nontransferable cigar can authenticate directly. Key
cardinality selects the short or long lag; the actual threshold still decides
whether a multi-key sender is complete.

Foreign explicit groups, cigars, source triples and other factors remain separate.
Pathed rows retain raw bytes; decoding arbitrary binary as UTF-8 would merge or
corrupt different members before retry.
A known foreign last group is frozen to its establishment event at receipt so
rotation cannot reinterpret it later. An unknown foreign last reference retains
missing-state metadata rather than acquiring a future historical coordinate.
Exchanger still owns supplemental-proof selection and strictness.

## Replay and receiver-observed time

Nontransaction messages use `msgc.` keyed by sender and SAID. V2 exchanges with
nonempty `x` use `tmsc.` keyed by sender, exchange id and SAID; `xip` uses its own
SAID as the exchange id. This cache support does not implement the reference's
stub `processXip` consumer.

An equal or retrograde message timestamp is refused unless the matching partial
sender pool exists. Rotation invalidates that pool while retaining the replay
marker. The exchange opener comes from the sender's existing thread, the shared
`xdt.` row, or the opening message. An unknown-thread reply is refused.
Timeliness and exchange-lifetime boundaries are inclusive.

`TxnMsgCacheRecord.rdt` is empty while sender signatures are incomplete. It freezes
the receiver's clock when authentication first completes and survives failed
handoff/retry. This is the timestamp seam for later IPEX presentation verification;
this change does not enable that guarded consumer. Sender `dt` is never a substitute
for a receiver-observed historical cutoff.

## Ownership, persistence and failure

`Kramer.intake(envelope, consume)` borrows the incoming frame. It keeps admission
occupied until its finite work scope has joined reads and owner cleanup, including
cancellation. Local contention returns `kramBusy`; no waiter or automatic retry is
created. Expected replay, time, authentication, missing-state and finite-limit
outcomes are typed refusals. Cancellation, corrupt durable state, caller-contract
and I/O failures propagate.

Partial state reuses the reference's `pmkm.`, `pmks.`, `pmsk.` and factor families.
Private `kpnd.` wire snapshots retain nested children and ESSR evidence; `kready.`
marks an authenticated handoff not yet consumed. Cache, factors and snapshot are
published atomically. No partial child is written as an independently accepted EXN.

Reopened snapshots use the single progressive parser. Their ESSR owners belong
to the intake call scope, and are borrowed only through the downstream callback.
The incoming callback envelope receives normalized parent factors without gaining
a dangling reopened payload owner. A successful callback clears partial ownership;
an infrastructure failure leaves the handoff retryable with its first receiver time.
Ordinary Exchanger publication retains public wire evidence after verification.

Pruning visits a finite initial horizon, up to the configured batch per cache
family, and closes each cursor before mutation. The shared opener disappears only
when its final transaction row is gone. The last-participant check still scans
thread rows; consumed-work scheduling belongs to resource phase 4.

## Reference evidence and intentional corrections

The independent [wire oracle](../../../packages/keri/test/fixtures/keripy-kram-vectors.json)
records actual unmodified KERIpy `927c0cb8794d7c84fc17143c67df64aab9deda6c`
intake outcomes. Its generator verifies every actually imported KERI module's bytes
against that commit. It covers source-reference precedence and missing state,
current/foreign signatures, nontransferable cigars, partial accumulation, replay,
inclusive timeliness/exchange boundaries, rotation and receiver times. Runtime tests separately cover forwarding, HTTP
mailbox authorization and actual OOBI reply verification.

The oracle also reproduces an upstream omission: the first partial delivery has
one child, but completion without child retransmission returns none. TypeScript
deliberately retains that child, proving reopen and separate child acceptance.
It also persists configuration delays and failed ready handoffs, improving restart
and I/O recovery beyond the frozen in-memory transition/handoff behavior. These
are explicit corrections, not claims of identical implementation.

Snapshot wire is capped at 24 MiB, with existing 8 MiB tree/ESSR and finite factor
credits. LMDB still materializes a stored snapshot before checking its size.
These guards do not bound all concurrent runtimes, pending rows or storage copies.
[Shared admission](../../plans/runtime/RESOURCE_POLICY_PLAN.md) and
[storage reconciliation](../../plans/db/STORAGE_RECOVERY_PLAN.md) own those gaps.
Full format, environment and production qualification remains in
[phase 7](../../plans/qualification/QUALIFICATION_PLAN.md). Built-in TEL queries,
IPEX presentations and the explicit `xip/pro/bar` reference stubs remain separate
boundaries in the [exchange plan](../../plans/exchange/EXCHANGE_ADMISSION_PLAN.md).
