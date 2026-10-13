# Payload storage and recovery plan

Owner: roadmap **5**, coordinated with shared admission **4**. Durable payload
references, exchange evidence and nested replay are implemented; see the
[storage contract](../../design-docs/db/PAYLOAD_STORAGE.md). These foundations
do not close runtime allocation or crash-recovery qualification.

## Allocation boundary

LMDB currently returns an entire row before its size check. Nested wire's 24 MiB
aggregate ceiling, mailbox's 4 MiB row check and replay's finite event limits
therefore do not prove admission before native allocation. Close that boundary
and account for all runtime-wide copies before claiming bounded memory.

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
