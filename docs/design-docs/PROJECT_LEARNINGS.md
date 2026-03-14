# PROJECT_LEARNINGS (Index)

## Purpose

Top-level routing and durable cross-topic memory for `keri-ts`.

Use this file to:

1. identify current focus areas,
2. locate the right topic learnings doc(s),
3. capture only the highest-signal cross-topic state,
4. apply consistent handoff updates without duplicating topic detail.

## Current Focus

1. CESR parser work is complete enough for upper-layer progress, with a formal
   `GO` completeness decision against the current KERIpy baseline.
2. Phase 2 KERI work is centered on DB parity, key-management, and practical
   `kli`/`tufa` interoperability gates.

## Topic Learnings Index

| Topic                          | File                                                                             | Scope                                                                        |
| ------------------------------ | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| CESR Parser                    | `docs/design-docs/learnings/PROJECT_LEARNINGS_CESR.md`                           | Parser architecture, state machine contract, parity, binary handling         |
| Crypto Suite                   | `docs/design-docs/learnings/PROJECT_LEARNINGS_CRYPTO_SUITE.md`                   | Primitive semantics, key material, signing/verification behavior and interop |
| KELs                           | `docs/design-docs/learnings/PROJECT_LEARNINGS_KELS.md`                           | Event-log/state-transition work, DB parity, replay/verification semantics    |
| ACDC                           | `docs/design-docs/learnings/PROJECT_LEARNINGS_ACDC.md`                           | Credential issuance/exchange semantics and data-model concerns               |
| Witness/Watcher/Observer Infra | `docs/design-docs/learnings/PROJECT_LEARNINGS_WITNESS_WATCHER_OBSERVER_INFRA.md` | Network roles, deployment, ops/interoperability notes                        |

## Context Pack Policy

At session start:

1. Read `AGENTS.md`.
2. Read this file.
3. Read only the topic doc(s) relevant to the requested task.
4. Read any contract/ADR/plan docs referenced by those topic docs.

This keeps context focused and avoids long-thread drift.

## Compaction Policy

1. Keep this file as a routing layer, not a second full history log.
2. Keep durable cross-topic conclusions here; push topic detail into topic docs.
3. When a topic handoff log grows noisy, roll minor entries into one milestone
   summary instead of preserving every micro-step.
4. Before splitting a topic doc for size, first compact duplicated or stale
   historical detail.

## Cross-Topic Snapshot

1. CESR parser lifecycle behavior is governed by
   `docs/design-docs/CESR_PARSER_STATE_MACHINE_CONTRACT.md`; parser-adjacent
   changes should preserve KERIpy parity and contract-to-test traceability.
2. CESR parser architecture remains intentionally atomic/bounded-substream
   first; incremental nested parsing is deferred behind explicit performance
   evidence.
3. CESR breadth closure is complete across the tracked P2 vector set, and the
   current expectation is to preserve that coverage as a regression floor while
   upper-layer work proceeds.
4. Primitive-first CESR hydration, per-primitive test organization, and
   maintainer-oriented docstrings are in place; future primitive changes should
   keep learner/maintainer readability as a first-class design goal.
5. KERI Phase 2 work is now sequenced around DB parity first, with
   `docs/design-docs/db/db-architecture.md` serving as the cross-topic DB
   invariants reference for KEL/ACDC/infra tasks.
6. DB parity planning artifacts exist and D1 is the active workstream; `LMDBer`
   core parity progressed enough to unblock further Suber/Komer/Baser work, but
   DB work remains parity-first rather than abstraction-first.
7. `kli`/`tufa` interoperability planning has expanded beyond init/incept into a
   usable bootstrap arc including list/aid visibility, service endpoints, OOBIs,
   direct+mailbox communication, and challenge flows.
8. Deno config ownership is graph-wide for local-source workflows; if root or
   `packages/keri` entrypoints load local CESR source, the active config must
   also carry CESR-owned import-map entries.
9. Local `deno install` of `tufa` from repo source is a maintainer path, not the
   primary user path; the supported distribution path remains the npm package
   artifact, and CLI startup now lazy-loads handlers so `--help` and `--version`
   do not pull CESR/LMDB startup work.
10. Formatting policy is explicitly Deno-native: CI and release workflows are
    expected to enforce `deno fmt --check`.
11. The DB architecture contract now includes a maintainer-facing `LMDBer`
    family taxonomy so ordering and multiplicity semantics can be reasoned about
    by storage model rather than by individual method name.
12. The DB architecture contract now explicitly distinguishes native LMDB
    duplicate semantics from synthetic keyspace virtualization, with focused
    `Dup*`/`IoDup*` examples to prevent maintainers from conflating the two.
13. The DB architecture contract now includes an explicit design-rationale
    section for the `OnIoSet*`/`OnIoDup*` two-dimensional model, explaining when
    the abstraction is justified, what it buys higher layers, and where the real
    overengineering risk lives.
14. `packages/keri` test stability currently depends on pinning `lmdb` exactly
    to `3.4.4`; allowing caret drift to `3.5.1` triggered Deno N-API panics
    during app-level DB startup on the current macOS arm64 maintainer
    environment.

## New Thread Kickoff Template

```text
Use AGENTS.md startup protocol.
Read PROJECT_LEARNINGS.md and relevant topic learnings docs.
Summarize current state in 10 bullets.
Then do task: <TASK>.
```

## End-of-Task Handoff Template

```text
### YYYY-MM-DD - <Task Title>
- Topic docs updated:
  - <topic file path(s)>
- What changed:
  - ...
- Why:
  - ...
- Tests:
  - Command: ...
  - Result: ...
- Contracts/plans touched:
  - ...
- Risks/TODO:
  - ...
```
