# PROJECT_LEARNINGS (Index)

## Purpose

Top-level routing and durable cross-topic memory for `keri-ts`. This file
should stay short enough to reread at session start.

## Current Focus

1. CESR parser, primitive, and serder work is stable; current work is parity,
   readability, and regression preservation, not parser re-architecture.
2. KERI Phase 2 is parity-first around DB closure, runtime/key-management
   behavior, and practical `kli`/`tufa` interoperability.
3. The learnings layer itself should stay compact; when it grows noisy, rewrite
   it instead of appending another diary section.

## Topic Learnings Index

| Topic                          | File                                                                    | Scope                                                                    |
| ------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| CESR Parser                    | `.agents/learnings/PROJECT_LEARNINGS_CESR.md`                           | Parser architecture, primitive/serder parity, native handling            |
| Crypto Suite                   | `.agents/learnings/PROJECT_LEARNINGS_CRYPTO_SUITE.md`                   | Primitive semantics, signer/verifier ownership, encryption behavior      |
| KELs                           | `.agents/learnings/PROJECT_LEARNINGS_KELS.md`                           | DB parity, state transitions, runtime/cue/reply ownership, interop gates |
| ACDC                           | `.agents/learnings/PROJECT_LEARNINGS_ACDC.md`                           | Credential compactification, section semantics, ACDC-native rules        |
| Witness/Watcher/Observer Infra | `.agents/learnings/PROJECT_LEARNINGS_WITNESS_WATCHER_OBSERVER_INFRA.md` | CI, release, witness interop, runtime/infra operations                   |

## Session Start Policy

1. Read `AGENTS.md`
2. Read this file
3. Read only the topic doc(s) relevant to the task
4. Read only the referenced ADR/contract/plan docs the task actually depends on
5. Use KERIpy as the behavioral authority when parity reasoning is uncertain

## Compaction Policy

1. Keep this file as a routing layer, not a second archive
2. Keep detailed topic memory in topic docs
3. Prefer "what matters now" over chronological completeness
4. Collapse noisy history into milestone rollups instead of adding more
   micro-handoffs
5. Most tasks should update `Current State` or `Current Follow-Ups`, not append
   a new milestone

## Cross-Topic Snapshot

1. `docs/design-docs/cesr/CESR_PARSER_STATE_MACHINE_CONTRACT.md` is the parser
   lifecycle contract; keep parser behavior traceable to that contract and its
   tests.
2. CESR parser architecture remains atomic/bounded-substream first. Do not
   reopen nested incremental parsing without real performance evidence.
3. Generated KERIpy-parity codex objects are authoritative; helper sets are
   derived readability views.
4. When the semantic type is known, construct the narrow CESR primitive.
   `Matter` and `Indexer` are low-level bases, not the preferred public result.
5. `Signer`/`Verfer` own signer/verifier suite dispatch; crypto helpers should
   not become a second semantic home.
6. Fixed-field seal/blind/media values belong to CESR
   `primitives/structing.ts`; KERI runtime code should project through CESR
   structing helpers rather than duplicating raw-shape logic.
7. CESR-native and ACDC-native behavior should extend the shared native support
   matrix in `packages/cesr/src/serder/native.ts`.
8. Weighted thresholds are semantic through `Tholder`; KEL and reply logic
   should use `tholder.satisfy(...)`, not ad hoc numeric shortcuts.
9. `docs/design-docs/db/db-architecture.md` is the shared DB invariants
   contract; DB work remains parity-first, not abstraction-first.
10. Durable local state is DB-backed: `states.` is authoritative local key
    state, `kels.` / `fels.` / `dtss.` support reopenable event state, and
    `Habery.habs` is only an in-memory reconstruction cache.
11. Record-model parity is `FooRecord` plus `FooRecordShape`, with
    `recordClass` as the durable public seam.
12. KEL control flow should stay on typed decisions: `Kever` decides validity,
    `Kevery` routes/applies, and `docs/adr/adr-0005-kel-decision-control-flow.md`
    is normative.
13. Cue/runtime ownership is dual-scope and explicit: runtime-hosted work uses
    the shared runtime cue deck, while `Habery.kevery` owns a separate local
    cue deck for habitat-local processing.
14. `Revery` owns reply verification/BADA/escrows, `Kevery` owns KEL and
    KEL-derived reply families, and `Oobiery` owns introduction-driven OOBI
    work.
15. The mailbox mental model must stay explicit: provider mailbox storage is
    shared runtime-composed state above `Habery`, while remote topic cursors
    stay durable habery state in `tops.`.
16. Local location updates must arrive through signed `/loc/scheme` replies,
    not direct writes to `locs.` / `lans.`.
17. Interop contracts are exact: keep `lmdb` pinned to `3.4.4`, preserve
    `LMDB_DATA_V1=true` for KERIpy interop workflows, and route protocol/storage
    CBOR through the shared CESR codec.
18. Test parallelization should follow real isolation boundaries, not folder
    names. Keep lane ownership explicit and keep default CI truthful.
19. `packages/tufa` now owns the runnable host/CLI edge; `keri-ts` root,
    `keri-ts/runtime`, and `keri-ts/db` are the supported library entrypoints.
20. The learnings layer is part of project hygiene: compact docs when they grow
    noisy instead of preserving every step as prose.

## Current Follow-Ups

1. Promote the highest-value DB `Partial` rows with evidence, especially
   `fetchTsgs` and remaining `Komer` families.
2. Preserve CESR parser/serder/primitive parity without reopening settled
   architecture unless KERIpy or regression evidence forces it.
3. Continue runtime closure on the remaining exchange/forwarding breadth and the
   broader stale/timeout continuation tail now that the core query/reply,
   receipt/query, mailbox, and challenge slices are real.
4. Keep maintainer-facing docs and referenced contracts updated in the same
   change set as behavior changes.
5. Keep KERI tuple-storage aliases derived from CESR structing descriptors
   rather than reintroducing duplicate wrapper families.
6. Treat source-vs-npm drift in `tufa` as a release blocker; smoke the packed
   artifact when CLI or Node-host behavior changes.
7. Keep bootstrap config on honest CLI/file seams rather than hidden default
   paths or ad hoc store mutation in scripts.
8. Keep host-prefix selection explicit and conservative; do not leak
   system-managed identities into normal user-facing host startup.
9. Keep witness interop claims tied to the scenarios actually proved.
10. Keep test-lane ownership explicit as mailbox/runtime work grows.

## Recent Durable Changes

### 2026-04-04 to 2026-04-05 - Runtime Replay, Structing, And Mailbox Boundaries Sharpened

- Replay/unescrow control flow now uses explicit typed decisions instead of
  mixed boolean or exception-only branching.
- CESR structing records are the semantic home for fixed-field seal/blind/media
  values; KERI storage aliases remain derived.
- Provider mailbox storage moved out of `Habery`; mailbox ownership is now
  shared runtime-composed state plus durable habery cursors.

### 2026-04-07 to 2026-04-08 - CLI, Witness, And Host Boundaries Became More Honest

- Single-sig sign/verify/query/rotate parity landed on separate control paths.
- Real witness interop now uses an explicit KERIpy harness and an honest proved
  scenario matrix.
- Protocol routing was split from transport hosting; route policy is no longer
  hidden in server adapters.

### 2026-04-09 - Package Ownership And Release Surfaces Tightened

- `packages/tufa` is now the runnable host/CLI boundary; `keri-ts` exposes the
  narrow library surface.
- CLI tests must launch `packages/tufa/mod.ts`, and `tufa` source changes
  require regenerating `packages/tufa/npm/**`.
- Delegation and peer-OOBI notifications belong in `Notifier`, not in new cue
  kinds.
- This learnings layer was compacted so startup context stays small enough to
  reread every thread.

## Templates

### New Thread Kickoff Template

1. Current state: <10 concise bullets>
2. Plan: <10 concise bullets>

### End-of-Task Handoff Template

#### YYYY-MM-DD - <Task Title>

- Substance: <1-3 durable changes in ownership, invariants, parity rules, or
  mental model>
- Why it matters: <what future work would get wrong without this>
- Next: <remaining blocker, risk, or follow-up if any>
- Verification: <passed locally / pending CI / not run>
