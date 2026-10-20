# Exchange evidence storage

LMDB is the storage authority for accepted and escrowed exchange evidence.
`essrs.` stores qualified Texter bytes under the EXN SAID followed by `.` and a
32-digit hexadecimal ordinal. This is KERIpy's physical insertion-ordered table
layout. `Baser.getEssrs` reconstructs the ordered sequence synchronously from
ordinary database rows, without private metadata or file references.

Equal fragments at different positions remain distinct. The signed payload
digest commits to their concatenated raw bytes; dropping one changes the
commitment. KERIpy's current IoSet writer deduplicates equal values, although its
reader can read repeated physical rows. TS uses ordinal writes to preserve that
sequence. The [upstream issue report](../../reports/essr/KERIPY_REPEATED_FRAGMENTS_2026-10-20.md)
records the pinned references, reproducer and proposed correction. There is no
new acceptance restriction or archive fallback.

Exchanger authenticates proofs, verifies the signed payload digest and route
policy, then publishes evidence and accepted/escrow state in one synchronous
LMDB transaction. A supplied duplicate and retained evidence must both match the
commitment. Valid alternate fragmentation keeps the first retained representation.
Publication failure rolls back the body, proofs, fragments and receipt together.
After commit, the operation joins the actual LMDB flush and invokes its handler.

Retry reconstructs evidence from the same tables and preserves the first receipt
and attachment genus. Terminal escrow removal clears only its pending evidence
in the transaction. Accepted evidence survives reopen and remains replayable.
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
