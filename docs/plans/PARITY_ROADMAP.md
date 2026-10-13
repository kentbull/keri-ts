# KERIpy parity and bounded runtime roadmap

Verified boundary: keri-ts `cd6648ebda092bf2940aa9503e21f013294c64b8` after
[#169][pr169]. Frozen upstream: `927c0cb8794d7c84fc17143c67df64aab9deda6c`.
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
| EXN proofs       | Implemented      | [3e/3f][exchange]     | [#162/165][delivered]   | KRAM integration   |
| v2 intake        | Sender/routing   | [3f KRAM][exchange]   | [Signed wire][intake]   | KRAM/TEL/stubs     |
| ESSR outcomes    | Implemented      | [4 integration][essr] | [#163][delivered]       | Local guards       |
| Shared budget    | Local guards     | [4][resource]         | [Required][resource]    | Pre-allocation     |
| Storage/recovery | Durable wire     | [5][storage]          | [Required][storage]     | Whole-row reads    |
| Transport        | Streaming paths  | [6][transport]        | [Required][transport]   | Usable-child proof |
| Reference pins   | Mixed targets    | [7][qualification]    | [Inventory][pins]       | Actual imports     |
| Qualification    | Small corpora    | [7][qualification]    | [Matrix][qualification] | Full runtime       |
| Mapper SAID      | Stale claim gap  | [Final][mapper]       | [Required][mapper]      | Aggor semantics    |

## Publication sequence

1. Documentation reorganization is delivered in #169. Sender admission is the
   current 3f slice; its contract and tests are linked above.
2. Finish 3f KRAM admission and its dependent 3e presentation
   path. Keep unimplemented consumers guarded; `xip/pro/bar` are reference stubs.
3. Shared admission (4), storage/recovery (5), production backpressure (6).
4. Full reference audit and repeated end-to-end qualification (7).
5. Focused standalone Mapper repair; rerun affected qualification after it.

The multisig responsibility extraction (#161), ESSR outcome extraction (#163),
and proof cleanup (#165) are delivered. Do not recreate them. Split remaining
work only for cohesive review or a demonstrated dependency. Branch each PR from
its merged predecessor; merge only after required CI passes on that exact head.
Preserve worktrees, benchmark baselines, assertions and participant topology.
Use explicit changesets and register every maintained test in the inventory.

Final reporting must classify **supported**, **unfinished**, **intentional
divergence**, **reference stub**, and **unqualified** behavior separately.
Passing parser tests or finite per-recipient guards cannot close phases 4–7.
Long qualification stays outside required merge CI; only the maintainer dispatches
hosted extended jobs, whose existing 15-minute cap remains unchanged.

[pr169]: https://github.com/kentbull/keri-ts/pull/169
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
