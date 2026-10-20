# Exchange evidence storage

LMDB is the storage authority for accepted and escrowed exchange evidence.
`essrs.` stores qualified Texter bytes under the EXN SAID followed by `.` and a
32-digit hexadecimal ordinal. This is KERIpy's physical insertion-ordered table
layout. The target is actual main `424a50c` Baser, bound as `CesrIoSetSuber<Texter>`.
`Baser.getEssrs` reads the owned ordered set synchronously from
ordinary database rows, without private metadata or file references.

Qualified Texters deduplicate in first-insertion order. The signed payload digest
commits to concatenated raw bytes, so this reference-compatible set is lossy for
repeated fragments. Alternate valid fragmentations on redelivery can append new
members and also break reconstruction. These are explicit storage limitations,
not new protocol rejection rules or permission to skip digest/authentication
checks. The [upstream issue report](../../reports/essr/KERIPY_REPEATED_FRAGMENTS_2026-10-20.md)
retains the reproducer and conceptual sequence-storage correction. No local
ordinal-write policy, coalescing, extra evidence table or archive fallback remains.

Exchanger authenticates proofs, verifies the signed payload digest and route
policy, then publishes evidence and accepted/escrow state in one synchronous
LMDB transaction. It verifies the incoming representation, then adds each Texter
to the ordinary set, including on redelivery. Duplicate-add false is normal;
an actual storage exception rolls back the body, proofs, fragments and receipt together.
After commit, the operation joins the actual LMDB flush and invokes its handler.

Retry reconstructs evidence from the same tables and preserves the first receipt
and attachment genus. Retry validates reconstructed stored bytes; damaged evidence
can fail its digest. Replay emits stored members, and recipients verify them before
decryption. Terminal escrow removal clears only its pending evidence in the
transaction. Distinct-fragment evidence survives reopen and replay/retry.
There are no private file-reference/ownership tables, archive recovery, publication
or reclamation protocols, or durable decrypted-plaintext storage.

## Nested exchange substreams

`enst.` retains KERIpy-compatible qualified child substreams, in insertion order
with exact-value deduplication. Resident children serialize before the synchronous
writer. Publication replaces their rows alongside exchange state in that writer;
failed replacement preserves prior evidence. There is no private staging table.
Loading decodes exactly one finite child per row into ordinary values. Native
key cursors close before suspension, and no file cleanup belongs to hydration.

Verified duplicates replace nested rows and may invoke forwarding again, matching
the frozen reference. Parent `/fwd` validation checks the child body and signed
`a.evt` commitment; authenticating child signatures belongs to its recipient.
The forwarder does not recursively dispatch children.

## Recipient data

`EssrRecipient` reads accepted evidence from LMDB and synchronously returns
ordinary authenticated inner bytes. The caller owns their memory lifetime;
plaintext is never automatically persisted. File staging, ownership transfer,
views and sinks are removed. Shared frame serialization, counters and actual
transport sources remain independent of ESSR persistence.

Pinned 1.2.14/1.3.6 Baser uses `.essrs`, while main uses `essrs.`. Direct legacy
database compatibility is [deferred](../../plans/db/DB_PARITY_PLAN.md#deferred-legacy-lmdb-compatibility);
legacy wire interoperability is required separately.
