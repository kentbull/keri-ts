# Database parity plan

Planning constraint: the [accepted simplification](../PARITY_ROADMAP.md) supersedes older
architecture requirements. Concrete owners, one worker model and complete-enclosure
buffering replace speculative frameworks; protocol correctness and real cleanup remain.

The broad LMDB/Suber/Komer/databaser foundation is implemented. Remaining work is
row-specific parity evidence and edge closure, not re-creating those APIs. The
[April audit](../../reference/db/DB_PARITY_AUDIT_2026-04-03.md) is a dated baseline;
reconcile its rows with current source before promoting them.

## Present ESSR target

The approved [ESSR correction](../essr/ESSR_STORAGE_PARITY_PLAN.md), release PR
12e, targets actual `Baser.essrs` on pinned main
`424a50c03421165c5f289e07a341bd57b8d8ab78`: `essrs.`, ordinary insertion-ordered
Texter set and its writer semantics/limitations. The legacy 1.2.14 `bab95c16` and
1.3.6 `4ce4cc79` Baser bindings are `.essrs`. Physical row readability through a
manually named Suber does not establish native Baser compatibility, much less
complete Habery/Keeper interchangeability. Legacy wire interoperability remains
required for 2.0; direct legacy LMDB compatibility is deferred below.
The `interop-essr-storage` owner uses actual main Baser only. The separate wire
owner retains main/1.2/1.3 exchanges; neither proves complete database interchange.

## Deferred legacy LMDB compatibility

Canonical roadmap owner; **outside the current 2.0 release gate**. Design and
qualify before claiming support or implementing mechanisms:

- Inventory version-pinned named databases, codecs, metadata and pending-work
  representations against the supported actual Python versions.
- Specify opening, creation and version selection. Decide read/write interchange
  versus one-time upgrade/export/import, rather than assuming they are equivalent.
- Define handling when both ESSR table names exist, conflicting evidence,
  duplicate values and alternate fragment representations occur.
- If migration is selected, define safe boundaries, untouched backups, rollback
  and crash recovery before implementation.
- Qualify actual Baser/Habery and relevant Keeper owners, not arbitrary manually
  constructed Subers. Prove bidirectional reads/writes, restart, escrow/replay and
  semantic validity with the real supported Python versions.

Do not add discovery, fallback readers, dual writes, table copies, automatic
migration or a storage-version setting to PR 12e. This deferral does not weaken
legacy KERI/ACDC/CESR wire requirements or defer main-targeted ESSR parity.

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
