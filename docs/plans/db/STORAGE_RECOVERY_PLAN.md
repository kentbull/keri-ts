# Payload storage and recovery plan

Owner: roadmap **5**, coordinated with shared admission **4**. Durable payload
references, exchange evidence and nested replay are implemented; see the
[storage contract](../../design-docs/db/PAYLOAD_STORAGE.md). These foundations
do not close runtime allocation or crash-recovery qualification.

## Review units

Apply the [roadmap review rules](../PARITY_ROADMAP.md), in dependency order:

1. Native row-size admission before materialization; prove the actual binding seam.
2. Charged finite row/hydration/replay reads, coordinated with resource phase 4.
3. Atomic file/reference publication and failed duplicate rollback.
4. Crash recovery of proven task-owned stages and unreferenced files.
5. Joined cleanup-error handling and durable reopen/retry reconciliation.
   Include [transport delivery obligations](../runtime/TRANSPORT_PLAN.md): the
   current optional outbox is mailbox-only and publishes multiple rows without
   one transaction. Qualify atomic publication, finite admission, partial-target
   status and reopen before claiming durable transfer. Direct/witness obligations
   require explicit destination semantics or proven regeneration. A journal added
   after KEL acceptance alone leaves the crash-before-cue-transfer gap. Resolve
   that gap by linked durable state or bounded recovery; do not silently enable
   the optional outbox or claim an in-memory delivery queue survives restart.

Keep each PR within the size target, including regressions. Reuse existing storage
tests; exercise failure/crash designs with uncommitted probes unless a maintained
regression has clear value. An unavailable native pre-allocation seam must remain
an explicit limitation rather than becoming an after-allocation size assertion.

## Allocation boundary

Nested wire now uses the pinned NAPI size preflight before owned row copies,
including aggregate 24 MiB credit during comparisons, publication and hydration.
Exchanger nested admission/replay additionally holds a conservative shared copy
allowance through joined cleanup; this covers its cooperating row/serialization
and cursor phases, with parser frames charging ordinary/ESSR staging separately.
KRAM snapshot/hash/serialization admission is the next independent unit.
Broader KEL/reply replay (`clonePreIter`, `replyEndRole`), mailbox rows, parent
factors and query preparation/retained introductions still require native-row and
copy audits. Queue/stream credit alone does not prove their pre-read boundary.
Fixed native scratch (initially 16 MiB), growth through other read APIs and LMDB
mapped residency remain separate overhead. Shared leases and measured native/string
coexistence must cover these categories before a runtime-total/RSS claim.

LMDB V1 inspection must use the existing owner or a separate process. The #164
test repair moved the live CLI host and inspector into separate processes without
changing participants/assertions; it did not solve row allocation or shared budgets.

## Required acceptance

1. Retain qualified ciphertext in KERIpy-compatible `essrs.`, `enst.`, escrow,
   relay and replay rows. Private pointers never replace required wire evidence;
   authenticated plaintext remains separately owned.
2. Read Python-origin rows with their actual insertion order and deduplication.
   Reopen/retry/replay use streams or finite batches, not bulk `getAll`/joins.
3. Bound staging, handles, row copies and pending metadata. File-backed processing
   must not retain a second complete ciphertext array.
4. Exercise close/reopen, ordered Texters, nested rejection/cancellation, escrow
   retry, failed duplicate publication and cleanup errors.
5. Inject failures around stage, finish, file publication, DB publication and
   cleanup. No published reference may point at missing content. Recovery removes
   only proven unreferenced task-owned files/stages.

The broader row-by-row [DB parity plan](DB_PARITY_PLAN.md) remains distinct from
this runtime storage phase. Reuse its invariants without restarting DB foundations.
