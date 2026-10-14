# Shared in-flight resource policy plan

Owner: roadmap **4**, coordinated with [storage phase 5](../db/STORAGE_RECOVERY_PLAN.md).
The default Baser policy is shared by Reactor, recipients and runtime output owners.
The release claim bounds cooperating in-flight work; accepted caches, native/mapped
residency and arbitrary external mutation do not have a total-RSS guarantee.
See the [reservation contract](../../design-docs/runtime/RESOURCE_POLICY.md) for
ownership details and the [closeout report](../../reports/parity/RUNTIME_PARITY_2026-10-14.md)
for exact evidence, exceptions and pending gates.

## Implemented boundaries

- Trees, parent-owned descendants, ingress copies and ESSR stages retain one shared
  policy through scoped consumption and joined cleanup. Source admission precedes
  producer/cursor acquisition; deterministic work checkpoints cover tiny/empty input.
- Progressive JSON/MGPK/CBOR base-token and decoded-body admission precedes the
  cooperating allocation boundary. JS-only CBOR expansion is guarded; exhaustive
  arithmetic/share/extension accounting remains deferred and explicitly unqualified.
- KEL/reply/TEL/TSN/Verifier/EXN/OOBI producers admit concrete cue batches before
  effects. Captured KEL/TEL extents retain metadata, not an open reader or body.
- QueryReplies, mailbox correlation, continuations, delivery, custom sinks, HTTP,
  witness and notification consumers transfer existing owners. Signing/local
  preparation runs in short Reactor turns; network waits run outside them.
- Default CueDeck activation landed in #328. It borrows Baser policy, retains
  the existing 1,024-item ceiling, is acquired after stores and clears queued
  credit after joined consumers. Injected/standalone services
  retain their explicit caller-owned contracts.

## Remaining qualification

Qualify the final composed inventory and installed hosts under existing policy.
Candidate 16/256 MiB observations kept the admitted peak identical. Their later
accessor/TEL deltas are recorded by scope, not an all-files equivalence claim.
The complete inventory retains twelve original failures, closed by targeted #336–339
qualification, including the additional KLI case. Final artifact closure remains open. Do not repeat successful paths or infer native allocation bounds from leases.
Adopted TEL pre-copy/proof-bucket closure landed in #331. Other native hydration,
constructor/capture-time allocations and physical-corrupt-row behavior retain
specific limits in the storage owner; they do not authorize cache/API redesign.

## Deferred accepted-state residency

Baser now fixes its shared policy before reopen, Habery reconstruction and signator
creation. CLI openers forward an injected policy; AgentRuntime inherits that exact
instance and refuses mismatches before resource acquisition. Runtime borrows Habery,
so shutdown cannot release Baser-owned credit. This installation alone charges no
accepted Kevers. KERIpy 714's `statedict` is a growing read-through cache; it has
no finite eviction or scoped borrowing API. Preserve the current accepted-state
APIs for this release and disclose cache growth in qualification.

Finite residency would be a future TypeScript architecture change, requiring
independent accepted generations, charged local pins, durable membership separate
from residency and explicit borrower adoption before safe eviction. Raw public
aliases prevent deterministic reclamation. This redesign is not a release gate
and must not be introduced as a parity prerequisite. Transient hydration/copy
admission in streaming paths remains in phases 4/5.

## Approved initial deployment defaults

| Resource                        | Default                     |
| ------------------------------- | --------------------------- |
| Read target / producer backing  | 64 KiB / 1 MiB              |
| Cursor input per stream         | 8 MiB                       |
| Ordinary bytes per pending tree | 8 MiB                       |
| Logical sealed ciphertext       | 8 MiB including overhead    |
| Decoded ESSR per owned tree     | 8 MiB; 16,384 Texters       |
| Ordinary leaves / message nodes | 4,096 / 256 per tree        |
| Enclosure depth                 | 64                          |
| Active streams / decryptions    | 8 / 1 per runtime           |
| Completed output queue          | One charged tree per stream |
| Runtime byte reservations       | 256 MiB                     |
| Reservation per 8 MiB decrypt   | Initially 64 MiB            |

These are configurable policy, not protocol maxima or current global guarantees.
Change defaults only with recorded source or measurement evidence. The decryption
reservation covers ciphertext, plaintext and native copies and needs measurement.
The 8 MiB limit applies to logical messages, not a multi-gigabyte transfer.

## Required implementation and evidence

- Reserve before allocation/retention, including producer backing, hydration,
  canonical qualification and empty-item overhead, native copies, descendants,
  completed queues and accumulated retry/durable metadata. Charge until consumed,
  disposed or durably transferred. A sliced view still retains its backing.
- Bound waiters, objects and handles as well as bytes. Return explicit busy/limit
  outcomes or bounded backpressure; do not add an unbounded waiting queue.
- Validate configuration at real entrypoints. Integrate existing ESSR decisions;
  local occupied capacity does not establish invalidity.
- Use simple deterministic consumed-byte/work checkpoints for tiny/empty items;
  measure scheduling cost rather than creating a strategy framework.
- Test two concurrent streams, one decryption across multiple recipients, slow
  consumers, oversized pre-read rejection, empty wrappers/items, cancellation,
  joined cleanup and exactly-once release.

Reservation counts are not an exact RSS ceiling. Report native/mapped residency
separately; final plateau evidence belongs to [phase 7](../qualification/QUALIFICATION_PLAN.md).
