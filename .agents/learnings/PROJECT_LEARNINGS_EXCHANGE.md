# Exchange learnings

[ADR-0013](../../docs/adr/adr-0013-simple-component-flows.md) owns the completed
accounting/durability removal and the prohibition on restoring it. Preserve
protocol evidence, transactions and actual resource cleanup.

## Proof and persistence boundaries

The [disclosure acceptance matrix](../../docs/plans/qualification/GRADUATED_DISCLOSURE_INTEROP.md)
separates TypeScript operator support from Python interoperability. Qualify operator
interoperability against demonstrated selected-reference behavior; implementation
availability alone is not qualification. A reference stub is not a permanent product
contract. NOT must distinguish proved
invalidity from unknown evidence before inversion; missing or unauthenticated
input cannot establish a negative authorization predicate.

Exchanger serializes resident children, then performs current sender
authentication, supplemental selection, route verification and publication in one
synchronous writer. Verification hooks cannot suspend; handlers follow durable
commit. First acceptance replaces provisional factors; accepted duplicates retain
previously verified proofs without using them to authenticate a fresh input. `verifyEvidence`, `acceptsEvidence`, `acceptsSscs` and
`acceptsMissingEvidence` are independent capabilities. Sender source seals can
anchor in historical interaction events; signature groups require establishment
keys. Resolve known last references before escrow so rotation cannot reinterpret
saved signatures. Parent evidence never authenticates a child.
IPEX retains verified historical grant seals across rotation, matching main
`c7e74ad`. Shared proof verification binds the exact accepted KEL coordinate and
grant SAID; route selection must not impose current-establishment freshness on
that commitment. Supplemental signatures still require current establishment keys.

Strict missing extras query/reject without creating escrow. Missing sender source
state escrows only for opted-in routes; MissingSignatureError counterparts preserve
existing escrow. Signature/dependency cues follow actual new escrow insertion.
Ordinary Decks carry records without reservation, inspection or retained-byte credit.
Authentication queries deduplicate coordinates in input order; already published
queries remain available after later verification or rejection. Nested evidence publishes in the owning writer; hydrated frames are ordinary values.
ESSR/nested helpers have no policy, tree/copy budget or token/byte quota. There is
no asynchronous admission guard, archive or file lifecycle. Retry reads current
LMDB proofs, fragments and deadlines; terminal removal commits in that writer
and joins the actual database flush. Determine whether to
publish a pending cue from the escrow write result, not a pre-I/O membership plan.
An incomplete duplicate remains pending without replacing accepted rows or rerunning
handling; `complete(said)` reports durable acceptance, not the current attempt.
Canonical 32-digit signature ordinals prevent Number/Seqner retry duplicates.
Keep ests/eidx and cigar verifier context; recheck proof factors on replay.
Stored epath rows contain complete counted groups; serializers take only their
path/proof payloads and supply output counters. Decode the source counter with
retained attachment genus, independently of signed body version and output genus.
Group IPEX first endorsements use Hab.sign's accepted member contribution lookup;
a member can rotate ahead of the group. Reuse verified stored partials before
fresh signing, preserving the original proof after later rotations.

Retry captures an initial horizon, reads one key and closes the LMDB cursor before
awaiting/removing rows. Mutating a suspended range can skip the next escrow.
Group leadership intentionally uses group signatures, excluding foreign endorsements.
Missing-schema EXNs retain the same LMDB evidence ownership through emse/emsd
and retry. One absolute deadline spans sequential schema dependencies;
TMSC opener plus lifetime differs from the receiver receipt. Equality is eligible.
Remote dependency outcomes are typed; storage/corruption failures propagate.
ESSR syntax failures reject; unexpected evidence read/hash failures propagate
before retry can remove pending proofs or fragments.
Schema query cues do not imply a host fetcher or completed IPEX schema gates.

## Route ownership

CLI group selection is an authorization boundary. Ordinary interaction/rotation
must direct operators to multisig commands before signing; generic exchange,
challenge, location, query and DID-binding commands cannot silently send a partial
group signature as completion. Raw text signing may emit an explicitly labeled
member contribution. The [CLI inventory](../../docs/design-docs/exchange/MULTISIG.md#cli-group-boundaries)
records remaining credential/IPEX lifecycle work separately from these guards.

Challenge responses share one word-list contract between CLI production, decoded
EXN validation and verifier lookup. Read decoded attributes as unknown; narrow
words before domain use instead of asserting an open record. CLI JSON uses the
same word-list predicate while retaining its own trim/filter behavior. The
verified EXN sender identifies the responder; payload i is only existing wire
projection and cannot select the reps/chas identity.

V2 forwarding binds exactly one child to signed `a.evt`. The recipient authenticates
its signatures. Children survive enst storage, retry and replay; verified
duplicates replace child evidence atomically and rerun the handler.

Group publication uses typed VCP/ISS named-child contracts and ordinary signed
records shared by initiation and approval. Packet signing and concrete Poster
completion are separate from local processing policy and worker ownership.
Publication exposes recipient wrapper SAIDs and the shared Multiplexor index key:
v1 embedded-bundle SAID or v2 signed-child SAID. Extraction is not authentication;
Multiplexor owns commitment validation and accepted proposal/submitter indexes.

V2 multisig supports icp/rot/ixn/rpy commitments and local membership. Child-SAID
approval precedes ordinary KEL/reply processing. Local-first approval borrows parsed
frames; remote-first approval reopens evidence. Commit proposal/submitter indexes
before asynchronous replay so peer arrivals observe the accepted local approval. V1 approval replays stored pathed
child proofs through the same KEL/reply owners in either arrival order, including
after database reopen. Replay decodes generic protocol bodies: issuance contains
an ACDC child as well as KERI TEL/anchor children. Keep the KEL/reply approval
reader KERI-specific and share only proof/genus resolution. Decode signed cgvrsn before parsing; explicit child genus
wins, and a hint applies only to a child with attachments. Parent signatures never
supply missing child proofs. CLI proposal/join remains v1. Shared proposal
publication registers its actual signed wire through intake before transmission,
so later peer proofs can replay without another approval prompt. Endpoint-role
initiation likewise records each recipient-specific wrapper before delivery and
returns those actual proposal identities. Preserve first-notice behavior or retries
can republish approval unnecessarily.
Direct stored-proposal approval is `approvePendingMultisigProposal`; it accepts
only proposal selection and immediate UI decisions. Explicit selection reads accepted
EXNs and their Multiplexor indexes independently of notification presence. When
explicitly selected accepted evidence lacks its index after interrupted handling,
replay it through ordinary authenticated intake; the real handler rebuilds its
index. Apply the group selector first and never synthesize approval rows. Group
filters resolve local aliases and bind the actual KEL child identity (inception
need not carry gid); notices discover candidates but do not authorize their route.
Resume reuses the recorded member contribution and membership choices. Existing
recipient wrappers replay their retained authentication; incomplete fanout may add
an outer wrapper around the same approved child. Never reset membership from an
accepted historical inception/rotation or infer acceptance from a resend. Stored
epath values include their counter; serialize only their path/proof payload so
reconstruction does not double the counter.
IPEX command helpers return typed snapshots only after owned cleanup. Tufa
projects final success JSON; poll results carry ordinary Serders rather than
presentation-shaped SAD fields. A shutdown failure does not undo actual delivery
and must prevent the final success record. File-output ownership stays unchanged.
Timed waits and delegated-group
completion are private CLI orchestration, not exported workflow scheduling APIs.
IPEX group coordination likewise exposes direct approval, publication and pending
lookup; timed completion and proposal waits belong to the CLI.
Apply/offer/agree/spurn and grant authoring use one command host, persist local
conversation state before delivery/export, and separate pending approval from
elected external sending. The approval observer borrows protocol state without
starting another worker. Grant predecessor validation precedes signing; pending
group grants do not write a completed export. Delivery snapshots cover completed
transport destinations, including elected external grant delivery.
Explicit join collects stored peer child proofs before its completion decision.
Response preflight shares the v1 predecessor map and checks known signed parties.
Admit authenticates the entire supplied file before importing artifacts, then
observes the wallet saved marker before signing unless no-wait was explicit.
One host owns wallet and approval progress. Each fresh peer admit contribution
checks its own accepted grant, recipient and saved marker; original verified
approvals remain reusable. Legacy admit destination derives from the accepted
linked grant's sender. Wallet pending, child acceptance and transport are distinct
facts; no admit/export exists when the wallet deadline expires before authoring.
Fresh IPEX member signatures require the accepted predecessor/party relationship.
Grant preflight inspects the selected wrapper's proof bytes against the local
verified credential, accepted issuance and issuer KEL; it must not substitute
previously stored good proof for a malformed selected candidate. Optional legacy
embeds/proofs remain optional when authority is already local, and the presenting
group need not be the issuer. Keep actual stored grant paths on delivery; support
reconstruction supplies dependencies, not replacement signed-child evidence.
Local approval, accepted quorum and transport remain separate result facts.

Normalization and Exchanger share supportsNestedExchange for the structural v2
route gate. Handler opt-in, route-local child validation and independent proofs
remain required; IPEX handler support derives from the same nestedIpexRoute rule.
V2 IPEX construction and verification share IPEX_V2_PREDECESSORS in protocol-exchanging;
v1 retains its distinct prior-route rule (grant follows agree, not apply).
Closed IPEX verbs and their guard belong to the protocol module; version-specific
predecessor policies remain distinct. Application-defined IPEX payload fields
match KERIpy extension semantics, while disclosure modifiers use a named dp field.
The selected candidate's `q.dp` is the flat disclosure triple list. Empty `[]` is
accepted-prior inheritance: reject empty Apply/unsolicited Offer/bare Grant, keep
Agree empty, and default solicited Offer/linked Grant to ditto. Bare one-node Grant
still states its explicit root selection. Builders, handler and resolver share this
shape; never translate authenticated nested-plan bytes. Candidate whole-node claims
require closed typed schemas. The positive wire fixture supplies one; TS open/ambiguous
whole-schema refusal and remaining path/closure semantics still need their own cut.
V2 IPEX offer/grant verifies negotiated graphs and each node's independent issuer
proof; metadata offers withhold issuer proofs but still validate carried schemas.
Grant order is issuer authentication, own schemas, edge pins, then presentation.
`ipex-node-authentication` reads only Baser/RegistryStore and returns authenticated
proof, a missing dependency or refusal. A verified registration retains its actual
bound state; authentication alone does not interpret it as credential validity.
Conversation policy owns escrow and rejection. Issuer and presentation checks share
accepted-chain reads, preserving corruption failures and source-proof precedence.
Same-schema identity never bypasses payload constraints; missing schema is a
typed dependency, while infrastructure/resource failures propagate.
DI2I permits identity or an approved inception chain at any depth. Read each
delegator's inception DND and accepted approval; protected/witness-held delpre is
not authority. Missing KEL/approval evidence stays in proof escrow. Later rotations
or witness changes do not renew the relationship, and lookup does not write hints.
The last explicit I2I/NI2I/DI2I wins. Targeted far nodes default to I2I, untargeted
to NI2I; the reference E1E extension retains entity-only matching when identity is
not explicit. NOT inverts authenticated far-node validity after all issuer/own
schema prerequisites, in dependency order independent of BFS disclosure order.
Near identity/extra schema constraints are not inverted. Issued/revoked is the
only supported issuer-state vocabulary, evaluated from accepted observer state
at each fresh validation/retry. Missing/stale/forged proofs, malformed schemas or
operators and unknown custom states cannot satisfy negation. Own schema failure
is refusal; a valid edge schema can disprove a relationship. Historical accepted
grants remain evidence; no automatic revalidation or global freshness is implied.
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
Local KEL/reply publication and approval re-publication reuse this proposal and preparation
contract, including the resolved recipient. Derive labels and inception gid at the
grouping owner; do not accept a second CLI label or group identity. Decode known
member/delegator fields before approval, and publish only those fields. Derive the
signed genus hint from the actual local attachment genus, not copied peer attributes. Other
multisig/TEL/business routes retain their separate builders. Inbound
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
TEL state. Decode the issuance credential before prompting or signing/accepting its
anchor; a missing required child must not leave an accepted anchor behind a null
approval result. Other VDR/credential input contracts and live issuance qualification
remain separate work.
Endpoint-role publication prepares its known gid/rpy envelope at the workflow
owner. Keep recipient-specific signed envelopes and report explicit
recipient/SAID pairs, not a separate unsent wrapper or its attachment size. A
one-caller helper accepting arbitrary payload/embed maps adds no boundary. Decoded endpoint-reply attributes narrow unknown cid/role/eid
before acceptance lookup. These local cuts do not close the generic approval
payload or child-genus contracts.

KEL approval decodes its named child, group and member lists before local member
selection, joining or signing. Bind the selected group to the KEL child prefix or
VDR anchor prefix before prompting: shared participants do not make group identities
interchangeable. A mismatched wrapper must not authorize another group's event. Interaction does not carry rotation members.
The same decoded proposal drives approval and KEL re-publication; unknown peer
attributes are not endorsed into a fresh local wrapper. RPY/VDR publication input
contracts remain separate follow-up work.
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

KRAM staging checks and publishes cache/partial factors in one synchronous transaction.
Completion reconstructs scalar evidence and removes partial factors before returning
a ready decision; the replay cache remains. No private snapshot, hydration, busy
permit, ready receipt or acknowledgement exists. Children and ESSR remain borrowed
from the current parser input. Downstream failure cannot revive acceptance.
Rotation clears partial ownership, retaining replay cache.
KRAM factor merging preserves exact members without byte/item credits or a
fixed signature-pool cap. Native decoding and authentication still reject bad evidence.
Only a fresh foreign last group known at receipt clears its earlier unresolved
marker; later KEL recovery alone cannot reinterpret unknown saved signatures.

Do not invent xip/pro/bar processing: frozen upstream has stubs. Native outer EXN
empty-field construction remains unqualified; JSON/CBOR/MGPK route evidence does
not prove that path. Full resource qualification and presentation cutoffs remain open.

KRAM time plans are read-only: cached multi partials reuse original windows; receipt
time freezes on completion. Recheck plans atomically with current keys and replay
state before publication so competing receipts cannot replace the first one.

KRAM pruning closes read cursors before atomic cleanup. Finite orphan scans restart on committed database changes; unrelated writes
can postpone cleanup. Remove the shared opener only after the final participant.

Optional runtime KRAM returns explicit intake decisions to parser dispatch;
never authorize HTTP from an older cue after refusal. ESSR and nested evidence are ordinary parsed values.
Completed nonexempt intake passes receiverTime explicitly through dispatch.
There is no receipt token or envelope WeakMap. Freeze the first exchange
receiverTime through route proof escrow, retry and reopen; recheck publication
against competing receipt writes. Signed dt and disabled/exempt/v1 intake do not
supply receiver time. Local callers own the provenance of explicitly supplied time.
Disclosed presentation registry processing consumes retained receipt provenance;
hidden declarations and unfinished graphs remain guarded.

[Proofs](../../docs/design-docs/exchange/EXCHANGE_PROOFS.md),
[multisig](../../docs/design-docs/exchange/MULTISIG.md),
[IPEX](../../docs/design-docs/exchange/IPEX.md),
[storage](../../docs/design-docs/db/PAYLOAD_STORAGE.md).

Group IPEX approval derives its child, stored proof and genus from the wrapper.
It receives protocol, Poster and optional Reger explicitly, owning only its local
byte-input context. Stored approval has no transport dependency; pending discovery
reads accepted Baser exchanges. Command composition owns workers and stores.
Both initial stream publication and ordinary approval sends register exact local
wrappers first and reuse shared recipient-specific replay. Group grant/join facts
include messages/exnSaid/payloadSaid for exact selection. Reverify a stored partial
signature against accepted group/member key history before reusing it; a raw index
or parent endorsement is insufficient. Explicitly selected unindexed wrappers
recover through normal replay, never synthetic index writes or a history sweep.
Group EXN lead election requires acceptance and the first authenticated historical
sender proof; map its winning key through the member's accepted KEL history,
not current member keys or the current group index order.
Partial signing receives proof bytes directly; it does not look them up through
a wrapper ID. Prefix parser input with the resolved genus, serialize local
signatures in that genus, and publish its signed replay hint. CLI group grants
use the same genus for credential attachments, partial signatures and intake. Grant artifacts carry
body-first bytes and explicit attachment genus; parser selectors belong only at
intake, never inside embedded bytes. Apply the requested genus to ACDC, TEL and
KEL proofs. Stored legacy grants require the receiver's configured child genus:
a V1 outer envelope can preserve V2 child proofs, so its body cannot determine
child framing. Holder polling and verifier runs expose this through `--gvrsn`.

Reply approval publishes only its group identity through the event builder. VDR
publication correlates registry/issuance routes with their required named children
and known gid/usage fields. Derive the signed genus hint from the local anchor,
and serialize the credential source proof in that genus too; a valid local
credential does not prove the outgoing embedded proof is parseable.
