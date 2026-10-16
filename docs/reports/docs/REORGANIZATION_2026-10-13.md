# Documentation reorganization audit — 2026-10-13

> Historical snapshot at the source revision below. Its pending items and
> implementation names are not a current queue or preservation contract. See the
> [release and post-release record](../parity/CLEANUP_RELEASE_2026-10-16.md) and ADR-0012/0013
> for subsequent delivery and supersession. Original measurements remain unchanged.

Base: `691998a2317881db484f216c00e81a68030dc3a2` (#168). Scope covers every
tracked plan/design and project/topic learning file, source-adjacent contracts,
the versioning plan and existing archives. Review here means purpose, subject,
status, duplication and reference reconciliation; it does not requalify every
historical protocol claim or execute archived proposals.

## Decisions

- One parity roadmap coordinates the same numbered sequence. Subject plans retain
  all remaining acceptance gates, defaults and unresolved limits.
- Behavior lives in subject designs. Dated observations, inventories and tutorials
  have separate report/reference homes; retired plans are clearly historical.
- Learnings retain durable rules with one subject owner. Routine milestone history
  is recoverable in Git, not duplicated in a new diary.
- Corrected source-confirmed stale statements: replay genus, LMDB runtime pin,
  nested IPEX support, table pin, CLI framework, delegated rotation and mailbox read policy.
  The old Uint8Array note incorrectly claimed zero-copy LMDB reads; current getVal
  copies the materialized value, so pre-allocation admission remains open.
- The historical 70-row DB symbol workbook moved losslessly to CSV; wide narrative
  tables use short comparisons or vertical records. No protocol source/test behavior,
  workflow pin, participant topology, assertion or qualification cap changed.

## Inventory disposition

### Learnings

- [PROJECT_LEARNINGS.md](../../../.agents/PROJECT_LEARNINGS.md): Rewritten as durable rules; shared subjects extracted; chronology removed.
- [PROJECT_LEARNINGS_ACDC.md](../../../.agents/learnings/PROJECT_LEARNINGS_ACDC.md): Rewritten as durable rules; shared subjects extracted; chronology removed.
- [PROJECT_LEARNINGS_CESR.md](../../../.agents/learnings/PROJECT_LEARNINGS_CESR.md): Rewritten as durable rules; shared subjects extracted; chronology removed.
- [PROJECT_LEARNINGS_CRYPTO_SUITE.md](../../../.agents/learnings/PROJECT_LEARNINGS_CRYPTO_SUITE.md): Rewritten as durable rules; shared subjects extracted; chronology removed.
- [PROJECT_LEARNINGS_KELS.md](../../../.agents/learnings/PROJECT_LEARNINGS_KELS.md): Rewritten as durable rules; shared subjects extracted; chronology removed.
- [PROJECT_LEARNINGS_WITNESS_WATCHER_OBSERVER_INFRA.md](../../../.agents/learnings/PROJECT_LEARNINGS_WITNESS_WATCHER_OBSERVER_INFRA.md): Rewritten as durable rules; shared subjects extracted; chronology removed.

### Existing archives

- [CESR_PARSER_COMPLETENESS_DECISION_2026-03-01.md](../../archived-plan-docs/cesr/cesr-parser/CESR_PARSER_COMPLETENESS_DECISION_2026-03-01.md): Retained historical record; archive index clarifies authority.
- [CESR_PARSER_CROSS_IMPL_COMPARISON_2026-03-01.md](../../archived-plan-docs/cesr/cesr-parser/CESR_PARSER_CROSS_IMPL_COMPARISON_2026-03-01.md): Retained historical record; archive index clarifies authority.
- [CESR_PARSER_RECONCILIATION_MATRIX_2026-03-01.md](../../archived-plan-docs/cesr/cesr-parser/CESR_PARSER_RECONCILIATION_MATRIX_2026-03-01.md): Retained historical record; archive index clarifies authority.
- [cesr-parser-buffer-perf-plan.md](../../archived-plan-docs/cesr/cesr-parser/cesr-parser-buffer-perf-plan.md): Retained historical record; archive index clarifies authority.
- [cesr-parser-p2-hardening-interop-plan.md](../../archived-plan-docs/cesr/cesr-parser/cesr-parser-p2-hardening-interop-plan.md): Retained historical record; archive index clarifies authority.
- [cesr-parser-phase0-behavior-lock-parity-matrix.md](../../archived-plan-docs/cesr/cesr-parser/cesr-parser-phase0-behavior-lock-parity-matrix.md): Retained historical record; archive index clarifies authority.
- [cesr-parser-readability-improvement-plan.md](../../archived-plan-docs/cesr/cesr-parser/cesr-parser-readability-improvement-plan.md): Retained historical record; archive index clarifies authority.
- [cesr-parser-readability-phased-roadmap.md](../../archived-plan-docs/cesr/cesr-parser/cesr-parser-readability-phased-roadmap.md): Retained historical record; archive index clarifies authority.
- [CESR_ANNOTATION_PLAN.md](../../archived-plan-docs/cesr/cesr-parser/initial-plan-docs/CESR_ANNOTATION_PLAN.md): Retained historical record; archive index clarifies authority.
- [CESR_PARSER_CONSOLIDATED_PLAN_AND_RESULTS.md](../../archived-plan-docs/cesr/cesr-parser/initial-plan-docs/CESR_PARSER_CONSOLIDATED_PLAN_AND_RESULTS.md): Retained historical record; archive index clarifies authority.
- [CESR_PARSER_FLOW_FROM_TUFA_ANNOTATE.md](../../archived-plan-docs/cesr/cesr-parser/initial-plan-docs/CESR_PARSER_FLOW_FROM_TUFA_ANNOTATE.md): Retained historical record; archive index clarifies authority.
- [CESR_PARSER_PROGRESS_SUMMARY_2026-02-13.md](../../archived-plan-docs/cesr/cesr-parser/initial-plan-docs/CESR_PARSER_PROGRESS_SUMMARY_2026-02-13.md): Retained historical record; archive index clarifies authority.
- [my-cesr-plan.md](../../archived-plan-docs/cesr/cesr-parser/initial-plan-docs/my-cesr-plan.md): Retained historical record; archive index clarifies authority.
- [CESR_PRIMITIVES_KERIPY_PARITY_MATRIX.md](../../archived-plan-docs/cesr/cesr-primitives/CESR_PRIMITIVES_KERIPY_PARITY_MATRIX.md): Retained historical record; archive index clarifies authority.
- [CESR_PRIMITIVES_WALKTHROUGH.md](../../archived-plan-docs/cesr/cesr-primitives/CESR_PRIMITIVES_WALKTHROUGH.md): Retained historical record; archive index clarifies authority.
- [ASYNC_VS_SYNC_LMDB.md](../../archived-plan-docs/db/ASYNC_VS_SYNC_LMDB.md): Retained historical record; archive index clarifies authority.
- [LMDB_TRANSACTION_CURSOR_PATTERNS.md](../../archived-plan-docs/db/LMDB_TRANSACTION_CURSOR_PATTERNS.md): Retained historical record; archive index clarifies authority.
- [CODEBASE_QUALITY_PASS_PLAN.md](../../archived-plan-docs/quality/CODEBASE_QUALITY_PASS_PLAN.md): Retained historical record; archive index clarifies authority.

### Plans and designs

- [PLATFORM_ABSTRACTION.md](../../design-docs/db/PROVIDER_PROPOSAL.md): Reviewed ownership/status and links; retained normative substance in subject design.
- [CESR_ATOMIC_BOUNDED_PARSER_ARCHITECTURE.md](../../archived-plan-docs/cesr/cesr-parser/CESR_ATOMIC_BOUNDED_PARSER_ARCHITECTURE.md): Archived superseded checklist; current owners linked from indexes.
- [CESR_CURRENT_REFERENCE_TABLES.md](../../reference/cesr/CESR_CURRENT_REFERENCE_TABLES.md): Classified inventory/example; removed obsolete scheduling; preserved provenance.
- [CESR_PARSER_MAINTAINER_GUIDE.md](../../design-docs/cesr/CESR_PARSER_MAINTAINER_GUIDE.md): Reviewed ownership/status and links; retained normative substance in subject design.
- [CESR_PARSER_STATE_MACHINE_CONTRACT.md](../../design-docs/cesr/CESR_PARSER_STATE_MACHINE_CONTRACT.md): Reviewed ownership/status and links; retained normative substance in subject design.
- [CESR_PROGRESSIVE_PARSER_CONTRACT.md](../../design-docs/cesr/CESR_PROGRESSIVE_PARSER_CONTRACT.md): Reviewed ownership/status and links; retained normative substance in subject design.
- [CESR_PROGRESSIVE_PARSER_PLAN.md](../../plans/PARITY_ROADMAP.md): Split into coordinated subject plans; historical evidence summarized separately.
- [GRADUATED_DISCLOSURE_MAINTAINER_GUIDE.md](../../design-docs/credentials/GRADUATED_DISCLOSURE.md): Reviewed ownership/status and links; retained normative substance in subject design.
- [EFFECTION_CLI_INTEGRATION.md](../../design-docs/cli/EFFECTION_CLI_INTEGRATION.md): Reviewed ownership/status and links; retained normative substance in subject design.
- [KLI_INIT_IMPLEMENTATION_PLAN.md](../../archived-plan-docs/cli/KLI_INIT_IMPLEMENTATION_PLAN.md): Archived superseded checklist; current owners linked from indexes.
- [port-kli-init-to-tufa.md](../../archived-plan-docs/cli/port-kli-init-to-tufa.md): Archived superseded checklist; current owners linked from indexes.
- [tufa-high-level-keri-ts-plan.md](../../reference/cli/TUFA_SCOPE.md): Classified inventory/example; removed obsolete scheduling; preserved provenance.
- [LMDBER_IMPLEMENTATION_PLAN.md](../../archived-plan-docs/db/LMDBER_IMPLEMENTATION_PLAN.md): Archived superseded checklist; current owners linked from indexes.
- [LMDBER_MEANINGFUL_TEST_PLAN.md](../../reference/db/LMDBER_TEST_COVERAGE.md): Classified inventory/example; removed obsolete scheduling; preserved provenance.
- [MEMORYVIEW_UINT8ARRAY.md](../../reference/db/MEMORYVIEW_UINT8ARRAY.md): Classified inventory/example; removed obsolete scheduling; preserved provenance.
- [db-architecture.md](../../design-docs/db/db-architecture.md): Reviewed ownership/status and links; retained normative substance in subject design.
- [lmdb-dumper.md](../../reference/db/KV_INVENTORY.md): Classified inventory/example; removed obsolete scheduling; preserved provenance.
- [ACDC_TEL_IPEX_VERIFIER_MAINTAINER_GUIDE.md](../../design-docs/credentials/ACDC_TEL_VERIFIER.md): Reviewed ownership/status and links; retained normative substance in subject design.
- [ATTACHMENT_COUNTER_GVRSN_MAINTAINER_GUIDE.md](../../design-docs/cesr/ATTACHMENT_COUNTER_GVRSN.md): Reviewed ownership/status and links; retained normative substance in subject design.
- [CUE_ARCHITECTURE_CROSS_RUNTIME.md](../../design-docs/runtime/CUES.md): Reviewed ownership/status and links; retained normative substance in subject design.
- [DELEGATION_MULTISIG_ENDPOINT_ROLES_MAINTAINER_GUIDE.md](../../design-docs/kel/DELEGATION_AND_ENDPOINTS.md): Reviewed ownership/status and links; retained normative substance in subject design.
- [MAILBOX_ARCHITECTURE_ACROSS_KERIPY_AND_KERI_TS.md](../../design-docs/mailbox/MAILBOX.md): Reviewed ownership/status and links; retained normative substance in subject design.
- [QUERY_REPLY_CORRESPONDENCE_AND_WATCHER_SUPPORT.md](../../design-docs/runtime/QUERY_REPLY.md): Reviewed ownership/status and links; retained normative substance in subject design.
- [TUFA_SIGN_QUERY_ROTATE_MAINTAINER_GUIDE.md](../../design-docs/cli/SIGN_QUERY_ROTATE.md): Reviewed ownership/status and links; retained normative substance in subject design.
- [WEIGHTED_THRESHOLD_PARITY.md](../../design-docs/kel/WEIGHTED_THRESHOLDS.md): Reviewed ownership/status and links; retained normative substance in subject design.
- [mailbox-durable-admission.md](../../design-docs/mailbox/MAILBOX.md): Reviewed ownership/status and links; retained normative substance in subject design.
- [witness-key-state-http.md](../../design-docs/runtime/WITNESS_HTTP.md): Reviewed ownership/status and links; retained normative substance in subject design.
- [MULTISIG_IPEX_WORKFLOWS_IMPLEMENTATION_PLAN.md](../../archived-plan-docs/exchange/MULTISIG_IPEX_WORKFLOWS_IMPLEMENTATION_PLAN.md): Archived superseded checklist; current owners linked from indexes.
- [DB_LAYER_PARITY_MATRIX.md](../../reference/db/DB_PARITY_AUDIT_2026-04-03.md): Classified inventory/example; removed obsolete scheduling; preserved provenance.
- [DB_LAYER_RECONCILIATION_PLAN.md](../../plans/db/DB_PARITY_PLAN.md): Condensed active acceptance; removed stale parent-plan dependencies.
- [KLI_TUFA_COMMAND_PARITY_MATRIX.md](../../reference/cli/KLI_TUFA_COMMAND_PARITY_MATRIX.md): Classified inventory/example; removed obsolete scheduling; preserved provenance.
- [aggressive-test-optimization.md](../../archived-plan-docs/quality/aggressive-test-optimization.md): Archived superseded checklist; current owners linked from indexes.
- [cesr-ts-pkg-dep-boundary.md](../../archived-plan-docs/packaging/cesr-ts-pkg-dep-boundary.md): Archived superseded checklist; current owners linked from indexes.
- [clean-architecture-phase0-baseline.md](../architecture/clean-architecture-phase0-baseline.md): Moved dated observations out of active plans; marked historical.
- [delegation-interop-handoff-2026-04-10.md](../delegation/delegation-interop-handoff-2026-04-10.md): Moved dated observations out of active plans; marked historical.
- [delegation-single-sig-keripy-trace-2026-04-10.md](../delegation/delegation-single-sig-keripy-trace-2026-04-10.md): Moved dated observations out of active plans; marked historical.
- [lmdb-js-deno-cleanup-hook-upstream-notes.md](../db/lmdb-js-deno-cleanup-hook-upstream-notes.md): Moved dated observations out of active plans; marked historical.
- [mailbox-read-authorization.md](../../design-docs/mailbox/READ_AUTHORIZATION.md): Reviewed ownership/status and links; retained normative substance in subject design.
- [layers-and-libs-reorg.md](../../archived-plan-docs/packaging/layers-and-libs-reorg.md): Archived superseded checklist; current owners linked from indexes.
- [versioning-and-release-plan.md](../../design-docs/release/VERSIONING.md): Reviewed ownership/status and links; retained normative substance in subject design.
- [pwhash.md](../../design-docs/crypto/ARGON2_OWNERSHIP.md): Reviewed ownership/status and links; retained normative substance in subject design.
- [essr.md](../../design-docs/essr/RECIPIENT.md): Reviewed ownership/status and links; retained normative substance in subject design.
- [reactor.md](../../design-docs/runtime/INGRESS_AND_EGRESS.md): Reviewed ownership/status and links; retained normative substance in subject design.
- [payload-store.md](../../design-docs/db/PAYLOAD_STORAGE.md): Reviewed ownership/status and links; retained normative substance in subject design.

## Validation

Local Markdown target/anchor and moved-path checks pass. All 70 rows and 11 fields
of the historical symbol table match the exported CSV exactly. Formatting,
export documentation checks and the 128-file maintained test ownership audit pass.
This documentation-only change does not rerun runtime qualification.

## Limits

Historical archives retain old paths and proposed behavior as evidence, under
explicit status banners. Their checkboxes are not reopened tasks. Fresh full
reference qualification, shared runtime admission, pre-allocation LMDB admission,
transport evidence and Mapper repair remain open in the roadmap.
