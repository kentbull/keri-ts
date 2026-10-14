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
Source parsers in `postCesr` and query upload remain a separate integration gate.

Additional hydrated representations, reader copies, storage and object/handle/work
limits remain in the
[resource plan](../../plans/runtime/RESOURCE_POLICY_PLAN.md).
Counter totals alone are not an RSS or native/mapped-memory guarantee.
