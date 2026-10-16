# Runtime and mailbox learnings

## Architecture and removal boundary

[ADR-0013](../../docs/adr/adr-0013-simple-component-flows.md) governs concrete
KERIpy-shaped component flows. Application accounting, ResourcePolicy/errors,
reservations/estimates and constructor plumbing are removed. Do not restore
client/queue/listener/proof quotas, no-op policies or renamed ledgers. Only a
minimal private socket constraint with production evidence may be considered.
Native backpressure and actual cleanup remain. Outbox, consumer acknowledgement
and KRAM ready/snapshot handoff durability are removed. Keep protocol caches,
escrows, accepted evidence, mailbox storage/cursors and transaction ordering.
No old keri-ts API/data compatibility, migration readers or new-to-old tests.

One runtime serves a Habery or command invocation. No AgentMode/runtimeMode:
hosts select enableMailboxStore or borrow a Mailboxer. Hosted-AID selection is
separate; do not auto-host every Hab or expose signatory/AEID as normal identity.
RuntimeServices contains only clock/HTTP. Baser and CLI carry no shared policy.
Local endpoint commands and witness/mailbox startup submit their signed records
through settleRuntimeIngress, then verify accepted state; they do not drive OOBI,
mailbox or output workers. Host operators validate/reconcile required endpoint
state before entering the kernel. Protocol-only fixtures likewise pass their exact
records/replays through direct intake; do not restore a whole-runtime test pump.
The hollow seedHabs loop and forwarding-only mailbox host wrapper are deleted. The kernel requires actual HTTP configuration,
passes only runtime to its TCP companion, and owns service/prefix selection once.
Choose real dependencies at construction. Generic cue preparation/delivery
wrappers and Reactor's application callback gate are removed. Finite CLI waits
start the same workers as hosts and join them before returning; serial whole-
runtime pumping still requires removal. These cuts do not complete qualification.

## Protocol records and publication

Kever decides, Kevery owns KEL routing, Revery owns BADA/reply escrows and Oobiery
owns introductions. Local Habery.kevery and runtime processors have distinct cue
Decks. Publish ordinary cues after owning writes/commit. Domain decisions carry
data; diagnostic keys must not drive behavior. Endpoint bootstrap uses alias config
dt/curls, then accepted endpoints; synthesize localhost only when both are absent.
Use signed loc/scheme through Revery rather than direct locs/lans writes.

QueryRequest is the canonical routed record with one required KERIpy-shaped q
body and target. Its optional signer selects a local AID; src names the remote
attester. Pending work retains identifiers, not Hab objects. QueryCoordinator
resolves the explicit signer from Habery; unavailable selections stay pending.
Hab interpretation defers cues selected for another signer, and transport's ambient
Hab cannot supply another identity's introduction. Anchorer's query dependency is
only concrete enqueue access. Do not restore aliases, duplicated body targets or generic route/data
bags. Schema/credential notices stay notify-only with canonical hint fields.
TEL recovery requires registry/credential fields, issuer only where needed.
Prebuilt reply routes live in their serder; typed TSN state serializes at Hab
interpretation where the local attester is known. Preserve exact required fields.

## Cues, queries and state turns

Hab.processCuesIter/interpretCue own cue semantics. Composition routes the actual
cue Deck directly: QueryCoordinator prepares or defers routed query records,
MailboxDirector retains stream correlation, and Respondant owns reply/receipt/replay
routing. CueSink, optional admission/preparation hooks and root sink adapters are
deleted, with no replacement callbacks. Default queued queries use actual transport;
notifications cannot silently select a no-op sender. Schema/credential notices do
not become invented query requests. Unresolved identities/endpoints stay deferred.

Respondant owns private lazy reply cursors, ordered correlation batches and exact
failed packets through actual Poster/Reactor/ReplyStreams dependencies. It has no
mailbox stream-routing or emission-sink facade. CueDelivery/DirectReplyDelivery and
RuntimeDeliveries are deleted. QueryCoordinator owns actual signed packets and
joined response I/O through concrete Reactor/clock/HTTP dependencies. Query signing
and introductions are synchronous owner work; producer task/halt state and public
raw-packet/custom-emission injection are removed. Real I/O still aborts and joins.

Consumers publish before removing source records. Preparation failure preserves the
source, and finite passes use their initial queue extent. Ordinary cues, routes,
packets and batches have no synthetic lifetime. Real iterator cleanup runs once.
The broad Reactor gate and duplicate whole-runtime driving remain removal inputs.

Reactor serializes only protocol dispatch and escrow passes. Dispatch returns the
processed envelope and its exact decision; KRAM may combine earlier proofs.
Protocol processors share a separate Deck wired with legacy TEL/verifier producers.
Reactor captures correlated replies there before publishing ordinary cues to the
application Deck. New reservations synchronously claim already-published matching
replies. Mailbox authorization is returned from the exact protocol state.
Application interpretation, signing, routing, slot consumption
and verifier sidecars are synchronous owner work, outside protocol serialization.
There is no arbitrary callback/settle API. A cancelled protocol owner joins actual
handler cleanup before granting a waiter; waiting input cancellation removes it.
Queued ingress copies producer bytes into a private Deck, then pulls/processes
without quotas or capacity retry. Copy failure publishes nothing; processing failure
does not reinsert. clearIngress discards queued data, not an active I/O lifetime.
Runtime explicit close and scope exit clear queued ingress/cues.

QueryCoordinator prepares synchronously against committed state without a parent
runtime callback. Its private Deck exposes length/empty/peekHead inspection only.
Signing, introductions and route snapshots precede source removal; delivery never
re-signs on retry. Failed/cancelled sends retain the head, unresolved records rotate,
and appended work waits for another pass. Close joins consumption before clearing.
Anchor continuations ask each eligible attester once; one retired witness must not
strand recovery. Ordinary query selection stays first-choice. Completion uses actual
accepted seal/key/TEL state. OOBI convergence excludes background reply delivery:
a static OOBI server may refuse unsolicited receipts without invalidating accepted
resolution. Ingress/query/escrow work still blocks completion; close joins real I/O.
Finite command convergence uses runAgentRuntimeUntil over the same concrete
workers as runAgentRuntime, with a caller-owned elapsed deadline and completion
predicate. There is no max-turn policy or compatibility alias. Blocked mailbox/
OOBI I/O cannot serialize unrelated ingress progress; success, deadline, failure
and cancellation join workers before caller/store teardown. A genuine command may
omit mailbox polling. Query keeps its own completion/display policy over the same
runner. The supervisor suspends instead of polling; component loops still own
progress. processRuntimeTurn and explicit serial mailbox/approval callers remain
removal work; do not claim one driving model is fully implemented yet.

QueryReplies reserves SAIDs for correlation, not capacity. Capture matching replies
before background consumption; duplicates may iterate the same readonly replay.
QueryReply exposes peekAll/takeAll data, not an executable admit callback; the
response owner publishes both concrete replies before taking the records.
Only the final HTTP query controls its response. Earlier authorized replies transfer
to ordinary delivery using their own frame's exact dispatch authorization. Final TSN
pairs transfer atomically before slot removal, with independent response and queued
iterator cleanup. Missing routes allow response-only output. An old cue never
overrides current sender refusal. Keep actual reader lifetime and exact correlation.

## Cancellation and actual owners

Acquire real resources before work children. Abort pending I/O, join children, then
return iterators/close stores. Register Promise cleanup before starting leaves;
a bare yielding finally can lose late cleanup errors during Effection halt.
Suppress only exact owned abort reasons and already-reported objects. Preserve
single foreign-error identity; aggregate distinct failures, including during halt.
Readers cancel once, join cancellation and always attempt lock release. Unacquired
request/response body cleanup failures propagate too.

External input abort stops waiting state turns and active consumers, not merely
byte reads. Register watchers before checking state; check before pull and after
results, before interpreting done or dispatching another frame. DispatchOptions
contains protocol policy, IngressOptions input lifetime. Promise adaptation belongs
at actual edges; an async Scope.run parser loop confuses halt and foreign failure.

CESR uses one complete-enclosure buffered decoder. FrameIntake, TcpRead, custom
frame channels, progressive staging and ordinary-frame disposal are removed.
KERI/Tufa concrete inputs own their parser iterator and source cancellation.
Ordinary hydrated values need no resource wrapper. CLI grant scans validate to EOF,
not first-match return. Nested/ESSR payload storage retains actual files and readers.

## Stores and replay

AgentRuntime borrows Habery and injected services/stores. Default v2 Regery owns
one RegBaser shared by IPEX/Reactor; legacy VDR remains separate. Runtime.vdr is
the existing concrete legacy Regery, which owns Reger/Tevery/Verifier; runtime.acdc
is the concrete v2 Regery. Reactor receives the actual processors, not placeholder
object/service bags or optional-method interfaces. Application entrypoints check
genuine registry absence once and use its typed members. An injected Reger remains
borrowed while runtime composition creates its processors with the protocol producer Deck.
Readonly Haberies create neither default store. Factories own failed/unreturned acquisitions before
cancellable reopen. Explicit close and scope exit both join cleanup; repeated close
is harmless. Created Noter/Mailboxer use Habery's temp policy; injected sidecars stay
borrowed. Acquire output after databases so reverse teardown closes output first.

Replay captures prefix/FEL horizons without depth/message/proof quotas; cyclic
delegation still fails. Close each cursor before hydration/yield; later accepted
events cannot extend captures. Current proofs hydrate on consumption. Witness SN
replay seeks physical insertion proems and excludes later FEL ordinals, retaining
existing missing/corrupt-row behavior. Safe numeric representation guards remain
RangeErrors. Endpoint replies reconstruct canonical ordered transferable groups
and original seals; compact SN keys pad for ordering without rewriting tables.
Exactly one cigar contributes a couple; no authenticators must fail.

ReplyStreams tracks actual lazy readers through EOF/cancel/shutdown before DB
close. Pull yields one whole source message. openNonEmpty primes one nonempty
message; empty-source cleanup precedes null. Iterator/acquisition/cleanup failures
propagate. Finite witness/forwarding wrappers close real iterators and retain signed
framing/introduction order; no output credit or collection policy applies.

## Transport

Concrete lower TCP lends sockets and writes bytes without AgentRuntime/Reactor
knowledge. tcp-conversation composes native RX/TX and owns application parsing.
HTTP/HTTPS priority, TCP fallback, mailbox/direct routing and signed introductions
remain. Explicit replies enable duplex; standalone sends remain transmit-only.
Never open a second runtime over a borrowed runtime's Habery just to receive replies.

socketBytes owns exclusive binary reads and one pending pull. It returns independent
backing, normally in at most 64 KiB chunks; this is I/O granularity, not a memory
bound. Abort/failure/return destroy and join close; genuine RX EOF leaves TX alive.
Connection owners observe socket errors outside the read lifetime. Writers await
callback/drain before another pull. Source-EOF starts an absolute drain deadline;
reply activity cannot extend it. Directional failure stops and joins its sibling.
Local transmission/dispatch counts prove neither authenticated reply nor remote
acceptance. WitnessReceiptor requires persisted wigs at the selected witness index
before fanout. Receiptor/catchup borrow a Reactor selected at construction or create
one over the existing Habery. They never create AgentRuntime, extra stores or
workers. Anchorer also selects its Reactor/services once; processAllOnce takes no
parent. Raw witness/Poster sends accept the actual Reactor for TCP reply intake.
The HTTP/TCP operations retain actual cancellation and joined cleanup.

Tufa tracks accepted handles/connection scopes until actual close without count
caps, shared allowances or busy/drop callbacks. Wire/recognized peer failure is
connection-local; infrastructure/cleanup failure reaches the host. Each socket
keeps one pending parser pull plus deferred-query readiness. Host runtime drives
escrows; standalone listener borrowers must provide that driving. Shutdown stops
acceptance, joins RX/dispatch/TX/socket/listener, then closes stores.

HTTP scopes own upload/fetch/body through joined cleanup. RequestInit.signal keeps
its reason; pre-abort acquires no fetch. Only owned header timeout becomes mailbox
null. Foreign AbortErrors remain failures. No HTTP/header/diagnostic byte policy
or local capacity refusal exists. Strict and internal attempt senders share owners;
only positive peer HTTP refusals yield expected refusal outcomes. postCesr sends
successive framed POSTs; KERIpy714 StreamMessenger bulk PUT is a documented wire
choice, not authority to change the endpoint. Preserve auth through media retries.
HTTP shutdown closes runtime response/SSE streams before listener drain. Signals
must wake the supervisor; task halt alone does not qualify signal shutdown.
Post-header body failure terminates the transfer and reports the original error.

## OOBI, DID and mailbox

OOBI complete messages may commit before response EOF. Keep the original durable
queue row through intake and joined cleanup; errors clear in-flight markers while
retaining retry ownership and accepted events. The active-job guard is an earlier
scope resource, not a bare finally flag. No busy/limit requeue path remains.
Stage/validate all child URLs before queue/moobi writes, then publish cues.
Introductions evaluate proof and queue changes in one synchronous owner turn.
Resolved means retrieval complete, not universal event acceptance. JSON/schema
collection has no byte policy. Authenticator performs status-only GETs with real
clock/HTTP services; response cleanup failure cannot publish authorization.

DID resolution waits for KERI/VDR EOF plus escrow convergence before hosted JSON
or result. Compare complete generated/hosted documents. Only default native
fetch-header TypeError or non-ok status permits alternate URL fallback; injected
TypeError/body/parser/storage/cancellation failure propagates. Failed cleanup blocks
fallback. Finite documents/receipt proofs keep validation and joined cancellation,
without quotas. Static artifacts capture a regular-file extent, ignore growth,
reject truncation and close after joined reads; 64 KiB chunks are no size guarantee.
Dynamic did.json opens no CESR replay. Further lazy generation/export is deferred.

Provider Mailboxer lives above Habery; recipient topic cursors remain protocol
state. fwd stores the inner message. Recipient authorization gates storage; reading
requires requester identity/current signature threshold, not correlation alone.
Check exact signatures, cigars, old keys, duplicates and current sender refusal.
Mailbox polling chooses HTTP(S); TCP-only explicit roles retain precedence while
awaiting HTTP. With no explicit route, poll all eligible witness endpoints in stable
order so an answer at a different witness remains recoverable.

SSE awaits each complete event's consumer before another read. Timeout/EOF/cancel
discard unfinished events for retry. Command-local polling resumes using endpoint/
habitat indices after its absolute time window; no flattened peer queue is added.
Continuous sinks finish before cursor advancement. There is no consumer inbox/ack.
Provider reads only on demand and closes LMDB iterators before suspension. One
row frames in 64 KiB output chunks, without a message cap. Query responses own
nested readers; direct responses remain tracked. Director close wakes polls and
rejects new direct/query responses before stores close. Keep exact nonnegative safe
cursor ordinals, unmatched order and independent cleanup failures.

## CLI and follow-ups

Tufa owns CLI, role hosts and listeners; KERI exposes library/runtime/DB. Existing
store commands use withExistingHabery/withAgentRuntime/withHabAndAgentRuntime;
ensureHby is create-if-missing startup. Bootstrap uses explicit config paths.
Respect the advertised Node floor with ordinary Promise construction; source Deno
or newer-Node smoke alone does not qualify packed minimum-Node behavior.

Signaler holds ordinary transient collapse/expiry hints, following KERIpy. Notifier
publishes only after durable mutation; false/throw emits no hint. Later signal
failure does not roll back the notice. Created producers close, injected ones stay
borrowed. Full composed failure/restart and real cross-language disclosure/KRAM
qualification remain open. See [runtime contract](../../docs/design-docs/runtime/INGRESS_AND_EGRESS.md),
[transport plan](../../docs/plans/runtime/TRANSPORT_PLAN.md),
[cue design](../../docs/design-docs/runtime/CUES.md),
[mailbox design](../../docs/design-docs/mailbox/MAILBOX.md).
