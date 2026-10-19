# Reference material

Examples and inventories support the [designs](../design-docs/README.md); they
do not schedule work or prove current qualification by their presence.

- CESR: [frozen table audit](cesr/CESR_CURRENT_REFERENCE_TABLES.md).
- Compatibility: [KERI v1/v2 matrix and feature catalogue](compatibility/KERI_V1_V2_COMPATIBILITY.md),
  with a linked KERIpy 1.x/2.x porting backlog.
- Disclosure: [fixed-field/selective examples](credentials/DISCLOSURE_EXAMPLES.md)
  and [JSON walkthrough](credentials/JSON_DISCLOSURE_WALKTHROUGH.md).
- Registries: [verified-import preservation record](credentials/VERIFIED_IMPORT_SNAPSHOT.md).
- DB: [keyspace/families](db/KEYSPACE_AND_FAMILIES.md),
  [memoryview/Uint8Array](db/MEMORYVIEW_UINT8ARRAY.md),
  [behavioral test coverage](db/LMDBER_TEST_COVERAGE.md),
  [K/V inventory](db/KV_INVENTORY.md), [dated parity audit](db/DB_PARITY_AUDIT_2026-04-03.md).
- Runtime: [cue flows](runtime/CUE_FLOWS.md) and [historical mailbox sequences](mailbox/MAILBOX_FLOWS.md).
- CI: [PR test scope and local credit](PR_TEST_SCOPE.md).
- CLI: [Tufa scope](cli/TUFA_SCOPE.md) and [dated command matrix](cli/KLI_TUFA_COMMAND_PARITY_MATRIX.md).

Preserve provenance when reusing a historical inventory. Current source and
contracts outrank a dated row or example; the [DB plan](../plans/db/DB_PARITY_PLAN.md)
owns parity promotion.
