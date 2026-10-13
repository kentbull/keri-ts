# Shared runtime resource policy plan

Owner: roadmap **4**. Existing parser/tree/recipient/runtime guards are finite
but independent. This phase must establish one admission policy across streams,
habitats, recipients, decryptions, queues, storage copies and pending descendants.
Coordinate the native row boundary with [storage phase 5](../db/STORAGE_RECOVERY_PLAN.md).

## Review units

Stack dependent changes under the [roadmap review rules](../PARITY_ROADMAP.md):

1. Shared reservation policy, typed refusal and exactly-once release.
2. Runtime stream admission and producer/cursor backing charges.
3. Queues, completed trees and descendant ownership transfers.
4. Shared ESSR decryption reservations across recipient instances.
5. Storage/hydration copy charges, coordinated with phase 5.
6. Pending metadata, handles/waiters and consumed-work checkpoints.

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
