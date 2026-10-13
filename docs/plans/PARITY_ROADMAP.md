# KERIpy parity and bounded runtime roadmap

Verified boundary: keri-ts `5d439213` after [#185][registry-inception].
Frozen upstream: `927c0cb8794d7c84fc17143c67df64aab9deda6c`.
This roadmap continues the approved parser-gap sequence; the subject plans below
own its existing work, not additional projects. The original migration and
completed PR evidence are summarized in the [delivery report][delivered].

The workload is many bounded logical messages in large aggregate transfers.
Structural parsing is implemented. Full runtime parity and bounded-memory
qualification are **incomplete**. Parent-owned nested children are never
independently accepted GenericGroup siblings.

## Acceptance matrix

Each linked owner contains the evidence gate and unresolved limitations. Phase
numbers refer to the seven follow-on phases, not the earlier migration steps.

| Requirement      | Current boundary | Owner                 | Evidence                | Open limit         |
| ---------------- | ---------------- | --------------------- | ----------------------- | ------------------ |
| CESR parsing     | Delivered        | [1–2][cesr]           | [Wire/tree][delivered]  | Accessor audit     |
| Multisig         | Four routes      | [3d][multisig]        | [#160–161][delivered]   | Native/CLI scope   |
| IPEX             | Nested runtime   | [3e][ipex]            | [#166–168][delivered]   | Presentations      |
| V1/V2 registries | V2 inception     | [R6–R12][registry]    | [R1–R5][registry]       | Updates/services   |
| EXN proofs       | Implemented      | [3e/3f][exchange]     | [#162/165][delivered]   | KRAM integration   |
| v2 intake        | KRAM foundations | [K7–K10][kram]        | [K1–K6b][kram]          | Intake/TEL/stubs   |
| ESSR outcomes    | Implemented      | [4 integration][essr] | [#163][delivered]       | Local guards       |
| Shared budget    | Local guards     | [4][resource]         | [Required][resource]    | Pre-allocation     |
| Storage/recovery | Durable wire     | [5][storage]          | [Required][storage]     | Whole-row reads    |
| Transport        | Streaming paths  | [6][transport]        | [Required][transport]   | Usable-child proof |
| Reference pins   | Mixed targets    | [7][qualification]    | [Inventory][pins]       | Actual imports     |
| Qualification    | Small corpora    | [7][qualification]    | [Matrix][qualification] | Full runtime       |
| Mapper SAID      | Stale claim gap  | [Final][mapper]       | [Required][mapper]      | Aggor semantics    |
| npm release      | Pending          | [#104][release]       | Published artifacts     | Final goal gate    |

## Publication sequence

1. Docs (#169), sender admission (#170) and store ownership (#171) are delivered.
   Replace the unmerged #172 integration snapshot with [K1–K10][kram].
   Independent registry analysis/storage can proceed alongside KRAM.
2. Prioritize full v2 registry foundations [R1–R12][registry], preserving v1 and
   existing v2 stores. Then finish built-in TEL queries and IPEX presentations.
   Keep unimplemented consumers guarded; `xip/pro/bar` are reference stubs.
3. Shared admission (4), storage/recovery (5), production backpressure (6).
4. Full reference audit and repeated end-to-end qualification (7).
5. Focused standalone Mapper repair; rerun affected qualification after it.
6. Finish with the npm release: refresh and merge [#104][release] only after
   the preceding work and qualification, then publish and verify the exact
   package artifacts. The version PR alone does not prove publication.

The multisig responsibility extraction (#161), ESSR outcome extraction (#163),
and proof cleanup (#165) are delivered. Do not recreate them. Target **300–500
added or removed lines, or fewer, per PR**, including tests, fixtures, scripts and
docs. A larger unit needs a concrete reason explained before publication; prefer
splitting complete semantic responsibilities. Do not game the count by minifying,
compressing artifacts or omitting verification. Dependent PRs may branch from
unmerged predecessors and target their branches for a small stacked diff.
Independent units may proceed in parallel worktrees. Before merging a dependent
PR, land its predecessors, synchronize/retarget it to master, then require green
CI on its resulting exact head. Preserve published history unless rewriting is
explicitly authorized.
Preserve worktrees, benchmark baselines, assertions and participant topology.
Use explicit changesets and register every maintained test in the inventory.

Reuse existing tests/workflows before adding coverage. Commit new integration or
end-to-end tests only with strong justification, especially a missing happy path;
exploratory probes may remain uncommitted with recorded evidence. Apply the same
maintenance-value test to unit tests: choose the smallest meaningful regression,
not implementation-mirroring assertions or new infrastructure by default.
Preserve existing assertions and topology; this rule does not reduce qualification.

Final reporting must classify **supported**, **unfinished**, **intentional
divergence**, **reference stub**, and **unqualified** behavior separately.
Passing parser tests or finite per-recipient guards cannot close phases 4–7.
Long qualification stays outside required merge CI; only the maintainer dispatches
hosted extended jobs, whose existing 15-minute cap remains unchanged.

## Final release gate

The approved final task is publication of `cesr-ts`, `keri-ts` and `@keri-ts/tufa`
for downstream diddaemon adoption. Recheck #104's generated versions, dependency
ranges, changelogs and exact-head checks after all implementation changes land.
The current Changesets workflow only maintains versions; npm publication uses
the existing package tag/dispatch workflows. Release in dependency order and
verify registry versions, dependency metadata, tarball identity and installed
package smoke behavior. If Actions cannot publish, use the authorized local
publishing path while preserving the checked artifact and version identity.
Report exact published versions and release evidence for the downstream chat;
do not close the goal on a merged version PR or a successful build alone.

[registry-inception]: https://github.com/kentbull/keri-ts/pull/185
[release]: https://github.com/kentbull/keri-ts/pull/104
[kram]: exchange/KRAM_PLAN.md
[registry]: credentials/REGISTRY_PLAN.md
[ownership]: ../design-docs/runtime/INGRESS_AND_EGRESS.md#runtime-store-ownership
[intake]: ../design-docs/exchange/MESSAGE_ADMISSION.md
[delivered]: ../reports/parity/DELIVERED_THROUGH_168.md
[cesr]: cesr/CESR_PROGRESSIVE_PARSER_PLAN.md
[multisig]: exchange/MULTISIG_PLAN.md
[ipex]: exchange/IPEX_PLAN.md
[exchange]: exchange/EXCHANGE_ADMISSION_PLAN.md
[essr]: essr/ESSR_PLAN.md
[resource]: runtime/RESOURCE_POLICY_PLAN.md
[storage]: db/STORAGE_RECOVERY_PLAN.md
[transport]: runtime/TRANSPORT_PLAN.md
[qualification]: qualification/QUALIFICATION_PLAN.md
[pins]: qualification/REFERENCE_ENVIRONMENTS.md
[mapper]: cesr/MAPPER_PLAN.md
