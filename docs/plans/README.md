# Active plans

Planning constraint: the [accepted simplification](PARITY_ROADMAP.md) supersedes older
architecture requirements. Concrete owners, one worker model and complete-enclosure
buffering replace speculative frameworks; protocol correctness and real cleanup remain.

The [parity roadmap](PARITY_ROADMAP.md) records the completed 1.0.0 baseline and
future change discipline. Subject files below retain acceptance standards and
explicit profile limits; they do not resume the completed cleanup sequence.

- [Cue reliability roadmap](runtime/cue-reliability-roadmap.md): deferred capabilities and the evidence needed before design.
- [KERIpy compatibility ports](compatibility/KERIPY_COMPATIBILITY_PORTS.md): proposed
  1.x/2.x target assessment and ports tied to the maintained v1/v2 compatibility inventory.
- [2.0.0 release completion](V2_RELEASE_COMPLETION_PLAN.md): approved execution plan;
  operator fixes, native-v2 CLI, multisig/backer lifecycle, protocol interoperability
  and three-package release.

Completed runtime execution plans and the historical declaration-coverage ledger
are removed. Keep current behavior in design documents and decisions in ADRs;
use Git/PR history for completed work. Edit active plans when scope, contracts or
gates change, rather than recording each commit, test run or PR transition.

- [CESR parser](cesr/CESR_PROGRESSIVE_PARSER_PLAN.md) and [Mapper](cesr/MAPPER_PLAN.md).
- [Multisig](exchange/MULTISIG_PLAN.md), [IPEX](exchange/IPEX_PLAN.md),
  [exchange proofs and v2 admission](exchange/EXCHANGE_ADMISSION_PLAN.md).
- [V1/V2 registries](credentials/REGISTRY_PLAN.md) and [KRAM](exchange/KRAM_PLAN.md).
- [ESSR](essr/ESSR_PLAN.md) and [retired resource policy](../adr/adr-0013-simple-component-flows.md).
- [Storage/recovery](db/STORAGE_RECOVERY_PLAN.md) and [transport](runtime/TRANSPORT_PLAN.md).
- [Full qualification](qualification/QUALIFICATION_PLAN.md) and
  [reference environments](qualification/REFERENCE_ENVIRONMENTS.md).
- [Broader DB parity](db/DB_PARITY_PLAN.md): row-level closure; provider work remains deferred.

Delivered parser migration, package/CLI extraction, release automation and test
reorganization are not fresh task lists. See [delivery evidence](../reports/parity/DELIVERED_THROUGH_168.md),
[designs](../design-docs/README.md), [historical plans](../archived-plan-docs/README.md)
and the dated [command parity reference](../reference/cli/KLI_TUFA_COMMAND_PARITY_MATRIX.md).
Future platform/role work requires its own scope decision; archival checkboxes do
not authorize it. Plan updates keep completed work concise and retain unresolved gates.
