# ESSR persistence against pinned KERIpy main

Status: approved release-plan redirect, 2026-10-20.
Owner: [release PR 12e](../V2_RELEASE_COMPLETION_PLAN.md#essr-storage-correction--pr-12e).
Execute next after messenger selection PR 13b, before PR 13c and final qualification.
This supersedes the position-preserving and first-representation decisions in
PRs #598/#599, without reverting their archive and staging removal.

## Target and support boundary

Reverify immutable main `424a50c03421165c5f289e07a341bd57b8d8ab78` before
implementation: `Baser.essrs`, `CesrIoSetSuber`/LMDB operations,
`Exchanger.processEvent/logEvent`, escrow persistence and reconstruction.
Inspection at adoption confirms these bindings:

| Python reference                                  | Actual Baser table | ESSR abstraction         |
| ------------------------------------------------- | ------------------ | ------------------------ |
| main `424a50c03421165c5f289e07a341bd57b8d8ab78`   | `essrs.`           | `CesrIoSetSuber<Texter>` |
| 1.2.14 `bab95c16e949b61398129a3e41a8f68bad84c94f` | `.essrs`           | `CesrIoSetSuber<Texter>` |
| 1.3.6 `4ce4cc79e06653f77342be1bf604086b89b1f090`  | `.essrs`           | `CesrIoSetSuber<Texter>` |

Rows use EXN SAID plus `.` and a 32-digit hexadecimal ordinal, with qualified
Texter bytes as values. Physical row readability, ordered-set writer behavior,
actual Baser binding, protocol interoperability and complete database/keystore
interchangeability are separate claims. Main ESSR qualification proves only its
tested scope, not full Keeper/Habery interchangeability.

Use main's `essrs.` binding. No legacy table discovery, read fallback, dual write,
copying, automatic migration or storage-version setting. Direct legacy LMDB
compatibility is [deferred to its canonical DB roadmap owner][legacy], outside the
2.0 gate. **Legacy KERI/ACDC/CESR wire interoperability remains required.**

## One cohesive corrective PR: responsibility, behavior, qualification

Respect the ten constraints, SOLID and ADR-0013: refactor ownership/contracts
before behavior. Keep ongoing main-task changes and use the existing PR workflow.

1. Restore `Baser.essrs: CesrIoSetSuber<Texter>` bound to `essrs.` in
   `packages/keri/src/db/basing.ts`. Remove `pinEssrs` and ESSR-specific ordinal
   traversal/writes. Use existing typed `add/get/rem`; retain a small read helper
   only for a real accepted-versus-escrow ownership responsibility. Match qualified
   value equality and first-insertion order. Duplicate `add` returning false is
   ordinary deduplication; actual exceptions propagate and roll back publication.
   Leave generic ordinal/IoSet semantics unchanged.
2. Align Exchanger's `admit/admitCurrent`, accepted logging, escrow/retry,
   reconstruction/replay and terminal cleanup with the reference. Add supplied
   Texters to the existing set, removing custom write-only-if-empty and
   first-representation rules. Verify the **incoming** signed commitment before
   persistence; retry, replay and recipient input use **stored** members. Valid
   alternate fragmentations on redelivery can append distinct members even when
   each incoming concatenation matches the same commitment; characterize this.
3. Explicitly accept the reference's repeated-fragment persistence limitation.
   A valid incoming commitment may no longer match deduplicated reconstruction.
   Do not weaken validation, coalesce fragments, invent unique wrappers or another
   evidence table, or reject all repeated fragments before storage. Do not copy
   the separate pinned-main unknown-sender escrow evidence-loss defect.
4. Preserve #598/#599 removal of PayloadArchive, PayloadStore, private file
   ownership, file staging and durable plaintext. Keep synchronous EssrRecipient
   decryption; signatures, signed digests, recipient/envelope authentication,
   sealed-box/SCS checks, transactions, actual flush/close behavior and unrelated
   provenance. Do not deduplicate parser output or CESR serialization. Complete
   nested child streams stored in `enst.` have a different boundary: preserve
   their wire bytes and tests.

## Focused evidence

Adapt `exchanging-payload.test.ts` and existing ESSR cases, rather than adding an
exhaustive matrix:

- Unique Texters retain insertion order through reopen; repeated qualified
  Texters deduplicate with matching `add` returns.
- Identical redelivery is idempotent; alternate fragmentation follows main's
  append/set behavior.
- A signed repeated-fragment input verifies before persistence, but reconstructed
  stored bytes fail the original digest. Keep this explicit limitation regression.
- A genuine storage exception rolls back publication; duplicate-add false does
  not. Retain acceptance/restart/escrow retry/replay successes with distinct
  fragments, digest-mismatch rejection and justified authentication refusals.

Replace `essr-store-reference.py`'s manually constructed `essrs.` Suber with
actual pinned-main `Baser.essrs` on disposable native LMDB stores. Prove both
directions, physical rows, duplicate insertion behavior and reopen. Inspect
`interop-essr-storage.test.ts`, its CI owner/workflow/profile selection: explicitly
scope this owner to main. Do not silently skip old profiles while claiming
three-version storage qualification. Historical manually bound typed-reader
findings do not prove native legacy Baser compatibility.

Rerun bounded ESSR wire exchanges on actual main, 1.2.14 and 1.3.6; retain
source/import checks, main KEL-first acceptance and legacy escrow retry. Do not
patch Python reference sources. Run focused unit/native-storage tests, static
and changeset checks, and appropriate installed-package checks in the established
isolated Docker setup. Fresh final qualification still follows all implementation
and package organization work.

## Required concise documentation corrections in the corrective PR

Update affected claims together; no per-PR report or progress diary:

- `docs/reference/compatibility/MIGRATING_TO_2_0.md`: main target, table-name
  difference, restored set semantics and limitation; remove position-preserving
  instructions. Distinguish deferred legacy databases from required legacy wire.
- `docs/reference/compatibility/KERI_V1_V2_COMPATIBILITY.md`: per-version table
  bindings; GAP-03's explicit support boundary and [deferred roadmap owner][legacy].
- `docs/design-docs/db/PAYLOAD_STORAGE.md`: archive-free ordered-set contract;
  valid incoming commitment versus potentially lossy stored reconstruction.
- `docs/design-docs/essr/RECIPIENT.md`: retained evidence can fail digest checks
  after reference-compatible deduplication; retain authenticated finite output.
- `docs/reports/essr/KERIPY_REPEATED_FRAGMENTS_2026-10-20.md`: preserve historical
  reproducer/results; mark ordinal-preserving implementation superseded. Correct
  three-pin typed-reader scope: manually binding `essrs.` did not test native
  legacy Baser binding. Keep the conceptual upstream sequence-storage fix as
  future work; no upstream submission is authorized.
- `docs/reports/essr/KERIPY_ESSR_ESCROW_EVIDENCE_2026-10-20.md`: preserve separate
  defect/history; correct cross-references that describe the old local contract.
- `docs/reference/db/KV_INVENTORY.md`: source/version qualification and current
  compatibility link. Verify apparent `.essars` spelling against source before
  correcting or annotating; this historical inventory is not a universal schema.
- `docs/plans/db/DB_PARITY_PLAN.md` and `STORAGE_RECOVERY_PLAN.md`: main target,
  deferred legacy work, no universal compatibility wording across table bindings.
- `docs/plans/V2_RELEASE_COMPLETION_PLAN.md`: supersede ordinal instructions
  without rewriting historical execution evidence.
- `.agents/learnings/PROJECT_LEARNINGS_STORAGE.md`: remove obsolete multiplicity
  and first-representation guidance; change its routing index only if necessary.
- `/Users/kbull/enc/enctx/plans-done/keri/keripy/multisig-lmdb-state-inventory.md`:
  preserve historical `.essrs`; add a concise dated qualification linking the
  current main/legacy distinction and active DB roadmap. Do not reactivate it.
- Correct affected changeset/release-note wording; the prominent 2.0 breaking
  material must describe the final implementation and removed public APIs.

Completion requires actual main storage parity, corrected callers and claims,
preserved security/legacy wire interoperability and the owned deferred roadmap.
Main-targeted parity deliberately does not solve the documented set limitation.

[legacy]: ../db/DB_PARITY_PLAN.md#deferred-legacy-lmdb-compatibility
