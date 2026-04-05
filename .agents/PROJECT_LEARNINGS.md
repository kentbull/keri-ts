# PROJECT_LEARNINGS (Index)

## Purpose

Top-level routing and durable cross-topic memory for `keri-ts`.

Use this file to:

1. identify current focus,
2. route to the right topic doc,
3. capture only the highest-signal cross-topic conclusions,
4. keep startup context small enough to reread every thread.

## Current Focus

1. CESR parser, primitive, and serder work is stable enough for upper-layer
   progress; the job now is to preserve parity, readability, and regression
   coverage rather than reopen settled parser architecture.
2. KERI Phase 2 work is parity-first around DB closure, runtime/key-management
   behavior, and practical `kli`/`tufa` interoperability.
3. The learnings layer is intentionally compact. Durable conclusions belong
   here; detailed task transcripts do not.

## Topic Learnings Index

| Topic                          | File                                                                    | Scope                                                                    |
| ------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| CESR Parser                    | `.agents/learnings/PROJECT_LEARNINGS_CESR.md`                           | Parser architecture, primitive/serder parity, native handling            |
| Crypto Suite                   | `.agents/learnings/PROJECT_LEARNINGS_CRYPTO_SUITE.md`                   | Primitive semantics, signer/verifier ownership, encryption behavior      |
| KELs                           | `.agents/learnings/PROJECT_LEARNINGS_KELS.md`                           | DB parity, state transitions, runtime/cue/reply ownership, interop gates |
| ACDC                           | `.agents/learnings/PROJECT_LEARNINGS_ACDC.md`                           | Credential compactification, section semantics, ACDC-native rules        |
| Witness/Watcher/Observer Infra | `.agents/learnings/PROJECT_LEARNINGS_WITNESS_WATCHER_OBSERVER_INFRA.md` | CI/release/runtime interop contracts plus infra-role operational notes   |

## Session Start Policy

1. Read `AGENTS.md`.
2. Read this file.
3. Read only the topic doc(s) relevant to the task.
4. Read the contract/ADR/plan docs referenced by those topic docs when the task
   actually depends on them.
5. Use KERIpy at `$HOME/code/keri/kentbull/keripy` as the behavioral authority
   whenever parity reasoning becomes uncertain.

## Compaction Policy

1. Keep this file as a routing layer, not a second archive.
2. Keep durable cross-topic rules here; keep topic detail in topic docs.
3. When history gets noisy, roll it into milestone summaries instead of adding
   more micro-handoffs.
4. Prefer "what matters now" over "everything that happened."
5. Most tasks should update `Current State` and `Current Follow-Ups` rather than
   append a new milestone entry.

## Cross-Topic Snapshot

1. `docs/design-docs/cesr/CESR_PARSER_STATE_MACHINE_CONTRACT.md` is the
   normative parser lifecycle contract. Parser changes should keep
   contract-to-test traceability and KERIpy parity.
2. CESR parser architecture remains atomic/bounded-substream first. Nested
   incremental parsing stays deferred unless performance evidence says
   otherwise.
3. The tracked P2 CESR vector set is the regression floor for parser behavior.
4. Generated KERIpy-parity codex objects such as `MtrDex`, `PreDex`, `DigDex`,
   `IdrDex`, and `TraitDex` are the primary source of truth. Helper sets in
   `codex.ts` are derived readability views, not a competing authority.
5. When the code already knows the semantic type, it should construct and return
   the narrow primitive. `Matter` and `Indexer` are low-level parser/storage
   bases, not the default public API result.
6. Fixed-field seal/blind/media structing values belong to CESR through
   `packages/cesr/src/primitives/structing.ts`; the stable design there is plain
   frozen records plus companion helpers/registries, with raw-SAD-first
   boundaries and explicit typed projections. `packages/keri` runtime dispatch
   now uses those CESR records directly, while LMDB tuple aliases remain a
   derived storage boundary instead of a second semantic home.
7. CESR-native and ACDC-native behavior should extend the shared support matrix
   in `packages/cesr/src/serder/native.ts`; do not reintroduce sidecar native
   branching.
8. ACDC parity depends on explicit compactification rules: top-level compactive
   verification uses the most compact section form, while section identifiers
   stay label-aware (`$id`, `d`, `agid`).
9. Weighted thresholds are semantic through `Tholder`; KEL and reply logic
   should use `tholder.satisfy(...)` rather than collapsing threshold material
   into ad hoc numeric parsing.
10. `docs/design-docs/db/db-architecture.md` is the shared DB invariants
    contract. DB work remains parity-first rather than abstraction-first.
11. Durable local state is DB-backed: `states.` is the authoritative local key
    state, `kels.` / `fels.` / `dtss.` support reopenable event state, and
    `Habery.habs` is only an in-memory reconstruction cache.
12. The mapper/record mental model is `FooRecord` plus `FooRecordShape`, with
    `recordClass` as the durable public seam. Public `*Like` aliases and
    mapper-facing `hydrate` / `normalize` APIs are drift.
13. KEL control flow should stay on typed decisions (`accept`, `duplicate`,
    `escrow`, `reject`): `Kever` decides validity, `Kevery` routes/applies, and
    `docs/adr/adr-0005-kel-decision-control-flow.md` is normative.
14. Cue/runtime ownership is dual-scope and explicit: `AgentRuntime` owns the
    shared runtime cue deck for `Reactor` / `Revery` / runtime `Kevery` /
    `Oobiery`, `Habery.kevery` owns a separate local cue deck for `Hab` local
    processing, `Hab.processCuesIter()` owns cue semantics, `Revery` owns reply
    verification/BADA/escrows, `Kevery` owns KEL and `/ksn`-style reply
    families, and `Oobiery` owns introduction-driven OOBI work.
15. Receipt-family mental models should stay KERIpy-shaped: live `rct`
    transferable receipts use grouped `tsgs`, while replay/clone attached
    transferable receipt material uses `trqs`. Escrow/storage may flatten those
    groups into quintuple/quadruple records, but the live API boundary should
    not blur the two families, and the receipt escrow seams should keep KERIpy
    names (`escrowUReceipt`, `escrowUWReceipt`, `escrowTRGroups`,
    `escrowTReceipts`) instead of one combined local helper.
16. Local location updates must enter through signed `/loc/scheme` replies that
    flow through the normal parser -> `Revery` path, not by direct writes to
    `locs.` / `lans.`.
17. Interop contracts are exact, not approximate: keep `lmdb` pinned to `3.4.4`,
    preserve `LMDB_DATA_V1=true` for KERIpy interop workflows, and route
    protocol/storage CBOR through the shared CESR codec for byte parity.
18. Deno config ownership is graph-wide for local-source workflows, and CLI
    startup should stay lazy so `--help` / `--version` do not pull CESR/LMDB
    startup work.
19. CI policy is `dprint` plus stage-gated quality checks, a pinned KERIpy CLI,
    explicit environment/version pins, and cache topology that respects LMDB v1
    rebuild requirements.
20. Test parallelization should follow isolation boundaries, not folder names.
    DB-core suites can parallelize more freely; CLI/app/interop suites that
    mutate globals or persisted stores need stronger isolation.
21. Gates B, C, and D are closed enough to treat local visibility, compat-store
    visibility, and encrypted keeper semantics as established foundations.
22. Gate E now has a real shared runtime, mailbox/OOBI/query/receipt slice, and
    bounded init/incept convergence, but remaining gaps still include
    forwarding/exchange/direct transport breadth and stricter stale/timeout
    continuation behavior.

## Current Follow-Ups

1. Promote the highest-value DB `Partial` rows with evidence, especially
   `fetchTsgs` and the `Komer` family.
2. Preserve CESR parser/serder/primitive parity without reopening settled
   architecture unless KERIpy or regression evidence forces it.
3. Continue honest runtime closure around `/ksn`, `/introduce`, receipt/query
   escrows, bounded init/incept convergence, mailbox/direct/forwarding breadth,
   and richer cue consumers.
4. Keep maintainer-facing docs and referenced contracts in sync with behavior
   changes in the same change set.
5. Keep KERI storage tuple aliases derived from CESR structing descriptors and
   resist reintroducing duplicate wrapper families or raw seal-shape parsing in
   runtime code.
6. Keep this memory layer compact. If a future update cannot be summarized
   cleanly, the real problem is probably unresolved design, not missing prose.

## 2026-04-04 - Escrow Replay Control Flow Should Be Explicit

- `Kevery` receipt/query replay, `Revery` reply replay, and DB `Broker` retry
  flows should all use the same typed `accept` / `keep` / `drop` replay
  vocabulary instead of ad hoc string unions or exception-only branching.
- `keep` is the typed mirror of KERIpy's recoverable unverified/query-not-found
  control paths, while `drop` is for stale/corrupt rows that must be removed and
  `accept` is successful unescrow.
- Reprocess loops should switch on the typed decision and decide side effects
  there. Do not collapse all non-keep cases into one boolean test, because
  different drop reasons can require different cleanup behavior.

## Templates

### New Thread Kickoff Template

```text
Use AGENTS.md startup protocol.
Read PROJECT_LEARNINGS.md and relevant topic learnings docs.
Summarize current state in 10 bullets.
Then do task: <TASK>.
```

### End-of-Task Handoff Template

```text
### YYYY-MM-DD - <Task Title>
- Substance: <1-3 durable changes in ownership, invariants, parity rules, or mental model>
- Why it matters: <what future work would get wrong without this>
- Next: <remaining blocker, risk, or follow-up if any>
- Verification: <passed locally / pending CI / not run>
```
