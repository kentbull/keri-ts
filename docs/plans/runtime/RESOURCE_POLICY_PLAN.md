# Shared runtime resource policy plan

Owner: roadmap **4**. Existing parser/tree/recipient/runtime guards are finite
but independent. This phase must establish one admission policy across streams,
habitats, recipients, decryptions, queues, storage copies and pending descendants.
The ledger, runtime stream/cursor admission and explicit ESSR recipient
reservations share one policy. Ordinary trees and queued ingress retain the same
credit through ownership and cleanup, including finite ESSR staging; storage
and additional copies remain open.
See the [reservation contract](../../design-docs/runtime/RESOURCE_POLICY.md).
Coordinate the native row boundary with [storage phase 5](../db/STORAGE_RECOVERY_PLAN.md).

## Review units

Stack dependent changes under the [roadmap review rules](../PARITY_ROADMAP.md):

1. Shared reservation ledger with atomic refusal and idempotent release is implemented;
   owners still need to acquire/transfer/release its credit at their actual boundaries.
2. Runtime streams reserve producer/cursor backing before source acquisition;
   ordinary tree allowances now transfer to consumer owners.
3. Ordinary tree reservations follow completed roots and parent-owned descendants
   through parser and consumer cleanup; queued record copies retain shared credit
   through retry and joined processing. ESSR sinks reserve their finite wire cap
   before acquisition; extra hydrated and reader copies remain open.
4. ESSR recipients borrow the exposed runtime policy; measured native-copy
   qualification remains open.
5. Storage/hydration copy charges, coordinated with phase 5. Mailbox providers
   reserve one shared stream/copy lease through joined close and preflight native
   rows; retained query cues and remote-worker handles remain open.
6. Parser input checkpoints yield after 64 KiB or 4,096 pull/consume operations,
   including empty producers, with one cancellation-owned timer. Pending
   metadata/handles and bounded escrow scan work remain separately owned.
   Internal held cue batches/owned references are available but not wired into
   Runtime. Prospective KEL/clone/state and decision-carried duplicate/escrow
   producers now admit concrete batches before effects when explicitly injected.
   Revery's own query batches likewise precede BADA/proof/escrow writes, using
   finite proof planning. Semantic /ksn admits its actual keyStateSaved child
   before proof/state writes while retaining prepared reply/query ownership.
   Frozen KEL replay ranges are inspectable without opening event readers.
   Registry and credential TSN admit exact new dependency queries or txnStateSaved
   children before proof/Broker writes, preserving external escrow and prior proof
   ownership. Capture-time/query effects, TEL/composed
   sources remain open. OOBI queueing, staged multi-URL fanout and multi-parent
   completion admit exact batches before queue/terminal/contact effects;
   introductions hold prepared reply/query ownership while admitting actual
   queued children before proof/queue writes. Response publication remains open,
   alongside other durable producers, followed by
   query/mailbox/delivery ownership transfers. Complete these ports before Runtime
   activation.

Each is a 300–500-line-or-smaller target with focused existing-test extensions.
Split further before publication if a complete boundary needs more. Qualification
uses existing scenarios and uncommitted pressure probes rather than a new suite
by default. These units jointly establish the runtime bound; no partial unit does.

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
| Active streams / decryptions    | 2 / 1 per runtime           |
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
