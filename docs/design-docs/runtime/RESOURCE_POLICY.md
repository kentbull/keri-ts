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

Complete-record ingress reserves retained byte credit before copying. Its record
owns the lease through queued and processing states, including cue-capacity retry
and typed temporary parser-admission refusal. Oversize admission releases the record.
Local record/byte limits also include active processing. Clearing ingress releases
only queued records and invalidates late retries; processing retains credit until
joined cleanup. Runtime close and scope exit clear queued ownership. Parser backing
credit is acquired separately, so both charges coexist during processing.

Hydrated tree copies, storage and object/handle/work limits remain in the
[resource plan](../../plans/runtime/RESOURCE_POLICY_PLAN.md).
Counter totals alone are not an RSS or native/mapped-memory guarantee.
