# Runtime and mailbox learnings

## Removal precedence (2026-10-15)

[ADR-0013](../../docs/adr/adr-0013-simple-component-flows.md) now requires removal
of all application budgeting and unsupported outbox, mailbox consumer-ack and
KRAM ready/snapshot durability. Any descriptions below of credits, reservations,
capacity admission or those delivery guarantees describe transitional code, not
instructions to preserve it. Remove those passages with their owning code rounds.
Preserve independent wire/crypto/transaction correctness and actual cleanup.
Only a minimal private socket constraint justified by production evidence may
remain; no parser, domain, storage, runtime or CLI accounting exception exists.

## Scopes and state

One host/runtime serves a Habery or command invocation; hosted-AID selection is
separate from listeners. Do not auto-host every Hab or expose signatory/AEID as a
normal identity. Endpoint-role support does not imply startup should seed that role.
Use signed loc/scheme replies through Revery, never direct locs/lans writes.
Alias config dt/curls is the bootstrap source; synthesize localhost only when both
config and accepted endpoints are absent.

Kever decides, Kevery routes KEL/KEL-derived replies, Revery owns BADA/reply
escrows, Oobiery owns introductions. Runtime and local Habery.kevery have distinct
cue decks. Query cues and pending requests use one required KERIpy-shaped `q`
body. Routed requests correlate logs/ksn/tels/tsn with their concrete filters and
keep one required target in the envelope. QueryRequest is the shared routed record;
its optional signer names a local AID and src names the remote attester. Continuations
and pending work retain identifiers, not Hab objects. QueryCoordinator resolves an
explicit signer through its existing Habery; an unavailable selection stays pending
rather than falling back to the configured/sole Hab. Hab interpretation defers cues
selected for another signer to correspondence. Query delivery resolves that same
signer for endpoint lookup and introduction; a transport sink's ambient Hab cannot
supply the introduction for another selected identity. Anchorer receives only the
concrete QueryRequest enqueue port, not the consuming coordinator's control surface.
Hab.query accepts that instruction plus
its existing mailbox-topic form; raw protocol-eventing.query remains the open codec
boundary. Do not restore a `query` alias, duplicate body target or arbitrary route/body
bag. Schema/credential notices retain their separate KERIpy-shaped hint records.
TEL recovery cues require registry/credential fields, with issuer only when needed.
Reply cues separate prebuilt serders from typed registry/credential TSN records.
Prebuilt routes live only in the serder; TSN state is serialized at Hab interpretation,
where the local attester suffix is known. Do not restore optional data/default empty
replies or erase required state fields through a generic route/data helper.
Incomplete query cues require QueryCoordinator to resolve a local
habitat and honest remote attester before producing wire. Hab.processCuesIter
remains the cue-semantics seam. CueSink admission receives the actual source queue,
not AgentRuntime. respondantCueSink wires source-to-delivery work at the runtime
root; do not inject a delivery-worker bundle into Respondant. CueDelivery owns
its lazy cursor and exact pending target, exposes synchronous preparation and
retirement, and does not discover runtime services or execute transport. The
delivery queue applies joined transport outcomes and owns failed-packet transfer. Cursor/packet
cleanup borrows emission and route data. All cue queues and correlated reply
batches carry ordinary records. Only actual output/iterator resources need cleanup;
do not wrap cue references in retain/release handles. Reply routes retire with queued delivery even when an HTTP borrower
keeps emission bytes alive. Preparation returns
prepared/empty records. Query publication returns transferred/ineligible; there is
no application-capacity busy result. Failed destination preparation preserves the source; foreign preparation
failures retain their exception identity. Strict preparation callers keep their
throwing boundary. QueryCoordinator
prepares/adopts pending queries synchronously over committed accepted state,
without Reactor callbacks or parent-runtime arguments. Network waits remain in
delivery, and failed/cancelled drains retain pending ownership through cleanup.

KERI/Tufa operations own lifecycle. Acquire source/frame/runtime resources before
work children so cancellation aborts and joins I/O before releasing permits or
owners. Promise adaptation belongs at real edges. FrameIntake owns demand-driven parser/source acquisition and source concurrency;
application composition shares that owner with HTTP, witness and TCP intake.
Its admission stays private and predates parser cleanup; per-source options do
not expose a resource policy. Reactor serializes dispatch,
escrow and cue handling; a cue consumer must not reenter its guarded Reactor.
QueryCoordinator owns an ordinary private Deck of plain QueryRequest records.
Pending inspection exposes length/empty/peekHead, never queue mutation. Query
metadata and continuations have no byte reservations or configured caps: no
production caller used those controls and no demonstrated backlog justified them.
The current head remains until send/transfer succeeds; failed or cancelled sends
retry it, unresolved records rotate, and new work waits for the next finite pass.
Close cancels/joins active consumption before clearing. Actual wire/source owners
retain their separate admission and joined cleanup; this is not a shared memory bound.
Query delivery borrows its input record without recursively estimating or reserving
its metadata again. Existing held source credit still participates in the combined
capacity check to distinguish impossible work from temporary contention. The
prepared wire ceiling is checked after construction; it is not an input-allocation bound.
Cue interpretation and direct replies likewise borrow plain input records without
recursive metadata charges. Admitted source owners still survive fanout and joined
cleanup; combined preparation includes their existing credit, never a duplicate estimate.
Receiving mailbox identity is an explicit per-message argument, never ambient
mutable request state. Without explicit mailbox routes, poll every eligible witness
mailbox in stable order through the existing per-endpoint workers. A logs reply is stored at the
witness that answered; querying alternatives while polling one retired witness
cannot recover it. Explicit mailbox precedence remains separate.
Mailbox query correlation uses an ordinary Deck, preserving unmatched order.
Selecting a match removes the record; nested readers retain their own real cleanup.
Shutdown joins active reads before clearing unmatched correlations.
Shared transport readers cancel once, join that Promise and always unlock;
single errors retain identity and distinct read/cleanup failures aggregate.
SSE's earlier reader owner re-observes its pending read/cancel Promises after
halt, preserving late failures and releasing the lock even when cleanup fails.
Response cancellation uses an earlier scope resource: a bare yielding finally
can join its Promise while losing a late failure during cancellation. Unacquired
HTTP response/request bodies propagate cleanup failure instead of discarding it.
CESR request teardown may error an unread successful native response body.
Suppress only the intentional controller's exact abort reason from body cancellation;
foreign AbortErrors and cleanup failures still propagate after shared credit releases.
HTTP/TCP prepared attempts consume the sender's joined expected-refusal result directly;
strict source/frame APIs keep their throwing contract. HTTP owns its parser refusal
bridge; TCP's application conversation owns parser admission while byte egress
returns only its own capacity refusals. Prepared delivery does not observe exception
identities. Strict and attempt APIs share the same connection and cleanup owners.
Transport refusal observers are removed. Attempt helpers stay internal to their
modules; the runtime package exposes supported strict sender/conversation APIs.
Fetch teardown joins pending rejection as well as late response cleanup. Timeout
null recognizes only its controller's exact reason; foreign same-class AbortErrors
and I/O failures propagate without repeating an already-reported object.
Generic and CESR requests share the pending-fetch/response owner; CESR upload and
diagnostic leaves stay separate. Register HTTP credit before response owners so
their joined cleanup completes before the credit releases.
HTTP ingress joins its own halt and closes published reply output on late abort
outside status mapping. Preserve the mailbox's ordinary idle-timeout outcome.
Parent cancellation diagnostics still need composed owner qualification.

Owned hydration uses an isolated consume callback with direct joined finalization.
A bare yielding finalizer can resume cancelled parent work; resource-only teardown
can hide disposal errors after delivery. Fail cleanup before returning to its caller.
KRAM handoff retains its local busy guard until that disposal and checked durable
acknowledgement finish. Failed callbacks, disposal or ack preserve ready retries;
callback side effects/owner adoption are at least once, without rollback.
Kramer/handoff borrow Baser's exact policy; acknowledgement snapshots reserve before
copying and retain credit through staged consumption, joined disposal and acknowledgement.
Per-Baser active scope counts exclude synchronous cache maintenance, while
admission remains guarded per instance; neither supplies a shared memory budget.

Runtime store acquisition and ownership must be visible in composition-root
control flow. Default `acdc.rgy` and legacy TEL stores are scope-owned; readonly
Haberies get neither, and injected services remain caller-owned. The v2 manager
shares its one store with IPEX and Reactor; keep it separate from `vdr.rgy`. Factories retain
cleanup responsibility until returning their opened store. Explicit runtime close
and scope exit both join cleanup; scope exit after explicit close is harmless.
Runtime-created Noter/Mailboxer stores are acquired before cancellable reopen and
close with the Habery temp policy. Failed/unreturned acquisition is owned too;
injected sidecars and standalone helper lifetimes remain caller-owned.

Baser fixes its ResourcePolicy before reopen and local Habery/signator construction.
CLI opening forwards it; AgentRuntime inherits it and rejects policy mismatches.
Borrowed runtime shutdown leaves Baser ownership intact. Native transient copy
admission remains phases 4/5; accepted cache residency and public borrowing/eviction
redesign are deferred. Report state growth separately from the in-flight guarantee.

Authenticator borrows that exact policy even without an AgentRuntime. Its status-only
GET reserves handle/URL credit before fetch; busy retains durable pending work.
Joined response cleanup precedes credit release and authorization publication.
Native fetch headers/buffering and pending-row allocation remain separate bounds.

Shared ResourcePolicy credit belongs to an owner until consumption and joined
cleanup complete. One shared instance is required; separate ledgers do not bound
a runtime. Reactor reserves stream/cursor/producer credit before source acquisition
and retains it through joined parser cleanup. The default eight stream slots leave
headroom for KLI's separate mailbox-role and witness SSE polls; explicitly configured
two-slot deployments can refuse ingress while both polls are live. Byte/decryption
ceilings remain 256 MiB/one, and older two-slot measurements keep that label.
AgentRuntime exposes that same policy
for recipients; shared deployments must inject one policy into all runtimes.
Protocol producers and consumers share ordinary Deck records. KEL/Revery/KSN,
registry/credential TSN, EXN, verifier and OOBI publish cues after the owning
writes. KEL live state and cues wait for native commit. Broker membership controls
duplicate queries and dependency migration. No cue inspection, capacity, policy
identity, prepared-batch or reference-owner layer remains. QueryReplies correlates
ordinary batches; readiness callbacks preserve paired replies and cancellation
returns uncaptured records to the background flow. Runtime shutdown joins output
cleanup, clears records, then closes owned stores. RuntimeDeliveries accepts
prepared QueryDelivery records directly, without a policy constructor, request/route
quota, preparation callback, credit or refused-admission wrapper. Query transport
prepares signing, introduction and endpoint selection before source removal.
Forwarding/OOBI construction limits and ReplyStreams accounting remain separate
removal work.
ESSR requires the host's policy and holds crypto credit until I/O and
untransferred-owner disposal join. Busy and configured-limit refusals do not establish message invalidity.
Complete-record ingress charges shared bytes before copying; queued and processing
owners retain local capacity and the lease through retry and joined cancellation.
clearIngress releases only queued owners and invalidates late retries. Runtime
close/scope exit clears queued leases without releasing active processing early.
Lazy HTTP replay reserves shared stream/event/chunk credit before opening its
iterator and returns it only after source cleanup. Busy HTTP admission returns 503;
configured size refusal remains 413. Neither creates retry scheduling.
Nonempty response detection primes one bounded event under that same owner;
empty sources close before returning null and runtime close drops primed bytes.
OOBI serving captures bounded endpoint/delegation descriptors only after admission,
closes metadata cursors before hydration, and borrows Hab/store through cleanup.
Fresh preparation caps are conservative; native metadata/proof allocation remains open.
Finite forwarding introductions must cap before retaining messages, including
ordinary wrapper defaults; a lazy source alone does not qualify bulk transport.
RuntimeDeliveries owns the existing finite query queue; retained cue adoption
uses this same owner rather than adding a parallel queue. Query producers run
only after preparation/request admission. Queued requests retain
credit through failure/retry; shutdown releases an active head after transport cleanup joins.
Runtime HTTP services must carry the runtime's exact policy. Frame requests acquire
stream/copy credit before serialization or fetch and release it after joined cleanup;
source-driven output holds one stream/cursor owner across parsing and HTTP, with
separate tree/stage/output byte credit. Query responses use the remaining ingress
slot. This does not establish a native fetch bound.
See the [reservation contract](../../docs/design-docs/runtime/RESOURCE_POLICY.md).

## Transport

Require streaming where KERIpy 714 supports it; further stack-wide discovery,
artifact and CLI conversion is deferred. Required callers use shared engines and
response owners with the runtime's exact services/policy. Finite JSON/receipt semantics
require enforced caps, cancellation and joined cleanup. OOBI/DID completion still
requires full evidence; processing before EOF does not imply artifact success.
Close adoption through default library/host/CLI callers, not only engine tests.
Every finite exception needs a semantic reason, ceiling, admission owner and
joined response lifetime; audit newly introduced I/O on the final release head.
Audit producer preparation and retained output as well as the shared engine:
history collection before sending and uncharged copies after reading bypass the
contract. Finite JSON/proofs may require whole-document semantics, with admission
before avoidable allocation and ownership through consumption or explicit transfer.
The finite and streamed messenger entry points share two engines. Parsed
frames bypass parsing; borrowed owners outlive joined transport cleanup. HTTP
`postCesr` means successive POSTs, even when each frame body streams. Local drain,
HTTP success, verified replies and durable acceptance are different outcomes.
Command-local mailbox polling resumes across endpoints and habitats after its one
absolute turn budget expires; an empty early long poll must not starve a proxy's
queued replay. The resume position retains only two integer indices, with no peer
queue/cache or new workers. Habitat/endpoint discovery still borrows existing
accepted metadata; it does not establish a new bound on accepted-state residency.
Mailbox SSE polling selects HTTP(S) only, as KERIpy 714 Poller/httpClient does. TCP-only
remote mailbox roles keep precedence while awaiting HTTP; delivery URL selection
retains TCP fallback. Witness-only polling also waits for HTTP(S).

Poster route snapshots and synchronous target preparation own habitat/DB work;
prepared sending selects HTTP or the shared TCP engine. Runtime cue/failed-target
use the application `tcp-conversation` flow to compose
same-socket parsing/dispatch. Lower TCP takes only a bounded byte consumer, with
no AgentRuntime, Reactor or FrameIntake dependency. The application consumer
prepares intake before connect and processes its pull stream afterward;
standalone targets remain transmit-only. Keep wire alive through joined cleanup.
HTTP/HTTPS priority and signed introductions stay unchanged. TCP and RX capacity
refusals use invocation-local observation; foreign failures preserve identity.
Raw TCP peer failures still propagate; this adds no new refusal/retry taxonomy.
Public Poster operations retain caller-owned preparation/retention bounds.
Habery owns no outbox sidecar; CLI startup and mailbox debug expose no outbox
option, store selector or backlog. Keeper globals do not enable sender retries.
Poster no longer owns an outbox, queues failures or retries durable targets.
Mailbox sends attempt all targets and throw on any failure, reporting completed
URLs in the diagnostic. Successful results contain only actual local transport
completions; no queued marker implies delivery. Runtime has no outbox worker or
pending-work predicate. Habery/CLI/storage retirement follows separately.
An explicit target cap validates backing and bounds introduction plus forwarded wire
before their final concatenation; direct wire becomes an independent copy. The
caller must reserve preparation/copy credit first and retain it through joined send.
RuntimeDeliveries uses the same eight owner slots for query requests, cue cursors
and failed target packets. Retain exact independent wire until joined delivery or
shutdown; one target per pass keeps admitted siblings progressing. Route metadata
has its own pre-admitted finite credit. Retired owners are local progress, not
protocol success or durable retry. Respondant source heads now transfer immediately
under the guard; their queued network work drains outside it. Unsupported/custom
cues retain existing sink handling; occupied capacity never destructively falls back.
Query wire preparation runs only after bounded input, item, wire,
route and preparation admission; captured signature/routing survive later changes.
Busy preserves the raw or continuation head, and unresolved/custom sinks keep
notify semantics. QueryCoordinator prepares/signs synchronously against committed
accepted state without a parent-runtime argument or Reactor callback; network waits
remain outside preparation. AnchorQuerier retains an owned CESR event-seal SAD in KERIpy’s required i/s/d key order;
CLI anchor JSON/primitive validation precedes controller-store opening.
Anchor continuations ask each eligible attester once; no partial-admission index
is needed for the ordinary pending Deck. A retired first witness cannot strand recovery.
Ordinary queries retain first-choice behavior. Completion uses accepted seal state.
CLI query uses the existing concurrent runner and joins it before state display/close;
serial mailbox polls must not consume the query window before other workers progress.
Schema/credential notices stay notify-only, even when a hint happens to name a known
KEL. Producers use canonical s rather than sn; do not restore fallback logs routing,
redundant r/dig hints or a normalization pass. Request-local HTTP/witness ownership
remains unfinished.
Prepared HTTP/TCP target attempts return local complete/refused/busy only after
joined cleanup, consuming the sender's own capacity/HTTP results. Source, fetch,
sink and cleanup failures propagate unchanged, including foreign same-class errors.
Cue preparation/item refusal follows the same exact invocation rule; foreign
interpretation, route, reserve and observer failures propagate. This does not
admit all decoded/native preparation copies.
Cue interpretation synchronously publishes an ordinary emission before source
removal. Preparation failure leaves the cue available; replay stays unopened.
There is no prepared-emission owner, fixed wire/preparation floor or output quota.
Custom drains pass the emission to their sink outside the guard, relying on the
sink's actual reader/payload cleanup. Drains process their initial cue extent;
records that produce no emission do not stop later records in that pass.
QueryCoordinator transforms once and sends without repeating observation/signing.
Generic HTTP drains use invocation-local habitat/sink selection. Earlier captured
query batches retain their dispatch authorization, rather than borrowing a later
frame. DirectReplyDelivery holds actual CueDelivery cursors; HTTP responses and
queued deliveries independently iterate the same prepared emission records.
Queue-only reply preparation has no unused admission-refusal observer.
Cue routing passes the ordinary RawCesrRoute record directly into delivery.
There is no route metadata reservation, target-count ceiling or release wrapper.
Target preparation likewise returns an ordinary PreparedCesrTarget, without
packet credit, a release handle, a backing-size ceiling or an extra direct-wire copy.
CueDelivery owns its actual iterator and closes it once even when return fails.
Resolver failures propagate before source removal; the delivery cursor owns its
actual replay iterator cleanup. Remaining cue/query accounting is scheduled for removal.

Socket streamability requires a connection-owned parser, bounded handoff and
joined shutdown; parser streaming alone is insufficient. Guard signing/routing/DB
preparation, then transfer admitted delivery ownership before network I/O. Never
wait for queue space under the guard or remove a cue before successful transfer.
Witness source intake uses one scoped Reactor parser and borrows prepared emissions
through joined callback cleanup outside the guard. The existing delivery batch
holds its queue and callback halves; neither re-signs or releases the other early.
Finite wrappers copy each message into caller-owned arrays and close the real
source iterator before returning, including early failure. They impose no output
byte quota. The streaming source path consumes emissions individually and collects
no aggregate. Finite receipt delivery suppression stays explicit.
Genuine receive EOF, transmit failure and remote acceptance are separate facts.
Explicit duplex preserves default routing; half-close drain deadlines cannot be
extended by activity. The [transport plan](../../docs/plans/runtime/TRANSPORT_PLAN.md)
owns the remaining implementation and release gate.

TCP socketBytes uses one exclusive binary readable-mode owner and one pending pull.
Its caller admits both read/copy backing allowances before acquisition and owns
socket errors outside the readable lifetime. Abort/return joins close; genuine EOF
leaves the writable half for explicit connection drain. Never mix flow readers,
or treat high-water buffering as a hard shared-memory ceiling.

Tufa TCP immediate event proofs and query replies own bounded correlated slots;
Kevery accept/duplicate decisions gate event output. Signing stays guarded, socket
writes borrow the connection stream slot outside the guard. Unrelated cues retain
Respondant routing. One missing-state logs/ksn query may stay in its existing bounded
slot; readiness wakes socket output while one joined parser pull stays live. The host
runtime driver owns escrow retries; a standalone listener borrower must supply it.
Tufa TCP bounds admitted/closing tasks before source acquisition; Reactor alone
charges the receive stream. Earlier connection credit outlives joined parser/socket
cleanup. Intrinsic wire refusal must preserve source/storage provenance, and a
parser-owned return must not be mistaken for peer failure. Native rejection handles
and pool/kernel buffering remain explicit finite/qualification boundaries.

Direct replies reserve query SAIDs before dispatch; only the final query owns the
HTTP response. Final direct replies prepare the bounded TSN pair atomically before
slot removal; one interpreted proof is borrowed by response and queued targets
until both cleanups finish. Missing target routes allow response-only ownership;
source/signer/storage failures propagate. Earlier responses still use ordinary delivery.
Queue-only reply preparation shares that atomic wire owner and reserves no HTTP
response permit. Busy retains the original slot, and no-target retirement waits
until nested preparation and source transfer finish. Actual earlier-query caller
adoption remains separate.
A response scope
outlives fetch headers and must not inherit a request signal that aborts when the
handler returns. requestFrame/postCesr retain frame owners until consumption ends.

KEL replay exposes frozen prefix/from/end metadata with a borrowed Baser; TEL
captures at most two frozen ranges and wire settings with a borrowed Reger.
Queue transfer does not open readers or traverse stores. Captures carry no cue
credit. The backing stores must remain open while replay is consumed.
Replay captures first-seen ranges, hydrates one finite event and releases cursors
before transport suspension. Failed delivery retains its ordinary query record;
passes drain only their initial work. Generic witness and signed-exchange
HTTP share serializer output; authorization survives content-type retry. Receipt
responses are intentionally finite proofs.
Witness delegation passes the runtime's services into generic sends. TCP finite/source adapters share one writer: admission precedes socket/factory
creation, backing limits precede writes, and write callbacks/drain precede another
pull. Credit follows source return plus socket close; calling destroy is not joined
cleanup. End/close deadlines start at source EOF, not the beginning of a large transfer.
Accepted-socket output borrows the connection stream slot, reserves separate output backing,
and shares the outgoing callback/drain loop without ending the socket.
Already admitted TCP frames use the serializer directly; shared HTTP/TCP metadata
admission precedes qualification, and actual nested payload owners stay borrowed.

Explicit TCP conversations pre-admit one lazy RX Reactor channel and retain its
runtime/owners through joined directional cleanup. RX EOF cannot end TX; TX EOF
starts the absolute drain deadline. Concurrent children belong to the abortable
I/O scope so cancellation reaches both before either cleanup waits. A drained
connection/dispatch count proves neither verified replies nor remote acceptance.
WitnessReceiptor preserves HTTP-first selection and uses local same-socket intake
for TCP-only witnesses; explicit Receiptor endpoint calls remain HTTP-only. Success requires persisted wigs at the requested witness
index before complementary fanout. Receiptor/catchup borrow an explicitly supplied
runtime or own one scoped receiver; borrowed cleanup leaves its stores open.
Generic sendWitnessMessage remains transmit-only without receiver context. Never
open a second runtime merely to receive replies over an existing runtime's Habery.
Default Anchorer turns borrow that runtime for witness publication; direct standalone
turns without receiver context retain transmit-only policy. Witness inquiries prefer
HTTPS/HTTP, then TCP; RuntimeDeliveries uses the same local reply parser and queue
owner. Query owner retirement means transport drain; continuations still require
verified accepted key/TEL state. Guarded preparation must finish before network I/O.

HTTP shutdown closes runtime-owned response/SSE streams before awaiting listener
drain. Signals must wake the supervisor; task cancellation alone does not prove
the signal path. Otherwise active responses can force SIGKILL.
After headers are sent, a body failure must terminate the HTTP transfer and report
the original error; attempting a replacement status can leave the peer waiting.

OOBI CESR intake streams through Reactor; JSON/schema collection remains finite.
Keep the queued row through full intake, clear in-flight markers on failure, and
retain earlier accepted events. Retrieval completion is separate from universal
message acceptance. The job guard must be an earlier scope resource, not a bare
finally flag: cancellation can enter parent finally while child cleanup still joins.
Oobiery borrows Reactor's policy; GET handle credit precedes fetch and parser stream
credit precedes body reads. Transient saturation uses the existing queued worker.
OOBI producers stage and validate every child URL before durable queue/moobi
writes, then publish ordinary cues. Introductions evaluate proof and queue changes
in one synchronous owner turn; unverified replies retain their existing escrow
and query effects. Queue retry uses row presence. CESR retrieval can preserve
earlier independently accepted events while remaining unfinished or failing;
retrieval completion never implies universal protocol acceptance. Remaining HTTP,
parser and document policies are removal work, not a reason to restore cue owners.

## Mailbox

Provider Mailboxer storage is shared runtime state above Habery; recipient tops
cursors remain durable Habery state. Remote fwd stores the inner message, not the
wrapper. Recipient authorization of the addressed mailbox gates storage. Read
authorization separately requires requester identity and current signature threshold;
query-SAID/cue correlation alone is not authentication. Recheck exact attachments
on HTTP intake, including cigars, old keys and duplicate indices. Also honor the
current dispatch refusal: a prior matching query cue cannot override sender policy. Public logs/ksn
queries retain separate policy; no insecure read override exists.

SSE consumes one complete event and awaits its consumer before another read.
Provider output reads only with HTTP demand. Finite processOnce returns typed
batches; long-lived pollDo is sink-based. Disconnect/timeout discards unfinished
events so their cursors can retry. Pollers hand off ordinary bytes and retain only
protocol topic cursors; there is no durable consumer inbox or acknowledgement API.
Continuous sinks finish before cursor advancement and the next event read.
Provider query/nested streams share one runtime lease. Validate cursor metadata
before copying and use bounded native row reads; join director close before stores.
Attempt every owner's cleanup and propagate failures after releasing its credit.

## CLI and follow-ups

Tufa owns CLI registration, role hosts, middleware and listeners; KERI exposes
library/runtime/DB. Choose withExistingHabery, withAgentRuntime or
withHabAndAgentRuntime for existing-store commands; ensureHby is create-if-missing
startup. Bootstrap tests use explicit config paths. Source runs do not qualify
the packed Node CLI.
Respect the advertised Node floor in runtime code: transport drain, query completion
and host shutdown use ordinary Promise construction. A newer-runtime smoke cannot
qualify older supported Node versions.

[Runtime contract](../../docs/design-docs/runtime/INGRESS_AND_EGRESS.md),
[cue design](../../docs/design-docs/runtime/CUES.md),
[mailbox design](../../docs/design-docs/mailbox/MAILBOX.md).
Shared admission and first verified usable child evidence remain in the
[roadmap](../../docs/plans/PARITY_ROADMAP.md). Stale/timeout continuation breadth
and broader DB parity need source-grounded evidence, not repeated foundation work.

Signaler queues ordinary transient reload hints with collapse-key replacement and
expiry, following KERIpy. No reservations, inspection walker, prepared signal,
quota or immutable-owner protocol belongs here. Notifier publishes only after a
successful durable mutation; false/throw emits no hint, and a later signal failure
propagates without rolling back the notice. Runtime/CLI close only their created
producers; injected signalers remain borrowed and need no Baser resource policy.

Runtime output must be acquired after its database owners: Effection tears sibling
resources down in reverse order. Explicit close alone cannot qualify cancellation
or constructor-failure cleanup. Keep injected stores borrowed.
