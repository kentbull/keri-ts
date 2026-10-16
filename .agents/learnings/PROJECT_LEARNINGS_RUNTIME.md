# Runtime and mailbox learnings

The [runtime contract](../../docs/design-docs/runtime/INGRESS_AND_EGRESS.md) owns
operational detail. [ADR-0013](../../docs/adr/adr-0013-simple-component-flows.md)
owns architectural constraints; the [roadmap](../../docs/plans/PARITY_ROADMAP.md)
owns remaining qualification. Keep this routing memory concise, not a removal log.

## Composition and execution

One runtime serves a Habery or command invocation. Hosted AID selection is
separate from listener topology; never auto-host all Habs or expose signatory/AEID
as normal identities. Provider storage is explicit enableMailboxStore or a borrowed
Mailboxer, not AgentMode/runtimeMode. RuntimeServices contains only clock/HTTP.
Choose concrete dependencies at construction; no parent-runtime discovery in
Respondant, QueryCoordinator, Anchorer, receipt owners or lower TCP transport.

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
dt/curls, then accepted endpoints, with localhost only if both are absent. Location
and role changes use signed Revery intake, not direct locs/lans mutation.

## Protocol and output owners

Kever returns decision/follow-up data; Kevery applies KEL policy, Revery owns BADA
and reply escrows, Oobiery owns introduction jobs. Three cue scopes remain distinct:
Habery-local, runtime protocol output before reply capture, and application routing.
Composition routes query to QueryCoordinator, stream to MailboxDirector, and reply/
receipt/replay work to Respondant/Hab interpretation. A Deck is not broadcast.
See the [cue graph](../../docs/design-docs/runtime/CUES.md).

Reactor serializes only dispatch/escrows. It returns the processed envelope, exact
decision and mailbox authorization; KRAM may accumulate threshold proofs. It
captures request replies before application publication, including synchronous
capture when a new correlation claims already-published output. No application
callback gate remains. Waiting cancellation removes the waiter; active ownership
joins handler cleanup before passing the protocol turn. Queued ingress copies
bytes, then pulls/processes without reinsertion on failure. clearIngress clears
queued data, not active I/O. Explicit close and scope exit clear ingress/cues.

Prepare/sign/publish before source removal; preparation failure retains the record.
Finite passes use their initial extent. Respondant owns lazy cursors, ordered reply
batches and once-signed retry packets through actual Poster/Reactor/ReplyStreams.
QueryCoordinator owns plain requests, signed packets and joined response I/O.
No CueSink, generic preparation/delivery wrapper, custom-emission injector or no-op
query sender remains. QueryReply peek/take returns data; request owners publish
both TSN replies before taking records. Current authorization defeats old matching
cues. Only the final HTTP query controls its response; earlier authorized output
uses ordinary delivery. Missing routes can permit response-only output.

QueryRequest has one required q body and target. signer is a local AID resolved
from Habery; src is the remote attester. An unavailable explicit signer never falls
back. Otherwise choose the configured Hab or sole Hab; never guess among several.
Keep pending identifiers, not Hab objects. Query preparation captures that signer's
introduction, endpoint and exact bytes. Failed/cancelled sends retain their head,
unresolved requests rotate, and close joins output before clearing. Anchor queries
ask each eligible attester once, or retain one deferred request. Completion uses
accepted seal/key/TEL state. Schema/credential hints stay notify-only; prebuilt reply
routes stay in their serder and typed TSN state serializes at Hab interpretation.
See [query contracts](../../docs/design-docs/runtime/QUERY_REPLY.md).

## Cancellation, stores and replay

Acquire resources before their work children. Abort I/O, join children and return
iterators before releasing stores. Register Promise cleanup before leaves start;
bare yielding finally blocks can lose late failures during Effection halt. Suppress
only exact owned abort reasons/already-reported errors; preserve a lone foreign
failure's identity and aggregate distinct failures. Readers cancel once, join and
always attempt lock release. Unacquired bodies must expose cleanup failure too.
External input abort stops waiting dispatch and active consumers, as well as reads;
check before pull and after results. Finite parser/codec APIs have no lifetime options.

Runtime borrows Habery/injected stores; defaults are owned. Readonly Haberies
create neither default registry. Legacy Regery owns Reger/Tevery/Verifier; v2 Regery
owns the RegBaser shared by IPEX/Reactor. Inject actual processors, not service bags
or optional-method probes. Check genuine registry absence at application entry.
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
tcp-conversation composes application RX/TX. HTTP-first/TCP fallback, direct/mailbox
routing and signed introductions remain. Explicit replies enable duplex; standalone
send is transmit-only. Never open a second runtime just to receive replies.
Native callback/drain precedes the next outbound pull. socketBytes owns exclusive
reads and one pending pull; 64 KiB is granularity, not a memory guarantee. RX EOF
leaves TX alive; abort/failure/return destroy and join close. Drain deadlines are
absolute, not extended by activity. Shutdown stops acceptance and joins both
directions/listeners before stores. Recognized wire/peer failures stay connection-
local; infrastructure/cleanup failures reach the host.

HTTP scopes own upload/fetch/body and preserve signal reasons. Pre-abort acquires
no fetch; only the owned header timeout becomes mailbox null. Positive peer HTTP
refusal is distinct from parser/source/storage/cleanup failure. postCesr sends
successive framed POSTs; KERIpy714 bulk PUT is a documented wire difference.
Preserve authentication through media retries. Post-header failure terminates the
body and reports the original error. Signals must wake the host supervisor.

Local transmission/status proves no remote acceptance. Receipt completion requires
persisted indexed wigs for the requested event's accepted witness cohort, including
historical retrieval after witness replacement. Baser resolves interactions through
their preceding establishment, even empty cohorts. Missing dependencies remain
escrowed. GET without matching proof returns false; complementary fanout reads
verified indexed proof, never raw peer fields or unrelated receipts. Receipt owners
borrow Reactor or construct only protocol processing over the existing Habery.

## OOBI, DID, mailbox and notices

OOBI keeps its durable job row until terminal intake and joined cleanup. Failure
clears in-flight markers but retains retry ownership and accepted events. Validate
all child URLs before writes, then publish cues. Retrieval completion is not universal
acceptance; accepted resolution convergence excludes unsolicited receipt delivery
to static OOBI servers. Ingress/query/escrow dependencies still matter. Authenticator
uses status-only GET; cleanup failure cannot publish authorization.

DID resolution completes KERI/VDR input and escrows before hosted JSON/projection;
compare complete generated/hosted documents. Only default native fetch-header
TypeError or non-ok status permits alternate URL fallback; injected TypeError,
body/parser/storage/cancellation/cleanup failure propagates. Static files capture
regular-file extents, ignore growth, reject truncation and join close. Dynamic
did.json opens no replay; broader lazy generation/export is deferred.

Mailboxer lives above Habery. fwd stores the inner message under recipient
authorization; reading requires current requester proof/threshold, not correlation
alone. Keep protocol messages/cursors, not unsupported consumer inbox/acks. Poll
HTTP(S); TCP-only explicit mailbox roles retain precedence while awaiting HTTP.
Without explicit mailbox routing, poll all eligible witnesses concurrently.
Consumer completion precedes cursor advancement and the next SSE read. EOF/timeout/
cancel discards unfinished events. Provider reads on demand, closes each LMDB
iterator before suspension and frames a row in 64 KiB chunks without a message cap.
Director close wakes polls/rejects new streams before stores close.

Notifier publishes transient Signaler hints only after durable mutation; false/
throw emits no hint and later signaling failure cannot roll back a notice. Borrowed
producers stay borrowed. Tufa owns CLI/role hosts/listeners; KERI owns library/runtime/
DB. Bootstrap uses explicit config paths.

The maintained interop-kram owner checks single/group mailbox authentication in
both directions, including partial thresholds, replay, stale and foreign proofs.
It uses actual hosts/HTTP, with fixture payloads; witnessed delivery, restart and
presentation-registry workflows remain separate gates. Packed minimum-Node, strict
declarations, real native rows and composed disclosure/KRAM tests remain release
gates; source Deno or addon-loading smoke alone does not qualify them.
