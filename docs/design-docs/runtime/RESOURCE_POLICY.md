# Shared resource reservations

`cesr-ts` exports a framework-neutral `ResourcePolicy`. Components sharing the
same instance share byte, active-stream and active-decryption credit. Defaults
are 256 MiB, two streams and one decryption; zero capacity disables a dimension.
Configuration and requests use nonnegative safe integers.

`reserve` checks the whole request before changing any counters. A `limit`
refusal means the request cannot fit this configuration; `busy` means other
owners occupy the required credit. Configuration refusal takes precedence.
Invalid or empty requests throw as caller-contract violations. No queue or
retry is created.

A successful reservation belongs to its acquiring owner. Transfer the reservation
with that owner or release it after consumption and joined cleanup. Release is
idempotent. Cancellation is the integration's responsibility and cannot release
credit while underlying I/O or disposal still runs. Observed usage and limits
are immutable snapshots, not writable controls.

This ledger is an admission primitive, not an allocation interceptor. Callers
must charge copies, backing buffers and retained metadata before acquiring them.
ESSR recipients require an explicit shared policy and retain their crypto credit
through joined cleanup. `AgentRuntime.resources` is shared with its Reactor and
must be passed to hosted ESSR recipients. Inject the same policy into multiple
runtimes when they share one deployment boundary; independent defaults do not
establish a process-wide budget.

Before opening a source, Reactor reserves one stream and the configured cursor
backing allowance plus one producer allocation (8 MiB + 1 MiB by default).
It holds the reservation until parser and source cleanup join. The parser enforces
those captured limits; sources must honor the producer backing contract while
reading. Rejected admission never invokes the source factory and adds no waiter.
A source that allocates outside this contract is outside the accounted envelope.

Reactor also supplies this policy to tree admission. Each independent root owns
one ordinary-wire allowance across all descendants. Both consumer disposal and
resumption/closure of a generator suspended at delivery must finish before credit
returns; parser termination alone never reclaims a delivered consumer owner.
Reactor disposes every input root after dispatch and joined cleanup.

Before acquiring each ESSR sink, the tree reserves its finite canonical-wire cap:
`4 * ceil(maxEssrBytes / 3) + 12 * maxEssrItems`. This conservatively covers the
built-in memory sink including slab rounding and empty-item headers. File sinks
use the same admission charge. Nested writers each reserve their cap and transfer
it with the enclosing root; failure, cancellation and disposal join every stage
before credit returns. Consumers call `discardFrame(root)`; discarding only an
ESSR view cannot release its enclosing root. Custom sinks must respect the finite
cap and cancellation contract, and their factory owns cleanup until it returns. A busy refusal never opens the refused sink or pulls its
Texter body. Independent decoded-byte/item limits remain shared by the tree.

Complete-record ingress reserves retained byte credit before copying. Its record
owns the lease through queued and processing states, including cue-capacity retry
and typed temporary parser-admission refusal. Oversize admission releases the record.
Local record/byte limits also include active processing. Clearing ingress releases
only queued records and invalidates late retries; processing retains credit until
joined cleanup. Runtime close and scope exit clear queued ownership. Parser backing
credit is acquired separately, so both charges coexist during processing.

Lazy HTTP replies borrow the runtime policy and reserve one stream plus their
maximum retained event and outgoing chunk before acquiring a replay iterator.
Credit lasts through source cleanup on EOF, cancellation, failure and runtime
shutdown. Iterator contract failures release admission; cleanup failures propagate
after every live reader and the runtime-owned stores have been closed.
Local reply limits still apply. This accounts for retained replay/output
buffers; the storage source must separately admit its native and hydration copies.
Temporary shared admission refusal maps to HTTP 503; configured size refusal
remains 413. Neither response creates a retry queue.

Query delivery reserves 24 MiB of preparation credit and 8 MiB of retained request
credit before invoking its synchronous wire producer. The preparation allowance
covers bounded query wire, introduction events and their joined buffer; native
storage reads still need separate admission. Eight local slots include the active
head. Preparation credit returns on producer completion/failure, while the request
keeps its credit through delivery, existing explicit retry and joined shutdown.
Shutdown releases queued requests immediately and the active request after its
response cleanup joins. A refused producer is never opened.

Runtime HTTP services carry the same policy as their AgentRuntime. Direct frame
requests reserve one stream before qualification, payload reads or fetch, retaining
credit until response/upload cleanup joins. Their initial copy allowance is
`8 * ordinaryWire + 6 * headerLimit + 4 * errorLimit + 2 MiB`: qualification and
body copies, collected/header string representations, decoded diagnostics and
the serializer's 1 MiB reader / 64 KiB output contract. These conservative charges
need production measurement; they do not cover arbitrary injected HTTP clients or
native fetch buffers. Caller-supplied frames must already satisfy parser admission.
Standalone requests share the default services policy; separately resolved services
need an explicitly shared policy to participate in the same deployment boundary.
`postCesr` reserves its cursor/producer allowance and one outgoing stream before
acquiring the source. Its parser uses the same policy for ordinary trees and ESSR
stages. A frame request borrows that stream slot while separately charging output
copies; direct frame requests acquire their own slot. The optional response
consumer finishes inside the frame scope before advancing input. Query delivery
uses this same owner, leaving the second default stream slot for response ingress.
Configured parser and HTTP policies must agree. Source and payload cleanup join
before their respective reservations return; callers must still wire the owning
runtime services into every standalone exchange/witness sender.

Additional hydrated representations, reader copies, storage and object/handle/work
limits remain in the
[resource plan](../../plans/runtime/RESOURCE_POLICY_PLAN.md).
Counter totals alone are not an RSS or native/mapped-memory guarantee.

Mailbox provider responses borrow the runtime policy. Each query response and its
nested mailbox stream share one lease, acquired before stream construction or row
reads: `2 * maxMessageBytes + maxChunkBytes + 4 * maxMetadataBytes + 512` bytes and
one stream. Defaults are 4 MiB per message, 64 KiB per chunk/metadata and 64 topics;
these are configured local policy, not protocol maxima. Topic count, labels and
ordinals are checked before copying cursors. The pinned NAPI row preflight rejects
oversized values before native target growth and owned copies. Ordinary unbounded
Mailboxer iteration remains available to non-stream callers.
Cancellation and asynchronous director/runtime close join nested reads before
returning credit or closing stores. Cleanup failures propagate after all owners
are attempted. Retained query cues and configured remote workers remain separate
unfunded owners. This TS admission policy does not change the normative upstream
7143832813cac6a394ab1faf9be83bb3372be87c mailbox routing contract.

The internal `CueDeck` is an uninstalled producer/consumer foundation. Ordinary
Deck and Runtime wiring remain unchanged. `prepare(cues)` holds byte/item credit
before durable effects; publish transfers it to queued owners, while unused or
failed preparation rolls back. Held items include prepared, queued, active and
fanout references, so pulling cannot create another free slot. Transfer/requeue
never releases credit; clearing releases queued owners only. Consumers release
after consumption and joined cleanup. A failed callback keeps its owner for retry.

The logical charge counts complete ArrayBuffer backing once per batch, including
views, and walks canonical enumerable Serder/record/primitive metadata without
encoding it or calling accessors. Strings charge two bytes per code unit, scalar
values eight bytes, objects 64 bytes, fields 16 bytes plus labels, and references
128 bytes. Before inspection, temporary credit reserves `128 * maxNodes + 16 * batchCount + 16 KiB` for Set/descriptor work, stack and the batch copy;
it stays through measurement/copy and returns in finally. The retained batch
charge remains separate. Inspection visits at most 65,536 values/depth 64 by default;
JavaScript enumeration internals still depend on canonical caller/parsed-data limits.
Publication constructs owner metadata before the finite Deck append. It does
not measure native heap overhead; prepared data must remain immutable through
final release. One shared batch lease lasts until its last owner; fanout adds
reference credit, not another payload charge. Opaque replay closures are refused
until captured-range metadata is explicit; they are never opened for inspection.

Kevery now prepares the concrete acceptance/clone/state batch before logging,
with prospective first-seen ordinal/date and group/witness policy. Logging checks
the FEL prediction before its first write; caller-held synchronous writer ownership
continues through append. Decision-carried duplicate/escrow cues use the same
pre-effect admission. Empty duplicate batches acquire no credit. Busy/limit refusal
leaves the decision unapplied; unexpected post-write faults release unpublished
preparation but do not roll back durable effects. Ordinary Deck remains supported.

Next integrate Revery/OOBI, EXN/KRAM and legacy credential/TEL producers. QueryReplies fanout,
mailbox correlation, query continuations and delivery consumers must transfer
owners before Runtime enables this deck. This does not close durable cue recovery.
