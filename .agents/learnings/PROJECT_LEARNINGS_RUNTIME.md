# Runtime and mailbox learnings

## Scopes and state

One host/runtime serves a Habery or command invocation; hosted-AID selection is
separate from listeners. Do not auto-host every Hab or expose signatory/AEID as a
normal identity. Endpoint-role support does not imply startup should seed that role.
Use signed loc/scheme replies through Revery, never direct locs/lans writes.
Alias config dt/curls is the bootstrap source; synthesize localhost only when both
config and accepted endpoints are absent.

Kever decides, Kevery routes KEL/KEL-derived replies, Revery owns BADA/reply
escrows, Oobiery owns introductions. Runtime and local Habery.kevery have distinct
cue decks. Incomplete query cues require QueryCoordinator to resolve a local
habitat and honest remote attester before producing wire. Hab.processCuesIter
remains the cue-semantics seam.

KERI/Tufa operations own lifecycle. Acquire source/frame/runtime resources before
work children so cancellation aborts and joins I/O before releasing permits or
owners. Promise adaptation belongs at real edges. Reactor serializes dispatch,
escrow and cue handling; a cue consumer must not reenter its guarded Reactor.
Receiving mailbox identity is an explicit per-message argument, never ambient
mutable request state.
Shared transport readers cancel once, join that Promise and always unlock;
single errors retain identity and distinct read/cleanup failures aggregate.
SSE's earlier reader owner re-observes its pending read/cancel Promises after
halt, preserving late failures and releasing the lock even when cleanup fails.
Response cancellation uses an earlier scope resource: a bare yielding finally
can join its Promise while losing a late failure during cancellation. Unacquired
HTTP response/request bodies propagate cleanup failure instead of discarding it.
Fetch teardown joins pending rejection as well as late response cleanup. Timeout
null recognizes only its controller's exact reason; foreign same-class AbortErrors
and I/O failures propagate without repeating an already-reported object.
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
and retains it through joined parser cleanup. AgentRuntime exposes that same policy
for recipients; shared deployments must inject one policy into all runtimes.
Internal CueDeck preparation holds concrete metadata/backing and item credit;
ownership transfers through fanout/requeue until final cleanup. KEL acceptance,
clone/state and decision-carried duplicate/escrow cues now prepare before effects
when CueDeck is explicitly injected. Revery's own missing-signer query batches
also prepare before BADA/proof/escrow effects. /ksn holds PreparedReply ownership
and admits its concrete keyStateSaved child before proof/state writes on shared
or distinct decks. Registry and credential TSN hold the same preparation while admitting its
actual new dependency query or txnStateSaved child before proof/Broker effects.
Exact family membership prevents duplicate query credit while Broker retains
registry/attester/TEL dependency migration. OOBI typed cue producers also admit
actual batches before effects. Runtime activation
waits for every producer/consumer port; count checks alone cannot reserve byte credit.
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

Poster route snapshots and synchronous target preparation own habitat/DB work;
prepared sending selects HTTP or the shared TCP engine. Runtime cue/failed-target
and Poster outbox drains explicitly lend runtime for same-socket local intake;
standalone targets remain transmit-only. Keep wire alive through joined cleanup.
HTTP/HTTPS priority and signed introductions stay unchanged. TCP and RX capacity
refusals use invocation-local observation; foreign failures preserve identity.
Raw TCP peer failures still propagate; this adds no new refusal/retry taxonomy.
Public Poster operations retain caller-owned preparation/retention bounds.
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
Source query/continuation callbacks now run only after bounded input, item, wire,
route and preparation admission; captured signature/routing survive later changes.
Busy preserves the raw or continuation head, and unresolved/custom sinks keep
notify semantics. Actual continuation drains receive their owning runtime for
a short guarded preparation turn. Request-local HTTP/witness owners still need adoption.
Actual HTTP and source/tree/output admission refusal observation is invocation-local;
source/fetch/sink/cleanup and external observer failures retain original identity.
Prepared target attempts return local complete/refused/busy only after joined
cleanup, matching observed engine-created errors rather than foreign classes.
Cue preparation/item refusal follows the same exact invocation rule; foreign
interpretation, route, reserve and observer failures propagate. This does not
admit all decoded/native preparation copies.
Admitted cue interpretation is synchronous: destination item admission precedes
preparation, and atomic acceptance precedes ordinary source removal. Existing
CueDeck credit transfers/requeues; lazy replay stays unopened. The accepting
owner releases after joined consumption. This facility alone is not reliable
handoff by itself. Custom runtime cue drains now prepare one input/output owner per
short turn and await the sink outside the guard; register that owner before sink
resources so cancellation joins child cleanup before release. Initial pass count
and eligible immediate transfer/busy semantics stay bounded. QueryCoordinator
transforms under the same preparation/output check and sends without repeating
observation/signing. Standalone custom pending queries retain caller-owned bounds.
Cue route capture reserves a separate 1 MiB/4096-target allowance before endpoint
resolution. Its independent owner retains metadata until joined delivery cleanup;
configured floors include the live cue and interpretation credit.

Socket streamability requires a connection-owned parser, bounded handoff and
joined shutdown; parser streaming alone is insufficient. Guard signing/routing/DB
preparation, then transfer admitted delivery ownership before network I/O. Never
wait for queue space under the guard or remove a cue before successful transfer.
Witness source intake shares the Reactor parser with its finite wrapper; consume
emissions individually under the guarded frame lifetime, with independently admitted
ownership for retained work. Finite receipt delivery suppression stays explicit.
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

KEL replay exposes frozen prefix/from/end metadata; cue admission inspects it
without opening a body/iterator or walking the borrowed Baser. Retained/fanout
owners keep that credit. Canonical TEL captures retain at most two frozen ranges
and wire settings with a borrowed Reger; admission opens no readers/store traversal.
Capture-time allocation and other opaque source forms stay separate.
Replay captures first-seen ranges, hydrates one finite event and releases cursors
before transport suspension. Query credits remain charged through failed delivery;
bounded passes drain only their initial work. Generic witness and signed-exchange
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
OOBI queueing and multi-URL fanout stage all child records and admit exact ordered
cue batches before queue/moobi writes; validate every URL before mutation. Admit
parent resolved/failed cues before terminal/contact effects. Preserve ordinary
Deck guards. Introductions hold PreparedReply and admit actual queued children
before BADA/proof/queue effects; unverified replies retain existing escrow/query
publication without a child. Keep the one-shot plan in a single synchronous turn.
Attempt queue metadata stays staged until result admission; current queue retry
uses row presence, not attempt-date TTL. Finite results preserve the original row
until terminal publication. CESR result credit is an earlier scope resource held
before queue and streaming metadata
and Reactor body reads through joined cleanup. Failure/cancellation releases only
unpublished result credit; full retrieval retains the published owner and is not
universal protocol acceptance. HTTP/schema/JSON results admit before terminal
or schema writes, with the existing queued worker retrying transient refusal.

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
events so their cursors can retry. Durable inbox admission has separate dispositions.
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

Signaler owns transient reload hints, not durable Noter rows. Method-managed pings
reserve finite queue/copy credit before construction and notice effects; publish
transfers that credit, collapse/expiry/clear/close release it. The borrowed queue
view is readonly and entries are immutable snapshots. Runtime/CLI close only their
created producers; injected notification services share the exact Baser policy.
