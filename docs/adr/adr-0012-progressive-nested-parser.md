# ADR-0012: Progressive Nested Parsing and Bounded Payload Storage

- Status: Accepted design; implementation planned
- Date: 2026-10-12
- Scope: CESR parsing and its KERI transport, payload, and storage boundaries
- Replaces: the long-term architecture decision in
  [ADR-0001](adr-0001-parser-atomic-bounded-first.md), after migration
- Contract: [progressive parser target](../design-docs/cesr/CESR_PROGRESSIVE_PARSER_CONTRACT.md)
- Execution: [phased plan](../design-docs/cesr/CESR_PROGRESSIVE_PARSER_PLAN.md)

## Context

The committed workload is many small ESSR messages in transfers that can total
multiple gigabytes. The current parser waits for a complete counted enclosure,
retains its child frames, and copies accumulated input. Transport, primitive
hydration, exchange handling, and storage can independently materialize the
same transfer. Making nested parsing resumable alone does not establish bounded
memory.

The user has approved replacing the atomic parser with a progressive parser,
with measurements before and after implementation. This is an explicit change
of architecture, not a claim that KERIpy requires progressive enclosure reads.
Protocol v1/v2 support remains required; compatibility with old keri-ts APIs
is not a goal.

## Decision

Use one pull-based parser built from async generators composed with `yield*`.
Generator locals retain parsing progress and local genus selection. One
segmented byte cursor supplies bounded views of counted payloads; there is no
additional explicit resumable parse stack or parser strategy registry.

Emit a complete child of `GenericGroup` before the outer enclosure finishes.
Each child's own frame boundary and required attachments must be complete.
A later malformed sibling fails the stream without retracting earlier children.
Structural parsing never grants cryptographic or application acceptance.

Keep synchronous decoding of a complete bounded primitive. Stream large payload
bytes through awaited sinks, expose reopenable payload references, and carry
that representation through persistence and consumption. Bound queues, active
logical messages, metadata, and decryption concurrency as well as input bytes.
Filesystem storage belongs behind runtime/DB entrypoints, not in CESR core.

For recipient processing, authenticate/decrypt one admitted logical sealed
message before writing its plaintext to disk. Texter fragmentation does not
create separate encryption messages. Preserve qualified ciphertext Texters where
KERIpy-compatible exchange evidence, relay, or replay requires them; plaintext
storage is a separate representation and must not replace original wire evidence.

## Implementation transition

This ADR does not describe the currently implemented parser. The existing
[state-machine contract](../design-docs/cesr/CESR_PARSER_STATE_MACHINE_CONTRACT.md)
remains authoritative for its synchronous API until callers migrate. The
progressive contract states obligations for the new implementation, not completed
features.

A temporary second implementation is permitted only to keep intermediate PRs
cohesive. Migrate the actual async adapter first, then its consumers. Phase 12
removes the atomic production engine, old API aliases and adapters, and tests
whose only purpose is compatibility with old keri-ts APIs. Keep protocol and
boundary regressions in the new API's tests. Do not retain a permanent parser
mode, feature flag, or fallback strategy.

## Consequences

Progressive delivery changes error semantics: accepted child A can survive a
malformed later child B. Consumers must own and dispose of yielded resources
explicitly, and must not equate parser delivery with accepted exchange state.
Cancellation must interrupt pending I/O and unwind unfinished sinks.

The expected gains are lower first-child latency and retained memory that scales
with configured limits and the largest active logical message, rather than total
transfer size. Throughput is an empirical result, not an assumed benefit of
generators. Measure decoding and input-copy fixes separately so they are not
misattributed to nested suspension.

Whole-message sealed-box decryption still requires a configured logical-message
size limit. This decision introduces neither new encryption framing nor a claim
of constant memory for arbitrarily large individual encrypted messages.

## Completion gate

The plan must demonstrate early emission, correct v1/v2 decoding, bounded queues
and retained metadata, cancellation cleanup, durable reopen/replay, and KERIpy
interoperability. Capture an immutable initial baseline and a decoding-fixed
atomic baseline, then compare cursor, generator, and complete runtime checkpoints.
Large and long-running ESSR qualification uses a one-off manually dispatched CI
job; it is excluded from normal PR tests and required master merge checks.
Do not mark the architecture implemented until the production call chain and the
final benchmark satisfy the target contract.
