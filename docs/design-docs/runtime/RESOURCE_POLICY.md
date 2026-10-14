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
`8 * maxMessageBytes + maxChunkBytes` before acquiring a replay iterator.
Credit lasts through source cleanup on EOF, cancellation, failure and runtime
shutdown. Iterator contract failures release admission; cleanup failures propagate
after every live reader and the runtime-owned stores have been closed.
Local reply limits still apply. The allowance covers cooperating native/body,
decoded representations, proofs and final event reconstruction as well as retained
output; it requires production measurement. Finite KEL event-body reads use native
row preflight, and body read failures propagate before corrupt-record skipping.
Companion proof rows, other storage sources, fixed native scratch and mapped
residency remain separately audited boundaries.
Temporary shared admission refusal maps to HTTP 503; configured size refusal
remains 413. Neither response creates a retry queue.

OOBI HTTP output uses the same response owner, priming one bounded message after
admission for 404 readiness. Selector inputs are borrowed, immutable until admitted
acquisition. Metadata cursors close before hydration/yield; local
ceilings default to 4,096 inspected descriptors, 32 delegation levels and one
message ceiling of retained metadata. Captured FEL identities exclude later
acceptances; proofs and signing keys remain current. Fresh flat-field/signature
preparation uses a conservative allowance before construction. Native Komer,
proof/key copies and existing no-SN corrupt-proof skipping remain phase 5 gaps.
Finite Hab and forwarding introduction adapters default to 8 MiB total.
Introductions retain only admitted finite messages and reject explicit Infinity;
ordinary forwarding/mailbox wrappers use the same finite convenience default.
The lazy introduction source remains available, but its actual large-history
transport caller and shared ownership qualification remain open. This preserves TS role/source selection, including endpoint KELs and its
existing witness authorization condition, rather than claiming full 714 wire parity.

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

Progressive JSON/MGPK add measured logical decoded charges to this same tree owner
before raw copying and their codec allocation; descendants share its cumulative cap
(the policy byte capacity). The CESR contract defines its 64/16/8/2 vocabulary and
conservative working retention. Wire allowances alone do not bound decoded bodies.
Tree admission checks its aggregate own reservations against capacity before each
shared request: an impossible tree is `limit`; competing owners cause `busy`.
MGPK declared container capacity and pinned decoder work use the same root owner;
shared key caching/global custom extensions are excluded from admitted MGPK.
This does not admit wrapped Matter preparation, CBOR/native hydration, standalone
verification, storage/cache copies or every JavaScript/native allocation.

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
reference credit, not another payload charge. KEL replay uses a frozen
`CapturedKelReplay`: prefix/from/end tuples, per-message ceiling and a fixed borrowed
Baser reference. Inspection charges this metadata without reading bodies or opening
iterators/cursors, and never walks the runtime-owned store. TEL uses canonical
`CapturedTelReplay`: at most two frozen prefix/end ranges, immutable genus/selector/
message settings and one fixed borrowed Reger reference. Both capture constructors
copy validated primitive fields into fresh plain frozen arrays/tuples, excluding
caller container subclasses and their hidden retention. Same-store/settings pair
composition preserves management/credential order and duplicates without opening
readers. Admission charges only that metadata/reference; each consumer closes its
TEL cursor before cloning/yielding. Prototype spoofs and subclasses remain refused.
Finite message arrays charge their complete backing normally. Other opaque replay
closures remain refused; arbitrary work is never opened for measurement. Capture-time temporary
allocations still need producer admission; this retained
owner seam does not activate Runtime or close the full query/delivery boundary.
TEL body/proof-row pre-read allocation admission remains a phase 5 obligation.

Live and retried KEL queries admit their actual output batch before repairing
delegation source-seal hints. Busy, configured-limit and item refusal leave `aess`
unchanged; admitted replay readers see the repair at consumption. Unexpected
repair failures release unpublished credit without implying database rollback.

Kevery now prepares the concrete acceptance/clone/state batch before logging,
with prospective first-seen ordinal/date and group/witness policy. Logging checks
the FEL prediction before its first write; caller-held synchronous writer ownership
continues through append. Decision-carried duplicate/escrow cues use the same
pre-effect admission. Empty duplicate batches acquire no credit. Busy/limit refusal
leaves the decision unapplied; unexpected post-write faults release unpublished
preparation but do not roll back durable effects. Ordinary Runtime Deck retains
its original conservative acceptance/duplicate count guard and retry boundary.
Exact measured batch admission applies only to injected CueDeck until Runtime
producer/consumer ownership is fully ported.

Revery preflights ordered proof groups and admits its exact missing-signer query
batch before BADA/proof/escrow effects. Its configurable `maxReplyGroups` defaults
to 4096, matching the progressive parser group default; this bounds incoming groups
and staged entries, not verification bytes, prior proof reads or native copies. Virtual staged signature
pins preserve same-call aggregation, while externalEscrow leaves pending evidence
with its semantic owner. Resource refusal during RPE replay cannot delete the row.
Ordinary Deck retains its existing conservative reply count guard.

Revery.prepareReply exposes a caller-owned PreparedReply with an immutable
decision and one-shot applyProofs/publishQueries/release operations. Keep the
entire use in one synchronous guarded turn; suspending can invalidate evaluated
BADA state. Borrowed proofs remain immutable until application/release, and
application drops their retained references. Release clears unpublished query
credit; published query ownership stays with the deck/consumer.

Kevery /ksn holds that preparation while admitting its actual keyStateSaved child
before accepted reply/proof or key-state writes, on shared or distinct decks.
Semantic invalidity cannot publish a new unaccepted proof. Unverified replies
still apply their existing escrow/query effects without a state child. Exceptions
after writes release unpublished query/child credit and do not imply DB rollback.

Registry and credential TSN hold PreparedReply query ownership and admit exact new dependency
query or txnStateSaved child before proof/Broker effects. Exact family membership
prevents duplicate query credit; insertion must match the synchronous prediction
before publication. Pending Broker proofs and prior accepted BADA evidence retain
their existing owners, including credential registry/attester/TEL dependency migration.
Semantic rejection never applies the new proof plan.

Legacy Verifier admits each actual dependency or saved cue before credential body,
source proof, escrow date or saved-index writes. Registry/schema queries follow new
membership; missing/stale chain queries preserve their every-attempt policy. Exact
membership is checked synchronously before publication. Busy/configured-limit refusal
on replay preserves the existing escrow family. Typed remote decisions control family
cleanup; thrown infrastructure/invariant failures propagate unchanged. Unexpected post-write failures release
unpublished credit without DB rollback. Ordinary Deck keeps its original count guard.
Credential constructors, proof/native copies and durable cue recovery remain phase 4/5 gates.

Oobiery.resolve admits its actual queued cue before the queue write. Multi-URL
fanout validates and stages every child record, then admits the exact ordered cue
batch before any child queue or parent moobi mutation. Parent completion admits
its actual resolved/failed result before terminal/contact writes. Ordinary Deck
keeps its existing count guards. Resource refusal cannot leave partial fanout or
publish terminal/contact effects; unexpected write faults release unpublished
credit without DB rollback. Introductions hold PreparedReply query ownership and
admit the actual oobiQueued child before BADA/proof/queue effects on shared or
distinct decks. Unverified introductions still apply existing escrow/query effects
without a queued child. Keep the entire preparation in one synchronous guarded
turn and preserve the ordinary group-plus-one count guard.
Attempt queue metadata stays staged until result admission; finite responses keep
the original queue row until terminal publication. Attempt dates are descriptive:
current selection/retry uses row presence, without an attempt-date TTL filter.
CESR responses hold their actual prospective resolved cue as an earlier scope
resource before queue metadata, the streaming marker and Reactor body reads. Credit survives
joined parser/body cleanup; cancellation or failure releases unpublished credit
while preserving queued work and earlier accepted events. Full retrieval applies terminal/contact effects under admitted result ownership,
then publishes the result; it does not prove universal acceptance.
HTTP, schema and invalid JSON results prepare actual batches before schema or
terminal writes. Busy refusal uses the existing queued worker; configured limits
and infrastructure failures propagate. The ordinary post-intake guard remains.
Constructor allocation and native copy admission remain broader phase 4/5
qualification. EXN/KRAM and legacy TEL producers remain open.
Exchanger pending sender/proof/schema outcomes prepare only the actual new escrow
cue batch after independent authentication/route verification, before nested staging,
new ESSR evidence rows and durable archive/proof/escrow/metadata publication. An earlier
passive owner survives awaited staging, publication and joined cleanup. Current
membership is rechecked before commit effects, and insertion must match before
cue publication. Repeated membership and incomplete accepted duplicates acquire
no extra cue credit. Ordinary Deck keeps its original query order and absolute
schema deadline. Refusal preserves existing escrow owners; unexpected post-write
faults release unused credit without claiming DB rollback. Exchanger authentication
queries charge Map/key/query scratch before construction: 16 KiB plus 512 bytes and
six bytes per prefix character for each canonical missing coordinate. Exact unique
item capacity is checked before query objects, then one measured batch publishes
in first-arrival order with per-invocation deduplication. Published query owners
remain valid across awaited selection and later rejection; empty input owns no
credit. Ordinary Deck retains its original per-item push path. Earlier resolution/
verification coordinate arrays, native proof reads, KRAM/IPEX notification ports,
private ESSR verification snapshots and native/copy admission remain open.

QueryReplies fanout, mailbox correlation, query continuations and delivery consumers must transfer
owners before Runtime enables this deck. This does not close durable cue recovery.
