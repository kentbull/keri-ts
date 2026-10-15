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
existing escrow. Signature/dependency query cues follow new escrow insertion. Injected CueDeck holds
its exact new sender/proof/schema batch before nested staging and durable evidence,
archive or metadata publication. The passive owner predates I/O/cleanup and survives
joined cancellation. Recheck membership before commit effects; changed async plans
fail without replacing another writer's escrow. Ordinary Deck keeps its cue order.
Authentication queries admit per-invocation ordered coordinate batches after charging
Map/key/query scratch and checking unique item capacity before query construction.
Published queries outlive later verification or rejection. Earlier resolution/proof
arrays and native reads remain open, as do KRAM and IPEX notification producers;
private ESSR verification snapshots and native/copy admission remain open.
An incomplete duplicate remains pending without replacing accepted rows or rerunning
handling; `complete(said)` reports durable acceptance, not the current attempt.
Canonical 32-digit signature ordinals prevent Number/Seqner retry duplicates.
Keep ests/eidx and cigar verifier context; recheck proof factors on replay.

Retry captures an initial horizon, reads one key and closes the LMDB cursor before
awaiting/removing rows. Mutating a suspended range can skip the next escrow.
Group leadership intentionally uses group signatures, excluding foreign endorsements.
Missing-schema EXNs retain the same evidence ownership through emse/emsd and
archive recovery. One absolute deadline spans sequential schema dependencies;
TMSC opener plus lifetime differs from the receiver receipt. Equality is eligible.
Remote dependency outcomes are typed; storage/corruption failures propagate.
ESSR syntax failures reject; unexpected asynchronous payload read/hash failures
propagate before retry can drop pending proofs or archive ownership.
Schema query cues do not imply a host fetcher or completed IPEX schema gates.

## Route ownership

Challenge responses share one word-list contract between CLI production, decoded
EXN validation and verifier lookup. Read decoded attributes as unknown; narrow
words before domain use instead of asserting an open record. CLI JSON uses the
same word-list predicate while retaining its own trim/filter behavior. The
verified EXN sender identifies the responder; payload i is only existing wire
projection and cannot select the reps/chas identity.

V2 forwarding binds exactly one child to signed `a.evt`. The recipient authenticates
its signatures. Children survive bounded enst storage, retry and replay; verified
duplicates replace child evidence atomically and rerun the handler.

V2 multisig supports icp/rot/ixn/rpy commitments and local membership. Child-SAID
approval precedes ordinary KEL/reply processing. Local-first approval borrows parsed
frames; remote-first approval reopens evidence. V1 approval replays stored pathed
child proofs through the same KEL/reply owners in either arrival order, including
after database reopen. Decode signed cgvrsn before parsing; explicit child genus
wins, and a hint applies only to a child with attachments. Parent signatures never
supply missing child proofs. CLI proposal/join remains v1. Shared proposal
publication registers its actual signed wire through intake before transmission,
so later peer proofs can replay without another approval prompt. Endpoint-role
initiation still has a separate publication path to reconcile. Preserve first-notice
behavior or retries can republish approval unnecessarily.

V2 IPEX offer/grant verifies negotiated graphs and each node's independent issuer
proof; metadata offers withhold issuer proofs but still validate carried schemas.
Grant order is issuer authentication, own schemas, edge pins, then presentation.
Same-schema identity never bypasses payload constraints; missing schema is a
typed dependency, while infrastructure/resource failures propagate.
Conversation acceptance is not wallet acceptance. Observer registry import
is separate from issuer registry processing. Presentation registries still require
receiver-owned KRAM time, node-local BLIDs and explicit fully witnessed Issuee
source triples. Bind the exact grant target at the inclusive receipt cutoff;
later accepted TEL updates cannot refresh it. Preserve missing proof escrow and
independent issuer verification; deeper/hidden paths and unfinished routes remain guarded.

The four multisig event builders carry one MultisigEventProposal with correlated
icp/rot/ixn/rpy attributes through byte preparation and synchronous body building.
Inception derives gid from its child; callers supply member lists, not another gid
or child commitment. Do not reconstruct typed input from an erased serialized SAD.
Other multisig/TEL/business routes retain their separate builders. Inbound
membership decodes unknown attributes into join, rotate or participate requests
before consulting local habitats. Preserve optional-list filtering, rotation's
known-group shortcut and KERIpy's family-wide membership rule; handler registration
selects supported routes. Generic EXN/embedded-SAD and approval boundaries still
need their own audit.
For a v1 wrapper around a legacy body with a different explicit attachment genus,
derive signed a.cgvrsn from childGvrsn. Omit it when the body declares its genus or
the versions agree. Canonical 714 icp/rot/ixn/rpy vectors compare complete unsigned
bodies and supplemental wire; KERIpy's separate parent endorsement is not part of
our builder output. KEL and reply approval use the same decoded child/body,
pathed proof and resolved genus as replay. Sign local attachments in that genus
and prefix only parser input with its selector; embedded wire remains body-first.
VDR anchor approval uses the same decoded proof/genus for local signatures and
combined intake; the registry regression verifies both accepted KEL anchor and
TEL state. Other VDR/credential input contracts and live issuance qualification
remain separate work.
Endpoint-role proposal publication constructs its one known gid/rpy envelope at
the workflow owner; a one-caller helper accepting arbitrary payload/embed maps
adds no boundary. Decoded endpoint-reply attributes narrow unknown cid/role/eid
before acceptance lookup. These local cuts do not close the generic approval
payload or child-genus contracts.

KEL approval decodes its named child, group and member lists before local member
selection, joining or signing. Interaction does not carry rotation members.
Existing raw attribute re-publication remains at the wire boundary pending its
own producer-contract cut; it must not become an input to approval policy again.
Multisig publication prepares and endorses its recipient-specific EXN at the
workflow owner. Poster borrows that exact body and wire for delivery and durable
retry; its optional TCP dependency is the reply receiver contract. Preparation
alone is not approval: the publication owner first submits those bytes to local
intake, then delivers them. Transport does not register approval.

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
stale-owner refresh strengthen the frozen reference; runtime composition owns intake.

KRAM source authentication checks only the last couple or sender-matching triple.
Keep known-invalid separate from missing state: only the former permits signature
fallback. Preserve exact missing sequence numbers beyond safe database ordinals;
query publication belongs to intake, not the read-only helper.

KRAM signature verification preserves frozen arrival order and qb64 uniqueness.
Do not substitute Kever's index-sorted verifier: distinct encodings may share an
index, so intake thresholds must use unique indices. Historical sender groups
are diagnostic only; normalization borrows owners and leaves foreign proofs separate.

KRAM staging publishes cache, verified pool/state, factors, private wire and first
ready receiver time atomically after async rechecks. Never return hydrated owners
through a generic callback result. Preserve ready rows until the handoff owner joins
consumption/disposal and acknowledges the exact receipt/body; failures can replay
callback side effects. Rotation clears partial ownership, retaining replay cache.
Only a fresh foreign last group known at receipt clears its earlier unresolved
marker; later KEL recovery alone cannot reinterpret unknown saved signatures.

Do not invent xip/pro/bar processing: frozen upstream has stubs. Native outer EXN
empty-field construction remains unqualified; JSON/CBOR/MGPK route evidence does
not prove that path. Full resource qualification and presentation cutoffs remain open.

KRAM time plans are read-only: cached multi partials reuse original windows; receipt
time freezes on completion. Recheck plans atomically with current keys and durable
readiness before publication so competing receipts cannot replace the first one.

KRAM pruning closes read cursors before atomic cleanup and defers for live handoff
owners. Finite orphan scans restart on committed database changes; unrelated writes
can postpone cleanup. Remove the shared opener only after the final participant.

Optional runtime KRAM keeps the transport consumer inside scoped ready handoff;
never return hydrated owners or authorize HTTP from an older cue after refusal.
Private envelope-bound receipt authority expires with the consumer and requires
completed nonexempt intake. Freeze first exchange receiverTime through route proof
escrow, retry and reopen; recheck publication against competing receipt writes.
Signed dt, disabled/exempt/v1 intake and forged capabilities never confer cutoffs.
Disclosed presentation registry processing consumes retained receipt provenance;
hidden declarations and unfinished graphs remain guarded.

[Proofs](../../docs/design-docs/exchange/EXCHANGE_PROOFS.md),
[multisig](../../docs/design-docs/exchange/MULTISIG.md),
[IPEX](../../docs/design-docs/exchange/IPEX.md),
[storage](../../docs/design-docs/db/PAYLOAD_STORAGE.md).
