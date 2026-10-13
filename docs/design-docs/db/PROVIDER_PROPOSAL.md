# Storage-provider proposal

**Deferred and unimplemented.** The current backend is LMDB. This document records
the intended design constraints for a later provider, not an available Platform,
DBBackend or IndexedDB API. D8 of the [DB plan](../../plans/db/DB_PARITY_PLAN.md)
is gated on LMDB parity closure; this reorganization does not authorize that work.

A future provider boundary must preserve ordered key iteration, native duplicate
versus synthetic insertion-order semantics, transactions, typed records and
reopen/recovery behavior in the [DB contract](db-architecture.md). Higher layers
should consume semantic storage seams instead of reproducing cursor details.

Browser-safe protocol imports are already a package boundary; they do not imply
that the LMDB runtime works in browsers. A later IndexedDB/SQLite adapter needs
behavioral contract evidence, including atomic publication and cancellation, before
being described as equivalent. Filesystem/environment injection must stay at real
host boundaries rather than wrapping pure compute in operations.

The earlier speculative interface sketch is available in Git history at
`691998a2317881db484f216c00e81a68030dc3a2`, under
[the original platform sketch](https://github.com/kentbull/keri-ts/blob/691998a2317881db484f216c00e81a68030dc3a2/docs/design-docs/PLATFORM_ABSTRACTION.md). Do not implement it by rote.
