# KERIpy parity and bounded runtime roadmap

Verified boundary: keri-ts `88c39757` after #234; transport and qualification remain open.
Frozen upstream: `7143832813cac6a394ab1faf9be83bb3372be87c`.
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

| Requirement       | Current boundary | Owner                     | Evidence                | Open limit            |
| ----------------- | ---------------- | ------------------------- | ----------------------- | --------------------- |
| CESR parsing      | Delivered        | [1–2][cesr]               | [Wire/tree][delivered]  | Accessor audit        |
| Multisig          | Four routes      | [3d][multisig]            | [#160–161][delivered]   | Native/CLI scope      |
| IPEX              | Proofs/cutoffs   | [3e][ipex]                | [R11/S1–3][registry]    | Full workflow         |
| V1/V2 registries  | Runtime/observer | [Qualification][registry] | [R1–R12][registry]      | Wire/store matrix     |
| EXN proofs        | Implemented      | [3e/3f][exchange]         | [#162/165][delivered]   | Full workflow         |
| v2 intake         | Optional KRAM    | [TEL/TSN][exchange]       | [K1–K10][kram]          | TEL/TSN/stubs         |
| ESSR outcomes     | Shared admission | [4 integration][essr]     | [Policy][resource]      | Native copies         |
| Shared budget     | Trees/queues     | [4 stack][resource]       | [Policy][resource]      | Copies/metadata       |
| Storage/recovery  | Nested preflight | [5][storage]              | [#214][native-rows]     | Other rows/recovery   |
| Transport         | HTTP progressive | [6/S1–9][transport]       | [Boundary][transport]   | TCP/guard/duplex      |
| Reference pins    | Imports audited  | [7][qualification]        | [Inventory][pins]       | Actual workflows      |
| Qualification     | Small corpora    | [7][qualification]        | [Matrix][qualification] | Full runtime          |
| Mapper/schema IDs | Implemented      | [Qualification][mapper]   | [Claims/IDs][mapper]    | Default-builder scope |
| npm release       | Pending          | [#104][release]           | Published artifacts     | Final goal gate       |

## Publication sequence

1. KRAM K1–K10, registry R1–R12, IPEX cutoffs and schema gates S1–S3 are
   implemented. Qualify their composed workflows; do not recreate foundations.
   The retired #172 snapshot remains recoverable evidence.
2. Finish real frozen-reference TEL/TSN processors in small query/reply units.
   Keep unfinished consumers guarded; `xip/pro/bar` are reference stubs.
3. Complete shared admission (4), storage/recovery (5) and production
   backpressure (6) through the active stack below and its remaining owner gates.
   The socket-to-application streamability work is phase 6's S1–9 sequence:
   bounded cue handoff, network waits outside the guard, progressive TCP intake,
   supervised connections, streamed output, explicit duplex and composed proof.
   Finite/source messenger entries share two engines within those units; HTTP
   preserves its framed POST contract.
   It is required in the next release, not deferred post-release qualification.
4. Qualify delivered Mapper claims (#223) and bundled schema IDs (#226) in the
   final composition; keep format-dependent default-builder limits explicit.
5. Run the maintained full inventory and repeated end-to-end qualification (7)
   against the final composition. Import probes alone do not qualify workflows.
6. Finish with the npm release: refresh and merge [#104][release] only after
   the preceding work and qualification, then publish and verify the exact
   package artifacts. The version PR alone does not prove publication.

At this boundary, the active resource stack owns ESSR staging [#213][stage-credit],
nested storage [#221][nested-credit], HTTP replies [#218][reply-credit], query
preparation [#219][query-credit], HTTP frame preparation [#224][http-credit] and
outgoing parsing [#225][output-credit]. KRAM storage follows nested storage.
Pending metadata/work accounting, other native reads, crash recovery and the
production measurements remain open in their subject plans.

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
[Upstream gaps][upstream-gaps] do not block completion indefinitely: implement and
qualify the approved TypeScript path, record the reference limitation and any
intentional difference, then complete against our own acceptance/release gates.
Discussion proposals and unimplemented stubs are not processing requirements.
Long qualification stays outside required merge CI; only the maintainer dispatches
hosted extended jobs, whose existing 15-minute cap remains unchanged.

## Final release gate

The approved final task is publication of `cesr-ts`, `keri-ts` and `@keri-ts/tufa`
for downstream diddaemon adoption. Complete transport S1–9 and its shared-budget
and durable-recovery dependencies before merging #104 or publishing. Prove real
HTTP/TCP progress through verified acceptance before transfer completion; parser
tests, finite TCP admission and local write completion cannot satisfy this gate.
Recheck #104's generated versions, dependency
ranges, changelogs and exact-head checks after all implementation changes land.
The current Changesets workflow only maintains versions; npm publication uses
the existing package tag/dispatch workflows. Release in dependency order and
verify registry versions, dependency metadata, tarball identity and installed
package smoke behavior. If Actions cannot publish, use the authorized local
publishing path while preserving the checked artifact and version identity.
Report exact published versions and release evidence for the downstream chat;
do not close the goal on a merged version PR or a successful build alone.

[registry-observer]: https://github.com/kentbull/keri-ts/pull/202
[mapper-repair]: https://github.com/kentbull/keri-ts/pull/223
[native-rows]: https://github.com/kentbull/keri-ts/pull/214
[stage-credit]: https://github.com/kentbull/keri-ts/pull/213
[nested-credit]: https://github.com/kentbull/keri-ts/pull/221
[reply-credit]: https://github.com/kentbull/keri-ts/pull/218
[query-credit]: https://github.com/kentbull/keri-ts/pull/219
[http-credit]: https://github.com/kentbull/keri-ts/pull/224
[output-credit]: https://github.com/kentbull/keri-ts/pull/225
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
[upstream-gaps]: ../reference/credentials/UPSTREAM_REGISTRY_GAPS.md
