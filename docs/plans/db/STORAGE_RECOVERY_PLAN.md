# Payload storage and recovery plan

Owner: roadmap **5**, under [ADR-0013](../../adr/adr-0013-simple-component-flows.md).
Remove storage accounting and unsupported delivery persistence. Existing payload
and accepted-evidence foundations still need final composed qualification; this
plan does not preserve their byte-credit architecture.

## Removal units

1. Remove native row-size billing, getValBounded/getBounded/beforeCopy callbacks,
   replay byte ceilings and copy reservations. Keep native buffer validity, actual
   copies where required, logical replay horizons and cursor closure.
2. Delete the outbox environment, records, APIs, disabled implementation and all
   runtime/CLI readers/writers. No compatibility or migration path.
3. Delete consumer inbox `mbin.` and KRAM ready/snapshot `kready.`/`kpnd.` stores.
   Keep provider Mailboxer messages/topics and Baser `tops` polling cursors.
4. Keep KERIpy partial-signature/factor escrows and replay/timeliness caches;
   remove accounting and downstream acknowledgement coupling around them.
5. Preserve actual payload file/reference publication and joined cleanup. Remove
   storage quota parameters and claims, not digest/size consistency or disposal.

No old keri-ts API/data compatibility or new-to-old tests are required. Do not
build export/recovery tools, dual writes or dormant readers for retired stores.
New supported databases must not create them. Do not touch unrelated live data
merely to retire code. Accepted-state cache eviction is not part of this work.

## Native and payload correctness

LMDB V1 inspection uses the existing owner or a separate process. Preserve actual
native addon/data-format qualification, especially mapped rows above 16 MiB.
The native-copy removal does not authorize invalid borrowed buffers or cursors
held past their owner. Snapshot logical replay extents where correctness needs it.

Keep qualified ciphertext in KERIpy-compatible `essrs.`, accepted nested evidence
and supported escrow/replay rows. Private pointers never replace required wire;
authenticated plaintext stays separate. Read Python-origin rows with their actual
ordering/deduplication. Current KERIpy interoperability is distinct from supporting
an obsolete keri-ts storage layout.

File publication must not leave a published reference to missing content. Recovery
of current task-owned stages removes only proven unreferenced files. Keep actual
size/digest checks, accepted payload reopening and cleanup on failed publication.
No general delivery journal or application acknowledgement is introduced.

## Verification

Reuse meaningful tests for exact replay bytes/order, accepted horizons, cursor
closure, close/reopen, ordered Texters, nested rejection, cancellation, supported
escrow retry, duplicate rollback and cleanup errors. Inject failures around
stage/finish/file/DB publication as needed. Delete reservation/formula-only tests.
Do not add compatibility fixtures for retired versions or stores.

The [DB parity plan](DB_PARITY_PLAN.md) owns row-level protocol compatibility;
the [payload contract](../../design-docs/db/PAYLOAD_STORAGE.md) owns real file
lifetime, subject to the removal boundary. Final interop and installed-package
qualification remain mandatory.

KEL/TEL replay and stored endpoint-reply output no longer carry accounting options.
Keep immutable replay horizons, cursor closure, delegation-cycle detection,
qualified ordinal/framing rules and current proof reconstruction. General bounded-row
helpers and before-copy callbacks are removed. Nested/ESSR hydration, payload/parser
and mailbox output accounting still require removal; do not reintroduce row/replay
ceilings to coordinate those later cuts.

Payload collectors and memory/file stages no longer accept quotas. Keep exact
Payload.size validation, truncated/overlong source failures and actual file/reader
ownership. Parser and ESSR crypto/tree accounting still require removal; do not
restore sink policy arguments as a bridge for those later cuts.
