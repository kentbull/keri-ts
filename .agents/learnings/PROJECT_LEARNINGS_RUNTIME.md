# Runtime and mailbox learnings

The [runtime contract](../../docs/design-docs/runtime/INGRESS_AND_EGRESS.md) owns
operational detail. [ADR-0013](../../docs/adr/adr-0013-simple-component-flows.md)
owns architectural constraints; the [roadmap](../../docs/plans/PARITY_ROADMAP.md)
owns remaining qualification. Keep this routing memory concise, not a removal log.

## Composition and execution

One runtime serves a Habery or command invocation. Hosted AID selection is
separate from listener topology; never auto-host all Habs or expose signatory/AEID
as normal identities. Provider storage is explicit enableMailboxStore or a borrowed
Mailboxer, not AgentMode/runtimeMode. HTTP and clock dependencies are separate
required component arguments. MailboxPoller owns its concrete HTTP/SSE request
operation; there is no separately injected polling strategy. Requests carry data
rather than collaborator bundles.
Choose concrete dependencies at construction; no parent-runtime discovery in
Respondant, WitnessInquisitor, Anchorer, receipt owners or lower TCP transport.

runAgentRuntime and runAgentRuntimeUntil use the same workers. Finite completion
observes accepted state and elapsed deadlines, then joins work before store close.
A blocked mailbox/OOBI request cannot serialize ingress or other endpoints. No
serial runtime pump, finite mailbox turn, polling budget/resume index or test alias
remains. Phase-specific tests call actual operations; preserve later-operation cues
when separating fixture setup. Protocol-only local endpoint/startup intake uses
settleRuntimeIngress and verifies accepted records, without unrelated host work.

DID, challenge, delegation, multisig and IPEX commands observe the host workers.
The did:keri resolver projects accepted state; CLI owns introduction waits and HTTP
uses its existing host. Group approval selects the member signer; join shares one
elapsed deadline with local-completion fallback. IPEX poll owns one settled-batch
consumer while the host omits a second poller. Normal completion waits for delivered
batches; deadlines join cancellation. The supervisor suspends rather than pumping.
The HTTP kernel selects serviceHab/hostedPrefixes once and owns actual listeners;
startup reconciles required signed endpoints before listening. Bootstrap uses alias
dt/curls, then accepted endpoints, with localhost only if both are absent.
Config iurls/durls/wurls/curls are absent or arrays of nonblank strings; preserve
accepted strings exactly. Habery validates all three preload lists before either
OOBI store changes, even without dt; alias curls validate before signed replies. Location
and role changes use signed Revery intake, not direct locs/lans mutation.
Init validates one explicit encryption method before opening config/stores;
AEID/seed bypasses prompting. Interactive passcodes use the scoped hidden-input
owner, including EOF/cancellation cleanup. Noninteractive reopen preserves its
actual failure; no visible prompt retry or implicit temporary init fallback remains.

Source CLI/tests and the DID container run Deno; packaged CLI launchers run Node.
[runtime memory](../../docs/design-docs/runtime/RUNTIME_MEMORY.md) owns executable
selection, the digest-pinned caged Node profile and RSS/heap measurement limits.
A different Node base cannot compress Deno, and runtime tuning is not an application
memory budget. Native-heavy macOS qualification uses Linux volumes without host binds.
Release-peer transport probes use the canonical reference profiles independently of
the mailbox fork. The 1.2.x target is GLEIF 1.2.17 with its required GLEIF HIO;
the earlier WebOfTrust 1.2.14 Directant drops queued input at EOF.

## Protocol and output owners

Kever returns decision/follow-up data; Kevery applies KEL policy, Revery owns BADA
and reply escrows, Oobiery owns introduction jobs. Three cue scopes remain distinct:
Habery-local, runtime protocol output before reply capture, and application routing.
Composition routes query to WitnessInquisitor, stream to MailboxDirector, and reply/
receipt/replay work to Respondant/Hab interpretation. A Deck is not broadcast.
See the [cue graph](../../docs/design-docs/runtime/CUES.md).

Composition shares one Revery between Tevery and ProtocolProcessor. Tevery registers its
own TSN routes and advances their retries; ProtocolProcessor knows only its protocol
operations, not separate registry/credential receivers.

ProtocolProcessor dispatches without a global lock. Synchronous domain writers
revalidate prepared evidence against current state at commit. It returns the exact
envelope/decision and mailbox authorization captured before optional escrow I/O.
KRAM may accumulate threshold proofs. Publication owns its committed cue batch
before notifying request observers; reentrant dispatch cannot steal that batch.
New correlations also capture already-published output. Each input/escrow operation
joins its actual input and handler cleanup. Reactor owns byte ingress
and its parser; Oobiery independently owns fetched parsing and its Kevery over the
same store/reply verifier. Endpoint-role proposals receive concrete Habery/protocol/
Poster dependencies; commands own delivery workers. Actual callers await input cleanup;
there is no duplicate queued-ingress API or idle msgDo worker. Runtime pending
state describes its real owners, not a dormant input queue. Explicit close and
scope exit clear cues after dependent work joins.

Multisig message signing, exact local admission and concrete sending share one
cohesive module. Typed `messages` identify outer EXNs and Multiplexor payload keys;
completed destinations never imply participant approval. Tufa projects the affected
CLI results after owned resources close; KERI returns one `RegistryResult` or
`IssueResult` per operation, with optional group facts even when no remote member
was contacted. Public send identities are `GroupMessageRef`/`GroupSendResult`;
signed inputs and individual delivery helpers remain internal.

Prepare/sign/publish before source removal; preparation failure retains the record.
TCP output returns operation completion, without byte/frame telemetry. Reply-mode
TCPMessenger.receiptDo additionally joins receive EOF; accepted state and verified
receipts remain the protocol-success evidence.
Poster.send accepts one complete CESR message; sendStream admits a finite ordered
stream with first-role endpoint selection. Initial IPEX grant/admit/spurn use stream
operation; join signaling/completed output use ordinary sends. This is producer
context, not a flag or route/topic inference. Target preparation is an owned operation
using the shared codec: v2 bodies/genera use a signed body-digest `/fwd` with one
independently authenticated nested message; legacy messages use pathed embeds.
Qualified selectors must not reach the legacy body-only reaper. Poster awaits
preparation for each admitted event. No generic output executor is needed.
Organizer resolves aliases at the producer boundary; Poster receives destination AIDs.
Poster constructor dependencies are explicit; its provider store is `mbx`, with
null representing absence. `ensureOpen` guards admission/waiting and production
preflights; already-built message admission needs no redundant producer guard.
Poster is the single execution owner for admitted messages and cue output. Its
independent deliverDo worker is composed beside query delivery; ingress publishes
without running Poster. send accepts src/dest/topic/msg and copies the source
bytes. Callers needing completion request notify and wait on the exact returned
event identity, not a SAID. Cancelling a waiter releases only its observation;
delivery remains queued. Consuming outcome cues never determines pending work.
Standalone commands start and join their own Poster worker. Exchange producers
construct/sign with createExchangeMessage in exchange-messaging; the standalone
sendExchangeMessage helper accepts dest and uses the same queue/worker path.

Respondant eagerly materializes local KEL/TEL replay and correlated TSN pairs
before atomic publication and source removal. Hab.processCuesIter yields raw wire;
typed cues route queries, streams and observations directly. ReplayCue uses msgs.
Poster evts carry src/dest/topic/msg and execute FIFO with sequential targets.
Observed refusal attempts remaining targets and reports partial success in the
concrete outcome. Actual callers wait on their admission; unobserved failures are
reported at Poster with routing context and the original error, without raw source
bytes. Cancellation/close report unconsumed failures once. No unused failure backlog,
retry/discard API or automatic retry remains. A reported source has no owner-retained
recovery history. Pending work depends on evts and active execution, not outcomes.
Unexpected construction/storage/parser/cleanup errors publish/report then propagate.
No final-packet cache, manual reply cursor or cross-batch fairness remains.
The [runtime contract](../../docs/design-docs/runtime/INGRESS_AND_EGRESS.md) defines
current behavior; Git and PR checks retain implementation evidence.
WitnessInquisitor owns pending requests and one current attempt, never workflow observers.
Concrete query operations own accepted-state waits; the composition routes live
key-state facts through an Effection channel. Runtime pending state describes
sending, while the invoking operation represents active semantic work. Tufa owns
query command composition and final display after close; an unsatisfied deadline
fails without OOBI catch-up. HTTP queries acknowledge intake and send-only
HTTPMessenger binds an endpoint and HTTP
client without protocol state or a clock. TCPMessenger binds its endpoint and clock;
only duplex replies need a protocol receiver. Ordinary sendSource means per-message
POST iteration for HTTP or raw source output for TCP, not a stream HTTP PUT.
Concrete messenger factories select resolved HTTPS/HTTP/TCP URLs without looking up
identity preferences. HTTPStreamMessenger sends one prepared opaque PUT and returns
owned response bytes; TCPStreamMessenger uses the existing raw writer. Neither
adds a queue, worker, receive callback or payload-persistence framework. Poster
selects those operations from admission intent; no Habery/global framing preference
or CLI override remains. Queries and mailbox polling use ordinary signed POSTs. Mailbox polling shares
CESR egress's exact Falcon media-refusal predicate and joins refused-response
cleanup before one alternate media submission of the same signed query. Cursor
publication still follows successful consumption.
Forwarded mixed-genus streams declare each prepared frame's actual genus, including
legacy introductions, so a v2 parser cannot misread their counters. Entirely v1
streams retain unqualified legacy framing for old peers. Transport stays opaque.
No CueSink, generic preparation/delivery wrapper, custom-emission injector or no-op
query sender remains. QueryReply peek/take returns data; request owners publish
both TSN replies before taking records. Current authorization defeats old matching
cues. TCP retains request-owned replies; HTTP ordinary queries return 204 and
publish through Respondant/Poster. Authorized mbx requests retain SSE.

QueryRequest has one required q body and target. signer is a local AID resolved
from Habery; src is the remote attester. An unavailable explicit signer never falls
back. Otherwise choose the configured Hab or sole Hab; never guess among several.
Keep pending identifiers, not Hab objects. Query preparation captures that signer's
introduction, endpoint and exact bytes. Follow KERIpy random selection within the
first controller/agent/witness role, or within an explicit witness list; no mailbox
query fallback. Missing selected locations remain visible. endsFor retains empty
location maps while preserving the existing allowed/enabled authorization filter.
Failed/cancelled attempts are consumed; unresolved requests rotate and close joins
output before clearing. Anchor queries
ask each eligible attester once, or retain one deferred request. Completion uses
accepted seal/key/TEL state. Schema/credential hints stay notify-only; prebuilt reply
routes stay in their serder and typed TSN state serializes at Hab interpretation.
See [query contracts](../../docs/design-docs/runtime/QUERY_REPLY.md).

## Cancellation, stores and replay

Acquire resources before their work children. Abort I/O, join children and return
iterators before releasing stores. Register Promise cleanup before leaves start;
bare yielding finally blocks can lose late failures during Effection halt. Suppress
only exact owned abort reasons/already-reported errors; preserve a lone foreign
failure's identity and preserve distinct cleanup failures. Interrupt/join actual I/O
before reader release. HTTP relies on native Fetch abort for unread/blocked bodies;
Node 20 replacement body AbortErrors normalize to the owning cancellation reason.
External input abort stops waiting dispatch and active consumers, as well as reads;
check before pull and after results. Finite parser/codec APIs have no lifetime options.

Runtime borrows Habery/injected stores; defaults are owned. Readonly Haberies
create neither default registry. Legacy Regery owns Reger/Tevery/Verifier; v2 Regery
owns the RegBaser shared by IPEX/ProtocolProcessor. Inject actual processors, not service bags
or optional-method probes. Application entrypoints select optional registry owners
before effects; subordinate operations receive Regery/Reger, Reactor for byte input,
ProtocolProcessor for shared protocol work, or Poster for delivery.
Keep capability guards for explicitly injected optional stores and lifecycle guards.
Notifier borrows a required Signator, Noter and optional Signaler; runtime injection
must match its Signator and any explicitly supplied Noter/Signaler before acquisition.
Organizer borrows Baser and an explicit optional Signator; unsigned-read policy is
unchanged. Neither component discovers its signing dependency through Habery.
Factories own failed/unreturned acquisitions before reopen suspends; repeated close
and scope exit are harmless. Default Noter/Mailboxer use Habery's temp policy.
Acquire output after DBs so reverse teardown joins it first.

Replay captures prefix/FEL horizons; later events cannot extend them. Hydrate current
proofs on consumption and close cursors before yield. Witness SN replay preserves
insertion proems and excludes later FEL ordinals. Cyclic delegation/corrupt rows
still fail; numeric representation guards remain RangeErrors. Endpoint proof order
and original seals are canonical; exactly one cigar contributes a couple and no
proof fails. ReplyStreams tracks actual readers through EOF/cancel/shutdown. One
pull yields one source message; openNonEmpty settles empty-source cleanup before
null. Finite wrappers close their source iterators. Ordinary records need no leases.

## Transport and protocol completion

Lower TCP lends sockets/bytes without AgentRuntime/Reactor knowledge;
TCPMessenger owns application RX/TX and its parser/Kevery. Endpoint schemes prefer
HTTPS, HTTP, then TCP; no refusal-driven scheme fallback. Ordinary Poster traverses
controller/agent/mailbox roles, all direct endpoints then one random relay. A local
provider shortcut requires the composed store, not a sender match. Witness delivery
applies only without those roles. No delivery-mode selector remains. Signed
introductions retain their protocol role. Explicit replies enable duplex; standalone
send is transmit-only. It completes local end then joins close without requiring
peer EOF; a later receive reset does not downgrade completed output. Duplex still
requires processed receive EOF. Never open a second runtime just to receive replies.
Native callback/drain precedes the next outbound pull. socketBytes owns exclusive
reads and one pending pull; 64 KiB is granularity, not a memory guarantee. RX EOF
leaves TX alive; abort/failure/return destroy and join close. Drain deadlines are
absolute, not extended by activity. Shutdown stops acceptance and joins both
directions/listeners before stores. Recognized wire/peer failures stay connection-
local; infrastructure/cleanup failures reach the host.

Composition supplies HttpClient.request (completed finite bytes) and open
(scoped streaming response). FetchHttpClient constructs Request
before native fetch classification and owns response-read cancellation and joined
cleanup. Producers prepare finite HTTP bodies before requesting; no upload-source
factory or upload pump remains. Consumers borrow HttpStreamResponse metadata and body(signal) only through open;
finite HttpResponse bytes remain usable after request cleanup. Native Response never escapes.
Source/parser/consumer errors remain distinct; test clients explicitly produce
TransportError for simulated network failure. No client singleton identity check
controls failure handling. Header-timeout and SSE window policy remains with callers.
Enabled consoleLogger diagnostics write to stderr at every level; CLI data stays
on stdout. Preserve loglevel gating and the original message/metadata arguments.
HTTP scopes own fetch/body and preserve signal reasons. Pre-abort acquires
no fetch; only the owned header timeout becomes mailbox null. Positive peer HTTP
refusal is distinct from parser/source/storage/cleanup failure. Ordinary postCesr
sends require full successful response EOF, refuse redirects without replay and
wrap only native fetch/body failures in TransportError with their original cause.
HTTPMessenger consumes response bytes without interpreting protocol evidence;
postCesr/attemptPostCesr have no response callback. requestFrame lends response
metadata/body only within that request scope. Bounded SSE consumers remain immediately awaited in their source owner, preserving
backpressure, cursor ordering and consumer-plus-cleanup failures. A pull-only borrowed
iterator cannot observe consumer failure; add no queue/task or new closing protocol
solely to remove this local call. Named query/cursor consumers retain their response lifetime. Poster contains
TransportError only around actual send calls; unknown errors still propagate.
postCesr sends successive framed POSTs; KERIpy714 bulk PUT is a documented wire difference.
Preserve authentication through media retries. Post-header failure terminates the
body and reports the original error. Signals must wake the host supervisor.

Local transmission/status proves no remote acceptance. Receipt completion requires
persisted indexed wigs for the requested event's accepted witness cohort, including
historical retrieval after witness replacement. Baser resolves interactions through
their preceding establishment, even empty cohorts. Missing dependencies remain
escrowed. GET without matching proof returns false; complementary fanout reads
verified indexed proof, never raw peer fields or unrelated receipts. Receipt owners
receive ProtocolProcessor and I/O dependencies explicitly; standalone entrypoints
compose minimal processing over the existing Habery.

## OOBI, DID, mailbox and notices

OOBI keeps its durable job row until terminal intake and joined cleanup. Failure
clears in-flight markers but retains retry ownership and accepted events. Validate
all child URLs before writes, then publish cues. Retrieval completion is not universal
acceptance; accepted resolution convergence excludes unsolicited receipt delivery
to static OOBI servers. Ingress/query/escrow dependencies still matter. Authenticator
uses status-only GET; cleanup failure cannot publish authorization.

DID resolution completes KERI/VDR input and escrows before hosted JSON/projection;
compare complete generated/hosted documents. Only explicit opening TransportError or non-ok status permits alternate URL fallback; injected TypeError,
body/parser/storage/cancellation/cleanup failure propagates. Static files capture
regular-file extents, ignore growth, reject truncation and join close. Dynamic
did.json opens no replay; broader lazy generation/export is deferred.

Mailboxer lives above Habery. fwd stores the inner message under recipient
authorization; reading requires current requester proof/threshold, not correlation
alone. Keep protocol messages/cursors, not unsupported consumer inbox/acks. Poll
HTTP(S), alongside all current KEL witnesses. TCP-only providers do not suppress
witness polling. A shared provider AID has one worker and cursor even if authorized
as both mailbox and witness; locally controlled providers use ordinary HTTP intake.
Polling timeout overrides floor finite positive values with a 1 ms minimum;
missing/nonfinite/nonpositive values retain the header/poll defaults.
Remote SSE consumer completion precedes durable cursor advancement and the next
read. Stored positions are last-consumed; requests send next-wanted. MailboxPoller
retrieves only endpoint streams: batches carry pre/eid/messages, and eid is required.
There is no automatic local-store consumption or process-local recipient cursor.
Provider storage and its query/SSE readers remain independent: authorized fwd and
Poster local storage do not dispatch the stored message. Use direct HTTP/TCP or
explicit protocol intake for immediate recipient processing. Do not add an optional
local reader or infer its need from co-resident Mailboxer/controller objects.
EOF/timeout/cancel discards unfinished SSE events. Provider reads on demand, closes each LMDB
iterator before suspension and frames a row in 64 KiB chunks without a message cap.
Director close wakes polls/rejects new streams before stores close.

Notifier publishes transient Signaler hints only after durable mutation; false/
throw emits no hint and later signaling failure cannot roll back a notice. Borrowed
producers stay borrowed. Tufa owns CLI/role hosts/listeners; KERI owns library/runtime/
DB. Bootstrap uses explicit config paths.

The maintained interop-kram owner checks single/group mailbox authentication in
both directions, including partial thresholds, replay, stale and foreign proofs.
SIGKILL/reopen cases retain provider/sender identity, exact pending proofs and
accepted cache state across actual processes; only the remaining member proof
completes the group, and post-restart replay cannot redispatch. Payloads are fixture
data. Separate witnessed TS IPEX cases complete apply through admit over the
KERIpy mailbox with single/two-of-two holders, three Python witnesses and real
issuance proofs. Group grant proof remains incomplete after one contribution,
then completes with the second; provider and recipient acceptance stay distinct.
Those cases use TS credential processors. Separate pairwise mailbox cases use
real Python StreamPoster/Poller and TS Poster/KRAM intake in both directions,
including independent two-of-two TS senders/recipients, three witnesses and
signed unregistered chain/branch partials. Delivered missing/unsigned ancestors
are refused before valid grants complete through admit. Exchange signed mailbox
endpoint authorization as well as KELs; otherwise routing may choose a witness
mailbox. Keep v1 witness KEL/OOBI context separate from v2 mailbox/IPEX framing.
TS presentation-cutoff cases preserve HTTP controls and add mailbox-carried grant
contributions/replay, delayed observer evidence and reopen with immutable receipt
time. Python may coalesce attachment groups and reorder group kinds: compare exact
signed bodies/signatures, ordered blind-state proofs and source seals rather than
incidental outer wrapper bytes. Missing proof material is not normalization.
Python public presentation-registry intake and witnessed process-crash combinations
remain unqualified; provider SIGKILL cases retain their separate assertions.
Packed minimum-Node, strict declarations, real native rows and composed disclosure/KRAM tests remain release
gates; source Deno or addon-loading smoke alone does not qualify them.
