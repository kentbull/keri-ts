# Exchange learnings

[ADR-0013](../../docs/adr/adr-0013-simple-component-flows.md) owns the completed
accounting/durability removal and the prohibition on restoring it. Preserve
protocol evidence, transactions and actual resource cleanup.

## Proof and persistence boundaries

The [disclosure acceptance matrix](../../docs/plans/qualification/GRADUATED_DISCLOSURE_INTEROP.md)
qualifies supported operators against selected KERIpy behavior. The shared chaining
owner uses strong AND/OR with explicit unknown and retryability; unsupported
operators cannot create negative authorization predicates.

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
`verifyAccepted(said, route)` separately reauthenticates stored outer factors,
exact first-accepted children and receiver metadata through the registered route,
without queries, writes, notices or escrow. Identical recorded replies are eligible;
other accepted replies refuse. Default inspection uses current issuer history;
explicit historical mode selects only exact retained target BLIDs from accepted
BUPs. Vacuous openings and generic source locators cannot advance it. Neither
inspection mode supplies graph-policy approval, current-use consent or wallet acceptance.
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
`epsd.` bounds only actual partial-signature escrow cleanup and is removed on
acceptance or schema wait. `exchangeDeadline(serder)` reads the exact accepted TMSC
(sender, transaction XID, message SAID), requires `rdt`, and returns original
`xdt + xl` at microsecond precision. Policy changes, retransmission and reopen never
renew it; absent/pruned TMSC yields no live authority. `pxl` bounds retention, not
Grant lifetime. Live DH/Unblind requires this accepted KRAM record; ordinary
nonauxiliary KRAM-off processing remains supported. Partial group proposals use
only the command wait limit until sender authentication accepts TMSC; their
presentation result has no deadline yet.
`pendingGrant(said, {xid, sender, recipient})` separately selects an exact epse-only v2 Grant before deadline
equality, excludes accepted/terminal conversations, and reauthenticates its stored
complete sender evidence. The v2 route reuses shared conversation/disclosure/
schema checks and requires an anchored fresh issuer RIP plus authentication of all
other disclosed nodes. It returns deduplicated registry IDs, with no writes or
cues. This authorizes a pending issuance scope, never acceptance.
`presentationContext` separately reauthenticates an accepted or pending Grant's
exact retained view, original deadline and parties/XID; terminal responses and
deadline equality end its scope. It returns registry-to-node authorization,
validating every supplied opening and non-registry issuer factor even on optional
branches. Each registry requires issuer/Issuee disclosure or exact-Grant issuer
authorization for all its disclosed nodes; an origin issuer cannot authorize
another issuer's registry. The returned map may be a strict subset of the DAG.
Reuse shared presentation-state classification without changing ordinary OR
admission. Lookup changes no state or cues; missing/refused context returns null,
while corrupt accepted storage and infrastructure failures propagate. Pending
`lead` is an explicit opt-in to this scope only when no accepted exchange exists;
full sender threshold and historical member-index election still apply. Neither
scope nor election implies disclosure consent, issued-state policy or Admit.
Individual `Dhke` uses explicit local approval (`start` itself approves issuer
work), process-local fresh keys and stable retry bytes. Groups explicitly approve
their own accepted coordinator and custodian, freezing the historical verified
index/key. Later signatures do not reelect; current member authority is rechecked.
Members contribute to exact custodian-signed proposals through ordinary Hab.sign;
only the custodian generates or retains roots. Own full query/reply intake uses
Parser/KRAM plus independent query verification/Revery before becoming outstanding
or retaining roots. Sign cues request review, never confer consent or copy roots.
`retainedInput(..., {pending:true})` reuses stored authentication and Exchanger's
original deadline clock without requiring fresh RIP after BUP arrival. Finish
verifies all current anchored issued openings before retrying exact Grant/child
bodies; it never authors Admit. `acceptPendingGrantProof` repeats the original
pending deadline, terminal-response and exact body/order checks inside Exchanger's
writer after nested serialization. DH, pending Unblind and selected rootless group
completion use this path; ordinary intake and accepted-live proof refresh remain
separate. No proof retry renews the original lifetime. Requester Unblind replies may cover a
superset of the required suffix within the original request, with every selected
opening independently verified before reply acceptance; responders remain minimal. Pending DH authorization substitutes
only eligible fresh-registry node-own proofs, then requires a valid full graph;
unresolved DI2I authority cannot borrow the registry proof exception. Group DH public evidence
aggregates use Poster.sendStream; Poster.send is reserved for one CESR message,
including when the destination is a witness-hosted mailbox.
Exact file consent uses `acceptPreparedGrantContribution` for a retained partial
or accepted Grant. Its writer enforces the original deadline, no terminal reply,
and identical nested wire evidence before normal authentication. Unlike proof
completion, this path can add a missing sender contribution. On an already
accepted Grant whose current openings are retryably missing, it retains only
verified added authentication; it neither replaces old proof rows nor claims
current credential acceptance. File callers inspect every supplied signature
before intake, so invalid or threshold-short extra factors cannot disappear into
ordinary optional-factor selection.
Shared `verifyQueryAttachments` prefers named
sender TSGs, otherwise resolves raw/last signatures against accepted current
establishment state; a valid factor suffices but missing claimed coordinates
refuse. KRAM admission alone supplies no consent.
`RegistryRoot` (`/registry/root`) checks the v2 map `a.essr` ESSR digest in its
handler, since the Exchanger checks only a v1 string `a`. Its `verify` is the
read-only admission decision (stored SAID → false); `handle` escrows and attempts
retention after commit. Route handlers that define `processEscrows()` opt into the
Exchanger's escrow pass, as KERIpy `Exchanger.processEscrow` does. Group authority comes from the KEL, never a group signature:
KERIpy partial-signature escrow does not keep `essrs`.
`Unblind` separately approves one live presentation and freezes its
exact bodies, registry scope and original deadline. The disclosee's signed query
carries a contiguous accepted public BUP suffix; the sender authenticates its full
threshold before ordinary registry intake or proof release. Replies contain only
the minimum missing BSQ/BSS suffix, never roots. Revery retains ordinary threshold
and BADA ownership; parsed reply evidence reaches the handler, including KRAM's
previously retained openings when a later signature carries none. Independently
vetted event openings may survive a partial reply only in the approved operation.
Finish retries a pending Grant or uses `verifyGrantProofs` and the ordinary route
verifier before atomically replacing only that live accepted Grant's proof rows
and current observations. Exact node bodies, earlier admitted Grants and deadlines
stay unchanged. Group members use `contribute(xid, proposal)` under that same
approval: verify the exact body, public suffix/proof bytes and accepted group
establishment before signing, without requiring a root. Only full own query/reply
thresholds freeze completed aggregates. Delivery belongs to the member whose
latest accepted historical contribution matches the aggregate's lowest verified
index; it is not DH custody or a Grant/KEL coordinator election. The root holder
may author a reply proposal while another rootless member delivers its aggregate.
Finite callers use `hasPeerQuery(xid)` to schedule responder work after the
independent peer query authenticates; it rechecks live scope and current heads
without signing or exposing mutable operation state.
No automatic Admit, durable approval or additional consent stage exists.
Remote dependency outcomes are typed; storage/corruption failures propagate.
KRAM's ordinary multi-signature handoff supplies the complete verified sender
TSG for qry/rpy/XIP/EXN, preserving its accepted establishment coordinates and
foreign factors. Auxiliary query receivers must use that full envelope rather
than the legacy requester projection, which omits TSGs. A valid sender seal
retains the reference's separate authentication path; it does not itself grant
auxiliary authority.
Custom queries without their selected owner are refused before KRAM. HTTP204
acknowledges transport only for missing owners or typed KRAM replay drops; neither
redispatches, replies nor changes cache state. Auth/window/policy refusals remain HTTP403; built-in query
rules are unchanged. Actual DH/Unblind owners retain only the first fully
verified query for an exact authenticated Grant before consent. The public
envelope expires at the earlier original MSGC window or accepted Grant lifetime;
MSGC has no accepted-receipt field, so full current proof and normal completion
remain necessary. Approval locally replays this evidence through the owner,
without network replay exceptions, new timestamps, keys or replies before consent.
Retention is process-local and removed on expiry, abandonment or owner close.
Reciprocal fixtures deliberately deliver a full query before recipient consent,
then exercise exact caller retries. Direct delivery requires authenticated controller
roles and original endpoint-signed location replies; a witnessed KEL alone can
select witness mailboxes. After distributed group rotation, commit the selected
member order only after the exact rotation and ordered keys have been accepted.
ESSR syntax failures reject; unexpected evidence read/hash failures propagate
before retry can remove pending proofs or fragments.
Schema query cues do not imply a host fetcher or completed IPEX schema gates.

## Route ownership

Generic XIP dispatch and Exchanger admission/retry use the same independent sender
authentication and evidence stores as EXN. Selected v2-spec public vectors own
the four-codec XIP/EXN body contract; an XIP uses its own SAID for transaction
schema deadlines. The handler still owns route acceptance. IPEX openers are XIP and derive their identity from their own SAID; EXN replies
carry that identity in x and preserve the accepted prior chain. Only Offer/Grant
XIP routes admit child trees. The selected wire uses exactly one outer DAG list,
q.dp=[plan], while the graph owner retains one internal flat plan. Empty inner
plans inherit with a prior or mean no disclosure at an opener; vacuous Grants
carry o=[] and no nodes. Schema query slots accept strings, including empty/opaque criteria; Grant matching
and actual schema validation still establish commitments. IPEX and applications share strong AND/OR chaining, with caller-owned node verdicts.
Historical ae828499 wire vectors preserve their raw blank/stale section observations.
Current-reference graph vectors use ordinary repaired Python constructors and retain
exact source/module hashes, with no section preparation or received-byte rewriting.

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

`/multisig/qry` (`a={gid,qry}`, group-authored v2 query) and `/multisig/ipex-proof`
(`a={gid,grant}`, v2 Grant for the group) are core routes as in KERIpy #149: the
Multiplexor validates, indexes and notifies them but never replays their children.
Finite owners share any `/multisig/*` route through `runtime.mux.addChildHandler(route, childRoute, handler)` and release it with `removeChildHandler`; never replace
`Exchanger.routes` entries.

V2 multisig supports icp/rot/ixn/rpy commitments and local membership. Child-SAID
approval precedes ordinary KEL/reply processing. Local-first approval borrows parsed
frames; remote-first approval reopens evidence. Commit proposal/submitter indexes
before asynchronous replay so peer arrivals observe the accepted local approval. V1 approval replays stored pathed
child proofs through the same KEL/reply owners in either arrival order, including
after database reopen. Replay decodes generic protocol bodies: issuance contains
an ACDC child as well as KERI TEL/anchor children. Keep the KEL/reply approval
reader KERI-specific and share only proof/genus resolution. Decode signed cgvrsn before parsing; explicit child genus
wins, and a hint applies only to a child with attachments. Parent signatures never
supply missing child proofs. Groups are explicitly v1 or v2 by KEL version. New
KEL/reply proposals follow KERIpy for both: a v1 `e`-embed wrapper around the
group-version child (`kli multisig join` reads only `e`); v2 nested wrappers are
explicit for native v2 routes. Outer member endorsements use the wrapper's
attachment genus. Receiving accepts both forms. Shared proposal
publication registers its actual signed wire through intake before transmission,
so later peer proofs can replay without another approval prompt. Endpoint-role
initiation likewise records each recipient-specific wrapper before delivery and
returns those actual proposal identities. Reply approval and retained-contribution
retry must read v2 nested evidence after ordinary exchange verification; the v1
named-child reader cannot consume a flat signed child SAID. Preserve first-notice
behavior or retries can republish approval unnecessarily.
V2 RIP/BUP proposals instead carry exactly two V2 TEL/anchor children on their
explicit routes. Read-only validation requires a full contained TEL seal, exact
source locators, accepted controlling RIP and next BUP linkage or identical replay.
Authenticate exact route/gid/tel/anc wrappers in either arrival order before counting
consent; an anchor bucket alone is insufficient. V2 group authors explicitly
select V2 body/proof framing, also the default for ordinary group KEL authoring. Historical
accepted anchors reuse retained local contributions, including after key retirement.
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
Group Admit peer approval borrows the existing protocol runtime through `joinIpexProposal`; only v1 uses legacy credential settlement. Tufa `joinWalletIpex` records v2 inventory only after explicit local approval and accepted threshold. Review and partial signatures do not admit.

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
The selected candidate's `q.dp` is a one-DAG outer list containing the flat
disclosure triples. An empty inner plan is accepted-prior inheritance or no
disclosure for an opener. Agree stays empty, solicited Offer/linked Grant default
to ditto, and a bare one-node Grant states its explicit root selection. Builders,
handler and resolver share this wire boundary without rewriting signed bytes.
Disclosure selects all carried nodes in exact BFS order using `/` or rooted
literal map/list paths ending at `_/`; a hop follows the carried map's n and need
not start/restart at e. Edge graph morphology remains strict and independent.
Empty DAG prefixes are invalid. [] permits any valid compaction level; [""]
requires present top-level a/e/r maps and an A list. Relative field paths require
the canonical Compactor view, not an extra closed-schema proof. Whole aggregates
and open schemas still pass ordinary own-schema validation; no receiver expands
missing data. Empty-plan ditto/no-disclosure remains separate from path selection.

V2 IPEX Offers carry body-only reachable subgraphs and validate carried schemas;
child proof attachments belong to Grants. Grants refuse field-map metadata with
explicit empty `u`, while public fixed-field `act`/`acg` UUID slots remain valid.
After disclosure checks, a Grant must fulfill its exact accepted Offer: identical
root, or metadata with matching issuer, promised registry and every nonempty
section commitment. Compare only Serder-verified d/$id/AGID claims; missing named
metadata uses proof escrow, known contradictions reject. Then validate all own schemas and presentations/ax before reducing issuer authentication
and edges together. IPEX’s local evaluator uses strong AND/OR, inherited conjunctive
pins, default/last delegative I2I/NI2I/DI2I and E1E. DI2I uses accepted inception
delegation evidence through the shared read-only relation. Unsupported operators and compact Edge
blocks are permanent unknown; malformed shape aborts globally even in an unused OR
branch. DI2I HTTP fixtures replay actual approval KELs root-first; finite receiver
intake advances the existing KEL/reply escrow owner. Label v2 credential/genus
evidence separately from the individual Hab API's KEL body version.
Eligible proofless fresh-RIP issuance precedes final reduction and requires
all noncandidate nodes authenticated. Otherwise ordinary reduction runs first;
only after refusal may exact accepted-history openings classify missing current
or placeholder-suffix proofs as node-own retryable unknown. Unmatched future proofs
are refusals, not invented TEL dependencies. A dependent retryable unknown uses
existing schema/proof escrow. IPEX records
no application-use verdict or revocation policy. Successful verification returns typed
registry facts; Exchanger atomically pins exact5-field exrs observations only on
acceptance. Later successful delivery may refresh them without replacing the first
IPEX enst/epath. Optional unauthenticated children fabricate no observation and do
not erase an earlier one. verifyAccepted and historical inspection are read-only;
recordedRegistryStates are labeled observations, never current authority. Empty state
text remains empty; do not manufacture authenticated nulls or backfill old exchanges.
`acdc/chaining.ts` is shared by IPEX and applications; callers provide node
verdicts and never short-circuit all node authentication before reduction. The
single IPEX walker owns flat nested frames, Offer-open/Grant-closed traversal and
negotiated disclosure. Edge shapes and reserved labels are shared.
`ipex-node-authentication` reads only Baser/RegistryStore and returns authenticated
proof, a missing dependency or refusal. A verified registration retains its actual
bound state; authentication alone does not interpret it as credential validity.
Conversation policy owns escrow and rejection. Issuer and presentation checks share
accepted-chain reads, preserving corruption failures and source-proof precedence.
Same-schema identity never bypasses payload constraints; missing schema is a
typed dependency, while infrastructure/resource failures propagate.
Every ancestor and local schema pin accumulates. I2I/NI2I and E1E use the
selected reference semantics; NOT/DI2I and unsupported m-ary operators remain
unknown. Application new use maps authenticated issued to valid, revoked to invalid,
and unsupported states to unknown, including the origin. Missing proofs stay
retryable unknown; no known sibling hides malformed graph or own-schema failures.
Strong OR can accept with a valid alternative despite unused invalid/unknown node
verdicts. Historical accepted Grants and consent remain evidence, not current policy.
Conversation acceptance is not wallet acceptance. Observer registry import
is separate from issuer registry processing. Presentation declarations apply to
the sender, the origin Issuee (or issuer when absent), and verified supplemental
Grant factor signers. Direct issuance exempts recipient-targeted declarations;
nonparticipating far-node Issuees impose no presentation requirement. Hidden or
malformed declarations still reject before this selection. Selected presentation registries require
receiver-owned KRAM time, node-local BLIDs and explicit fully witnessed Issuee
source triples. Bind the exact grant target at the highest accepted BUP actually
sealed by the verified Issuee source. Completed receiver KRAM remains a separate
acceptance prerequisite; its timestamp does not select TEL history or infer
publication time. Later accepted TEL updates cannot refresh the old source proof. Preserve missing proof escrow and
independent issuer verification; deeper/hidden paths and unfinished routes remain guarded.
Disclosed inner `rd` without top-level `rd` is unsupported issuer registration in
`a`, mapping `A`, or expanded aggregate entries; compact entries remain opaque.
Issuee presentation-registry obligations come only from top-level `a`, never `A`.

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

XIP uses ordinary Exchanger/KRAM processing with the selected public XIP/EXN vectors.
Selected upstream still leaves pro/bar unimplemented; do not invent their processing.
Full resource qualification remains separate from the focused route checks.

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
V2 XIP Grants and EXN Admits use V2 `/multisig/exn` wrappers with one exact
framed group-authored IPEX child and `{gid, exn: childSAID}` commitments. Only
Offer/Grant children carry credential trees. Require the current signing member,
local participation and actual v2 IPEX/registry/Revery/KRAM bindings before
indexing. Local approval verifies this member's child contribution; peer-first
replay waits for that approval. Both approval entry points reauthenticate the exact
stored wrapper. Preserve child body, source seals, signatures and nested proofs;
parent authentication never supplies child quorum. Legacy V1 remains a separate
pathed branch with its embedded-section index and selected child genus.
It receives protocol, Poster and optional Reger explicitly, owning only its local
byte-input context. Stored approval has no transport dependency; pending discovery
reads accepted Baser exchanges. Command composition owns workers and stores.
IPEX commands open normal persisted configuration before runtime composition, so
the configured KRAM owner is available for native wrappers; they introduce no
global enabled default. Both initial stream publication and ordinary approval
sends register exact local wrappers first and reuse shared recipient-specific replay. Group grant/join facts
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
