# Shared in-flight resource policy plan

Owner: roadmap **4**. Existing parser/tree/recipient/runtime guards are finite
but independent. This phase must establish one admission policy across streams,
habitats, recipients, decryptions, queues, storage copies and pending descendants.
The next-release requirement bounds in-flight work, not total resident accepted
state. Accepted-state cache eviction and public borrowing API redesign are deferred;
report their growth separately rather than claiming a process-wide RSS ceiling.
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
5. Progressive JSON/MGPK/CBOR decoded-body admission precedes codec allocation and
   avoidable raw copying, sharing cumulative logical credit with the root and its
   descendants through parser/consumer cleanup. MGPK declared array/map capacity
   and pinned decoder work are admitted before members. CBOR-A admits declared/base
   tokens and bounded standard view/record work. CBOR-B1 clears configured message
   globals before returning ownership; B2 guards actual unqualified JS tag expansion
   while preserving bounded unknown Tag fallback and standalone behavior. Standard
   exhaustive bignum/fraction/share/extension accounting is deferred. Report its
   unqualified envelope rather than inventing codec behavior or a full allocation
   claim. Qualify the supported in-flight paths and existing finite guards; native
   transient copies remain a measurement boundary, not a cache redesign project. Storage/hydration copy charges coordinate with phase 5. Mailbox providers
   reserve one shared stream/copy lease through joined close and preflight native
   rows; retained query cues and remote-worker handles remain open.
6. Parser input checkpoints yield after 64 KiB or 4,096 pull/consume operations,
   including empty producers, with one cancellation-owned timer. Pending
   metadata/handles and bounded escrow scan work remain separately owned.
   Default Runtime scopes held cue batches/owned references under the shared policy.
   Prospective KEL/clone/state and decision-carried duplicate/escrow
   producers admit concrete batches before effects in Runtime or an explicit CueDeck.
   Revery's own query batches likewise precede BADA/proof/escrow writes, using
   finite proof planning. Semantic /ksn admits its actual keyStateSaved child
   before proof/state writes while retaining prepared reply/query ownership.
   Frozen KEL and fixed single/pair TEL ranges are inspectable without opening event readers.
   KEL query source-seal repair follows concrete output admission on live/retry paths.
   Registry and credential TSN admit exact new dependency queries or txnStateSaved
   children before proof/Broker writes, preserving external escrow and prior proof
   ownership. Legacy credential Verifier admits actual dependency/saved cues before
   body/proof/date/index writes, retaining current families on replay resource refusal.
   Registry/schema membership and every-attempt chain cue distinctions remain exact.
   EXN pending sender/proof/schema batches precede nested staging and durable evidence,
   archive and escrow publication; earlier owners survive joined async cleanup and
   commit checks reject changed membership. EXN authentication queries admit their
   per-invocation ordered deduplicated batch after charged metadata scratch and
   unique-item preflight. Earlier coordinate arrays/native reads, KRAM/IPEX
   notification ports and private verification snapshots remain open.
   Constructors/native copies, crash recovery and capture-time allocations remain
   open. OOBI queueing, staged
   multi-URL fanout and multi-parent completion admit exact batches before
   queue/terminal/contact effects; introductions hold prepared reply/query
   ownership while admitting queued children before proof/queue writes. CESR
   result credit survives joined stream/parser cleanup; HTTP/schema/JSON results
   admit before schema/terminal writes. Other durable producers remain open,
   followed by qualification of query/mailbox/delivery ownership transfers. Default
   runtime queue lifecycle does not fund accepted caches or other storage scans.

S2 OOBI HTTP now consumes lazy Hab messages with shared admission before metadata
capture and finite per-message preparation. Forwarding introduction convenience
callers now use finite collection over captured KEL and lazy endpoint messages.
Large-history forwarding transport adoption, native metadata/proof allocation and
complete-stack qualification remain open. Active 714 Hab helpers collect output; TS streaming preserves its
existing role/source topology and body-driven genus selection.

Each is a 300–500-line-or-smaller target with focused existing-test extensions.
Split further before publication if a complete boundary needs more. Qualification
uses existing scenarios and uncommitted pressure probes rather than a new suite
by default. These units jointly establish the in-flight bound; no partial unit does.

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
