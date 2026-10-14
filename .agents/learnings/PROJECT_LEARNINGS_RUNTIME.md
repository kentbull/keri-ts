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
Parent cancellation diagnostics still need composed owner qualification.

Owned hydration uses an isolated consume callback with direct joined finalization.
A bare yielding finalizer can resume cancelled parent work; resource-only teardown
can hide disposal errors after delivery. Fail cleanup before returning to its caller.
KRAM handoff retains its local busy guard until that disposal and checked durable
acknowledgement finish. Failed callbacks, disposal or ack preserve ready retries;
callback side effects/owner adoption are at least once, without rollback.
Per-Baser active scope counts exclude synchronous cache maintenance, while
admission remains guarded per instance; neither supplies a shared memory budget.

Runtime store acquisition and ownership must be visible in composition-root
control flow. Default `acdc.rgy` and legacy TEL stores are scope-owned; readonly
Haberies get neither, and injected services remain caller-owned. The v2 manager
shares its one store with IPEX and Reactor; keep it separate from `vdr.rgy`. Factories retain
cleanup responsibility until returning their opened store. Explicit runtime close
and scope exit both join cleanup; scope exit after explicit close is harmless.

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
Query producers run only after preparation/request admission. Queued requests retain
credit through failure/retry; shutdown releases an active head after transport cleanup joins.
Runtime HTTP services must carry the runtime's exact policy. Frame requests acquire
stream/copy credit before serialization or fetch and release it after joined cleanup;
source-driven output holds one stream/cursor owner across parsing and HTTP, with
separate tree/stage/output byte credit. Query responses use the remaining ingress
slot. This does not establish a native fetch bound.
See the [reservation contract](../../docs/design-docs/runtime/RESOURCE_POLICY.md).

## Transport

Incremental CESR I/O is the stack-wide default, including discovery, artifacts
and CLI callers. Adopt the shared engines/response owners rather than private
collectors; pass the runtime's exact services/policy. Finite JSON/receipt semantics
require enforced caps, cancellation and joined cleanup. OOBI/DID completion still
requires full evidence; processing before EOF does not imply artifact success.
The finite and streamed messenger entry points share two engines. Parsed
frames bypass parsing; borrowed owners outlive joined transport cleanup. HTTP
`postCesr` means successive POSTs, even when each frame body streams. Local drain,
HTTP success, verified replies and durable acceptance are different outcomes.

Poster route snapshots and synchronous target preparation own habitat/DB work;
prepared sending owns HTTP only. Keep borrowed wire alive through joined cleanup.
The extraction alone does not move runtime callers outside their guard or admit copies.

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

Tufa TCP bounds admitted/closing tasks before source acquisition; Reactor alone
charges the receive stream. Earlier connection credit outlives joined parser/socket
cleanup. Intrinsic wire refusal must preserve source/storage provenance, and a
parser-owned return must not be mistaken for peer failure. Native rejection handles
and pool/kernel buffering remain explicit finite/qualification boundaries.

Direct replies reserve query SAIDs before dispatch; only the final query owns the
HTTP response. Earlier responses transfer to ordinary delivery. A response scope
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
Already admitted TCP frames use the serializer directly; shared HTTP/TCP metadata
admission precedes qualification, and actual nested payload owners stay borrowed.

Explicit TCP conversations pre-admit one lazy RX Reactor channel and retain its
runtime/owners through joined directional cleanup. RX EOF cannot end TX; TX EOF
starts the absolute drain deadline. Concurrent children belong to the abortable
I/O scope so cancellation reaches both before either cleanup waits. A drained
connection/dispatch count proves neither verified replies nor remote acceptance.

HTTP shutdown closes runtime-owned response/SSE streams before awaiting listener
drain. Signals must wake the supervisor; task cancellation alone does not prove
the signal path. Otherwise active responses can force SIGKILL.

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
