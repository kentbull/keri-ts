# Active plans

Planning constraint: the [accepted simplification](PARITY_ROADMAP.md) supersedes older
architecture requirements. Concrete owners, one worker model and complete-enclosure
buffering replace speculative frameworks; protocol correctness and real cleanup remain.

The [parity roadmap](PARITY_ROADMAP.md) records the completed 1.0.0 baseline and
future change discipline. Subject files below retain acceptance standards and
explicit profile limits; they do not resume the completed cleanup sequence.

- [Explicit runtime dependencies](runtime/explicit-runtime-dependencies.md): completed removal of RuntimeServices/dependency options and the separate verifier clock correction, with full post-merge qualification.
- [HTTP client simplification](runtime/http-client-simplification.md): phased reduction to prepared bodies, finite responses and a small scoped streaming path.
- [KERIpy compatibility ports](compatibility/KERIPY_COMPATIBILITY_PORTS.md): proposed
  1.x/2.x target assessment and ports tied to the maintained v1/v2 compatibility inventory.
- [HTTP request ownership refactor](runtime/http-request-ownership-refactor.md): Request validation before fetch, one concrete request/body owner,
  and composition-supplied HTTP behavior without client identity checks.
- [Messenger and protocol refactor](runtime/messenger-protocol-refactor.md): phased extraction of shared protocol processing, concrete TCP/HTTP messengers,
  and explicit constructor dependencies; final qualification follows the last merge.
- [Cue delivery refactor](runtime/cue-delivery-refactor.md): completed message
  production, FIFO Poster execution, retained failures and transport completion work.
  The [reliability roadmap](runtime/cue-reliability-roadmap.md) records deferred
  features and the evidence required before pursuing them.

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
