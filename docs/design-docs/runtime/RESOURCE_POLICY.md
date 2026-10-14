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
The current standalone API does not yet connect parser trees, ESSR recipients,
storage, queues or runtime hosts. Their integration and object/handle/work limits
remain in the [resource plan](../../plans/runtime/RESOURCE_POLICY_PLAN.md).
Counter totals alone are not an RSS or native/mapped-memory guarantee.
