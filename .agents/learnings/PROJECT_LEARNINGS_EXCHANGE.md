# Exchange learnings

## Proof and persistence boundaries

Exchanger separates sender authentication, supplemental selection and route
verification. `verifyEvidence`, `acceptsEvidence`, `acceptsSscs` and
`acceptsMissingEvidence` are independent capabilities. Sender source seals can
anchor in historical interaction events; signature groups require establishment
keys. Resolve known last references before escrow so rotation cannot reinterpret
saved signatures. Parent evidence never authenticates a child.

Strict missing extras query/reject without creating escrow. Missing sender source
state escrows only for opted-in routes; MissingSignatureError counterparts preserve
existing escrow. Signature/dependency query cues follow new escrow insertion.
An incomplete duplicate remains pending without replacing accepted rows or rerunning
handling; `complete(said)` reports durable acceptance, not the current attempt.
Canonical 32-digit signature ordinals prevent Number/Seqner retry duplicates.
Keep ests/eidx and cigar verifier context; recheck proof factors on replay.

Retry captures an initial horizon, reads one key and closes the LMDB cursor before
awaiting/removing rows. Mutating a suspended range can skip the next escrow.
Group leadership intentionally uses group signatures, excluding foreign endorsements.

## Route ownership

V2 forwarding binds exactly one child to signed `a.evt`. The recipient authenticates
its signatures. Children survive bounded enst storage, retry and replay; verified
duplicates replace child evidence atomically and rerun the handler.

V2 multisig supports icp/rot/ixn/rpy commitments and local membership. Child-SAID
approval precedes ordinary KEL/reply processing. Local-first approval borrows parsed
frames; remote-first approval reopens evidence. CLI proposal/join remains v1.
Preserve first-notice behavior or retries can republish approval unnecessarily.

V2 IPEX offer/grant verifies negotiated graphs and each node's independent issuer
proof; conversation acceptance is not wallet acceptance. Observer registry import
is separate from issuer registry processing. Presentation registries still require
receiver-owned KRAM time; deeper nests and unfinished routes remain guarded.

Pure multisig/IPEX body builders take parsed Serders synchronously. Byte convenience
operations own cancellable parseBytes, finite nested-wire collection and finally
disposal. Serializer views borrow frame owners through consumption. Parent signatures
and child evidence belong in one parent enclosure; constructing it authenticates neither.

## Follow-ups and contracts

V2 non-event sender policy precedes proof prerequisites; allow/deny sets do not
authenticate signatures. Raw query sigers use the claimed sender only when no
last-establishment group is present. Optional KRAM remains
[3f](../../docs/plans/exchange/EXCHANGE_ADMISSION_PLAN.md).
Internal cache policy owns exact route/ilk/catchall selection and compact exemptions.
Persist staged windows with cache rows; reconfigure from active windows, preserve
drift and keep pruning at least as long as active acceptance. Restart safety and
stale-owner refresh strengthen the frozen reference; intake remains pending.

KRAM source authentication checks only the last couple or sender-matching triple.
Keep known-invalid separate from missing state: only the former permits signature
fallback. Preserve exact missing sequence numbers beyond safe database ordinals;
query publication belongs to intake, not the read-only helper.

KRAM signature verification preserves frozen arrival order and qb64 uniqueness.
Do not substitute Kever's index-sorted verifier: distinct encodings may share an
index, so intake thresholds must use unique indices. Historical sender groups
are diagnostic only; normalization borrows owners and leaves foreign proofs separate.

Do not invent xip/pro/bar processing: frozen upstream has stubs. Native outer EXN
empty-field construction remains unqualified; JSON/CBOR/MGPK route evidence does
not prove that path. Full runtime/resource qualification remains open.

KRAM time plans are read-only: cached multi partials reuse original windows; receipt
time freezes on completion. Recheck plans atomically with current keys and durable
readiness before publication so competing receipts cannot replace the first one.

[Proofs](../../docs/design-docs/exchange/EXCHANGE_PROOFS.md),
[multisig](../../docs/design-docs/exchange/MULTISIG.md),
[IPEX](../../docs/design-docs/exchange/IPEX.md),
[storage](../../docs/design-docs/db/PAYLOAD_STORAGE.md).
