# Database parity plan

Planning constraint: [ADR-0013](../../adr/adr-0013-simple-component-flows.md) requires removal of
application accounting and unsupported delivery durability, without old-version
keri-ts API/data compatibility. Protocol correctness and real cleanup remain.

The broad LMDB/Suber/Komer/databaser foundation is implemented. Remaining work is
row-specific parity evidence and edge closure, not re-creating those APIs. The
[April audit](../../reference/db/DB_PARITY_AUDIT_2026-04-03.md) is a dated baseline;
reconcile its rows with current source before promoting them.

## Existing sequence and exit criteria

| Unit               | Remaining gate                                                   |
| ------------------ | ---------------------------------------------------------------- |
| D0 inventory       | Refresh symbol and K/V evidence against the selected reference   |
| D1 LMDBer          | Close lifecycle, key/ordinal and API-shape differences           |
| D2 Suber           | Prove each typed/category/concatenated family used by consumers  |
| D3 Komer           | Prove JSON/CBOR/MGPK records, keys and iteration                 |
| D4 databasers      | Verify named rows and durable read-through state                 |
| D5 escrow          | Verify reconstruction, retry, timeout and state transitions      |
| D6 CLI integration | Prove init/incept/endpoints/OOBI/comms/challenge stores          |
| D7 closure         | Resolve rows to equivalent or explicitly approved exclusion      |
| D8 providers       | Deferred until parity closure; no implementation authorized here |

Prioritize high-value Partial rows such as shared `fetchTsgs` and Komer evidence.
Existing runtime-specific reconstruction is not automatically a generic DB API.
The April audit includes TS-native key return types, factory style and datetime
representation differences; preserve those distinctions during re-audit.

## Evidence and constraints

Use frozen source from `dbing.py`, `subing.py`, `koming.py`, `recording.py`,
`basing.py` and `escrowing.py`, direct behavioral vectors, real workflow interop,
targeted `tufa db dump` comparisons and encrypted-store/AEID cases. Symbol presence
is not parity. Preserve [DB invariants](../../design-docs/db/db-architecture.md)
and [LMDBer coverage](../../reference/db/LMDBER_TEST_COVERAGE.md).

The K/V CSV inventories beside the April audit retain Gate A–G and Gate H row
classification as historical scope evidence. The missing old parent plan is not
an active dependency: the exit criteria above and the [command matrix][commands]
identify the retained obligations. Full DB parity requires all D0–D7 evidence,
not merely passing bootstrap commands.

Use typed storage seams; avoid command-level bypasses and speculative provider
abstraction before LMDB parity closure. The [provider proposal][provider] remains
unimplemented. Runtime row allocation, payload copies and crash recovery belong
to the coordinated [storage phase](STORAGE_RECOVERY_PLAN.md), not a duplicate task.

[commands]: ../../reference/cli/KLI_TUFA_COMMAND_PARITY_MATRIX.md
[provider]: ../../design-docs/db/PROVIDER_PROPOSAL.md
